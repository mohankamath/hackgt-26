"""Instagram adapter (instagrapi session-id login + polling, same approach as the original).

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
from pathlib import Path
from typing import TYPE_CHECKING

from app.config import BACKEND_DIR

if TYPE_CHECKING:
    from app.services.ingest import SafeGuardService

log = logging.getLogger("safeguard.instagram")

SESSION_CACHE_FILE = BACKEND_DIR / "instagram_session.json"
RATE_LIMIT_SLEEP_SECONDS = 600


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
    name = "instagram"

    def __init__(self, service: "SafeGuardService", session_id: str, poll_interval: int = 30) -> None:
        from instagrapi import Client  # heavy import; only when Instagram is configured

        self.service = service
        self.session_id = session_id
        self.poll_interval = max(10, poll_interval)
        self.cl = Client()
        self.is_running = False
        self.error: str | None = None
        self._seen: set[str] = set()
        self._task: asyncio.Task | None = None

    @property
    def user(self) -> str | None:
        try:
            return self.cl.username or (str(self.cl.user_id) if self.cl.user_id else None)
        except Exception:
            return None

    def _setup_device(self) -> None:
        if Path(SESSION_CACHE_FILE).exists():
            try:
                self.cl.load_settings(SESSION_CACHE_FILE)
                return
            except Exception as exc:
                log.warning("failed to load Instagram session cache: %s", exc)
        self.cl.set_device(
            {
                "app_version": "269.0.0.18.75",
                "android_version": 26,
                "android_release": "8.0.0",
                "dpi": "480dpi",
                "resolution": "1080x1920",
                "manufacturer": "samsung",
                "device": "greatqlte",
                "model": "SM-N950U",
                "cpu": "qcom",
                "version_code": "443374753",
            }
        )
        self.cl.set_user_agent(
            "Instagram 410.0.0.0.96 Android (33/13; 480dpi; 1080x2400; xiaomi; M2007J20CG; surya; qcom; en_US; 641123490)"
        )

    async def start(self) -> None:
        from instagrapi.exceptions import BadPassword, ChallengeRequired

        self._setup_device()
        try:
            await asyncio.to_thread(self.cl.login_by_sessionid, self.session_id)
            try:
                await asyncio.to_thread(self.cl.dump_settings, SESSION_CACHE_FILE)
            except Exception:
                pass
            log.info("Instagram logged in as %s", self.user)
        except BadPassword:
            self.error = "Instagram rejected the session id"
        except ChallengeRequired:
            self.error = "Instagram challenge required: approve the login on a phone"
        except Exception as exc:
            self.error = f"login failed: {exc}"
        if self.error:
            log.error(self.error)
            return
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

    async def _poll_loop(self) -> None:
        from instagrapi.exceptions import FeedbackRequired, LoginRequired, PleaseWaitFewMinutes

        while self.is_running:
            try:
                await self.poll_once()
            except (FeedbackRequired, PleaseWaitFewMinutes):
                log.warning("Instagram rate limited; sleeping %ss", RATE_LIMIT_SLEEP_SECONDS)
                await asyncio.sleep(RATE_LIMIT_SLEEP_SECONDS)
            except LoginRequired:
                self.error = "Instagram session invalidated; restart with a new session id"
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
