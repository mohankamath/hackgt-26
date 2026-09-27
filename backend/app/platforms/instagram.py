"""Instagram adapter (instagrapi session-id or username/password login + polling).

Reliability fixes vs. the original:
- sender username / avatar come from the thread's user list (was: the thread title), which
  also saves one ``user_info`` API call per message
- timestamps are converted to UTC properly (was: a hardcoded ``+ timedelta(hours=5)``)
- channel_id is the Instagram thread id, so group threads work and replies go to the right thread
- avatars are re-checked when they change or the cached verdict expires (was: never re-checked
  once uploaded)
- the payload is queued; moderation runs on workers, not inside the poll loop
- sent messages use the real Instagram message id (was: ``sent_{int(time.time())}``)
"""

from __future__ import annotations

import asyncio
import logging
import os
from pathlib import Path
from typing import TYPE_CHECKING

from app.config import BACKEND_DIR

if TYPE_CHECKING:
    from app.services.ingest import ScreenedService

log = logging.getLogger("screened.instagram")

SESSION_CACHE_FILE = BACKEND_DIR / "instagram_session.json"
RATE_LIMIT_SLEEP_SECONDS = 600
# Current Instagram Android builds need Android 9+ (API 28); instagrapi's default is API 34.
MIN_ANDROID_API = 28


def _media_url(msg) -> tuple[str | None, str]:
    """Extract (url, content_type) from a DirectMessage using the original's 4 fallback paths."""
    url, ctype = None, "image/jpeg"
    media = getattr(msg, "media", None)
    if media:
        iv2 = getattr(media, "image_versions2", None)
        candidates = getattr(iv2, "candidates", None) if iv2 else None
        if candidates:
            first = candidates[0]
            url = str(first.get("url") if isinstance(first, dict) else first.url)
        if not url and getattr(media, "thumbnail_url", None):
            url = str(media.thumbnail_url)
        if not url and getattr(media, "url", None):
            url = str(media.url)
        videos = getattr(media, "video_versions", None)
        if videos:
            ctype = "video/mp4"
            v0 = videos[0]
            video_url = v0.get("url") if isinstance(v0, dict) else getattr(v0, "url", None)
            if video_url:
                url = str(video_url)
    vm = getattr(msg, "visual_media", None)
    if not url and vm:
        media_obj = getattr(vm, "media", None) or vm
        iv2 = getattr(media_obj, "image_versions2", None)
        candidates = getattr(iv2, "candidates", None) if iv2 else None
        if candidates:
            first = candidates[0]
            url = str(first.get("url") if isinstance(first, dict) else first.url)
        if not url and getattr(media_obj, "url", None):
            url = str(media_obj.url)
    return url, ctype


class InstagramPlatform:
    """Login strategy (long-lived persistence, as recommended by the instagrapi README):

    1. Load saved device + cookies from ``instagram_session.json`` if present.
    2. If INSTAGRAM_SESSION_ID is set, try ``login_by_sessionid`` first.
    3. Otherwise (or if the session id is rejected) and INSTAGRAM_USERNAME/PASSWORD are set,
       call ``login(username, password)``. instagrapi validates the saved session and only does
       a fresh login when Instagram rejects it, so restarts don't trigger new logins.
    4. Save settings after every successful login so refreshed cookies persist.

    With a password configured, a ``LoginRequired`` during polling triggers one automatic
    re-login instead of stopping the poller.
    """

    name = "instagram"

    def __init__(
        self,
        service: "ScreenedService",
        session_id: str = "",
        poll_interval: int = 30,
        *,
        username: str = "",
        password: str = "",
        totp_seed: str = "",
        session_file: Path = SESSION_CACHE_FILE,
        client_factory=None,
    ) -> None:
        if client_factory is None:
            from instagrapi import Client  # heavy import; only when Instagram is configured

            client_factory = Client
        self.service = service
        self.session_id = session_id
        self.username = username
        self.password = password
        self.totp_seed = totp_seed
        self.session_file = Path(session_file)
        self.poll_interval = max(10, poll_interval)
        self._client_factory = client_factory
        self.cl = client_factory()
        self.login_method: str | None = None
        self.is_running = False
        self.error: str | None = None
        self._seen: set[str] = set()
        self._task: asyncio.Task | None = None

    @property
    def has_password(self) -> bool:
        return bool(self.username and self.password)

    @property
    def user(self) -> str | None:
        try:
            return self.cl.username or (str(self.cl.user_id) if self.cl.user_id else None)
        except Exception:
            return None

    # ── Login ──────────────────────────────────────────────────────

    @staticmethod
    def device_is_stale(device: dict | None) -> bool:
        """True for device profiles Instagram now rejects as "out of date".

        The original project hardcoded a 2017 Galaxy Note 8 on Android 8.0 (API 26). Current
        Instagram builds refuse that combination, so such sessions must be recreated with
        instagrapi's default (current) device profile.
        """
        try:
            android = int((device or {}).get("android_version") or 0)
        except (TypeError, ValueError):
            android = 0
        return android < MIN_ANDROID_API

    def _load_saved_session(self) -> bool:
        if not self.session_file.exists():
            return False
        try:
            # override_app_version keeps the app profile in sync with this instagrapi version,
            # which CAA login needs (bloks_versioning_id must match the app version).
            self.cl.load_settings(self.session_file, override_app_version=True)
        except Exception as exc:
            log.warning("ignoring unreadable Instagram session file: %s", exc)
            self.cl = self._client_factory()
            return False
        if self.device_is_stale(getattr(self.cl, "device_settings", None)):
            backup = self.session_file.with_name(self.session_file.name + ".stale")
            self.session_file.replace(backup)
            log.warning("saved Instagram session uses an outdated device; moved it to %s and logging in fresh", backup.name)
            self.cl = self._client_factory()
            return False
        return True

    def _verification_code(self) -> str:
        if not self.totp_seed:
            return ""
        try:
            return self.cl.totp_generate_code(self.totp_seed)
        except Exception as exc:
            log.warning("could not generate TOTP code: %s", exc)
            return ""

    def _save_session(self) -> None:
        try:
            self.cl.dump_settings(self.session_file)
            os.chmod(self.session_file, 0o600)  # contains auth cookies
        except Exception as exc:
            log.warning("could not save Instagram session: %s", exc)

    def _password_login(self, relogin: bool = False) -> None:
        self.cl.login(self.username, self.password, relogin=relogin, verification_code=self._verification_code())

    def login_sync(self) -> str:
        """Blocking login following the strategy above. Returns the method that worked."""
        loaded = self._load_saved_session()
        if self.session_id:
            try:
                self.cl.login_by_sessionid(self.session_id)
                # Browser sessionids often "log in" but get login_required from the private
                # mobile API on the first real call, so verify with an authenticated request.
                self.cl.account_info()
                self._save_session()
                return "sessionid"
            except Exception as exc:
                if not self.has_password:
                    raise
                log.warning("session id rejected (%s); falling back to username/password", exc)
        if not self.has_password:
            raise RuntimeError("set INSTAGRAM_SESSION_ID or INSTAGRAM_USERNAME + INSTAGRAM_PASSWORD")
        self._password_login()
        self._save_session()
        return "saved session + password" if loaded else "password"

    def relogin_sync(self) -> None:
        self._password_login(relogin=True)
        self._save_session()

    @staticmethod
    def describe_login_error(exc: Exception) -> str:
        name = type(exc).__name__
        if name == "TwoFactorRequired":
            return "Instagram needs a 2FA code: set INSTAGRAM_TOTP_SEED (authenticator app secret)"
        if name == "ChallengeRequired":
            return "Instagram challenge required: approve the login in the Instagram app, then restart"
        if name in ("BadPassword", "BadCredentials"):
            return "Instagram rejected the credentials (wrong password, or the IP/device isn't trusted yet)"
        if "out of date" in str(exc).lower() or "upgrade your app" in str(exc).lower():
            return (
                "Instagram says the app version is out of date: delete backend/instagram_session.json "
                "and run `pip install -U instagrapi` for a newer app profile"
            )
        if name == "ReloginAttemptExceeded":
            return "Instagram re-login failed repeatedly; restart after checking the account"
        return f"login failed: {exc}"

    async def start(self) -> None:
        try:
            self.login_method = await asyncio.to_thread(self.login_sync)
            log.info("Instagram logged in as %s via %s", self.user, self.login_method)
        except Exception as exc:
            self.error = self.describe_login_error(exc)
            log.error(self.error)
            return
        self.error = None
        self.is_running = True
        self._seen = await self.service.store.existing_message_ids("instagram")
        self._task = asyncio.create_task(self._poll_loop())

    async def stop(self) -> None:
        self.is_running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except (asyncio.CancelledError, Exception):
                pass

    async def _handle_login_required(self) -> bool:
        """Try one automatic re-login. Returns True if polling can continue."""
        if not self.has_password:
            self.error = "Instagram session invalidated; set a new INSTAGRAM_SESSION_ID or add username/password"
            return False
        try:
            await asyncio.to_thread(self.relogin_sync)
            log.info("Instagram re-login succeeded")
            self.error = None
            return True
        except Exception as exc:
            self.error = self.describe_login_error(exc)
            return False

    async def _poll_loop(self) -> None:
        from instagrapi.exceptions import FeedbackRequired, LoginRequired, PleaseWaitFewMinutes

        while self.is_running:
            try:
                await self.poll_once()
            except (FeedbackRequired, PleaseWaitFewMinutes):
                log.warning("Instagram rate limited; sleeping %ss", RATE_LIMIT_SLEEP_SECONDS)
                await asyncio.sleep(RATE_LIMIT_SLEEP_SECONDS)
            except LoginRequired:
                if not await self._handle_login_required():
                    log.error(self.error)
                    self.is_running = False
                    return
            except asyncio.CancelledError:
                raise
            except Exception:
                log.exception("Instagram polling error")
            await asyncio.sleep(self.poll_interval)

    async def poll_once(self) -> int:
        threads = await asyncio.to_thread(self.cl.direct_threads, 20)
        me = str(self.cl.user_id)
        queued = 0
        for thread in threads:
            try:
                messages = await asyncio.to_thread(self.cl.direct_messages, int(thread.id), 20)
            except Exception as exc:
                log.warning("failed to fetch thread %s: %s", thread.id, exc)
                continue
            for msg in reversed(messages):  # oldest first
                mid = str(msg.id)
                if mid in self._seen:
                    continue
                self._seen.add(mid)
                if msg.is_sent_by_viewer or str(msg.user_id or "") == me:
                    continue
                payload = self.build_payload(msg, thread)
                if payload["text"] or payload["attachments"]:
                    await self.service.submit(payload)
                    queued += 1
        return queued

    def build_payload(self, msg, thread) -> dict:
        me = str(self.cl.user_id)
        users = {str(u.pk): u for u in (thread.users or [])}
        sender_id = str(msg.user_id) if msg.user_id else next((pk for pk in users if pk != me), "unknown")
        sender = users.get(sender_id)
        username = (sender.username if sender and sender.username else None) or f"instagram_user_{sender_id}"
        pfp = str(sender.profile_pic_url) if sender and sender.profile_pic_url else None

        attachments = []
        url, ctype = _media_url(msg)
        if url:
            ext = ".mp4" if ctype.startswith("video") else ".jpg"
            attachments.append(
                {"url": url, "filename": f"{msg.id}{ext}", "type": ctype, "storage_path": f"instagram_media/{msg.id}{ext}"}
            )

        is_group = bool(getattr(thread, "is_group", False)) or len(users) > 1
        return {
            "platform": "instagram",
            "message_id": str(msg.id),
            "user_id": sender_id,
            "username": username,
            "channel_id": str(thread.id),
            "channel_name": (thread.thread_title if is_group else username) or username,
            "server_id": str(thread.id),
            "server_name": "Direct Message",
            "is_group": is_group,
            "text": msg.text or "",
            # instagrapi builds naive *local* datetimes via datetime.fromtimestamp
            "timestamp": msg.timestamp,
            "attachments": attachments,
            "profile_picture_url": pfp,
            "profile_picture_storage_path": f"instagram_pfps/{sender_id}.jpg" if pfp else None,
        }

    async def send_message(self, channel_id: str, content: str) -> dict:
        if not self.is_running:
            return {"ok": False, "error": "instagram_not_connected"}
        try:
            sent = await asyncio.to_thread(self.cl.direct_send, content, [], [int(channel_id)])
        except Exception as exc:
            return {"ok": False, "error": str(exc)}
        message_id = str(getattr(sent, "id", "") or "") or None
        if message_id:
            self._seen.add(message_id)
        try:
            await self.service.record_outgoing(
                {
                    "platform": "instagram",
                    "message_id": message_id,
                    "user_id": str(self.cl.user_id),
                    "channel_id": str(channel_id),
                    "text": content,
                }
            )
        except Exception:
            log.exception("failed to record sent Instagram message")
        return {"ok": True, "message_id": message_id}
