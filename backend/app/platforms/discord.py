"""Discord adapter (discord.py-self user-account client, same approach as the original).

Changes from the original:
- the listener only builds a payload and queues it; moderation happens on queue workers
- uses the real ``message.created_at`` (timezone-aware) instead of the save time
- by default only DMs / group DMs are ingested (DISCORD_DMS_ONLY=true); set it to false to
  also ingest server channels like the original did
"""

from __future__ import annotations

import logging
import mimetypes
import re
import ssl
from html import unescape
from pathlib import Path
from typing import TYPE_CHECKING
from urllib.parse import urlparse

import aiohttp
import certifi
import discord

if TYPE_CHECKING:
    from app.services.ingest import ScreenedService

log = logging.getLogger("screened.discord")
_LINK_RE = re.compile(r"https?://[^\s<>]+", re.IGNORECASE)
_PREVIEW_HOSTS = {"klipy.com", "www.klipy.com", "giphy.com", "www.giphy.com", "tenor.com", "www.tenor.com"}
_OG_IMAGE_RE = re.compile(
    r'<meta[^>]+(?:property|name)=["\'](?:og:image|twitter:image)["\'][^>]+content=["\']([^"\']+)',
    re.IGNORECASE,
)


def _avatar_url(user) -> str | None:
    for attr in ("display_avatar", "avatar", "default_avatar"):
        asset = getattr(user, attr, None)
        if asset:
            try:
                return str(asset.url)
            except Exception:
                continue
    return None


def _channel_name(channel, me_id: int) -> str:
    name = getattr(channel, "name", None)
    if name:
        return name
    recipients = getattr(channel, "recipients", None)
    if recipients:
        others = [r.name for r in recipients if r.id != me_id]
        if len(others) == 1:
            return others[0]
        return ", ".join(others) or "Group DM"
    recipient = getattr(channel, "recipient", None)
    return recipient.name if recipient else "Direct Message"


class DiscordPlatform:
    name = "discord"

    def __init__(self, service: "ScreenedService", token: str, dms_only: bool = True) -> None:
        self.service = service
        self.token = token
        self.dms_only = dms_only
        self.client = discord.Client()
        self.error: str | None = None
        self._register_events()

    @property
    def ready(self) -> bool:
        return self.client.is_ready()

    @property
    def user(self) -> str | None:
        return str(self.client.user) if self.client.user else None

    def _register_events(self) -> None:
        @self.client.event
        async def on_ready():
            log.info("Discord connected as %s", self.client.user)

        @self.client.event
        async def on_message(message: discord.Message):
            try:
                if not self.client.user or message.author.id == self.client.user.id:
                    return  # outgoing messages are recorded by send_message()
                if self.dms_only and message.guild is not None:
                    return
                payload = self.build_payload(message)
                await self._add_link_previews(payload)
                await self.service.submit(payload)
            except Exception:
                log.exception("failed to queue Discord message")

    def build_payload(self, message: discord.Message) -> dict:
        channel = message.channel
        is_dm = message.guild is None
        recipients = getattr(channel, "recipients", None) or []
        attachments = []
        for index, attachment in enumerate(message.attachments):
            content_type = attachment.content_type or mimetypes.guess_type(attachment.filename)[0] or ""
            attachments.append(
                {
                    "url": attachment.url,
                    "filename": attachment.filename,
                    "type": content_type,
                    "storage_path": f"discord_media/{message.id}_{index}{Path(attachment.filename).suffix.lower() or '.bin'}",
                }
            )
        known_urls = {item["url"] for item in attachments}
        for embed_index, embed in enumerate(getattr(message, "embeds", ()) or (), start=len(attachments)):
            preview = getattr(embed, "image", None) or getattr(embed, "thumbnail", None)
            preview_url = str(getattr(preview, "url", "") or "") if preview else ""
            if not preview_url or preview_url in known_urls:
                continue
            suffix = Path(urlparse(preview_url).path).suffix.lower()
            content_type = mimetypes.guess_type(suffix)[0] or "image/jpeg"
            attachments.append(
                {
                    "url": preview_url,
                    "filename": f"discord-embed-{message.id}-{embed_index}{suffix or '.jpg'}",
                    "type": content_type,
                    "storage_path": f"discord_media/{message.id}_{embed_index}{suffix or '.jpg'}",
                }
            )
            known_urls.add(preview_url)
        return {
            "platform": "discord",
            "message_id": str(message.id),
            "user_id": str(message.author.id),
            "username": message.author.name,
            "channel_id": str(channel.id),
            "channel_name": _channel_name(channel, self.client.user.id),
            "server_id": str(message.guild.id) if message.guild else "DM",
            "server_name": message.guild.name if message.guild else "Direct Message",
            "is_group": (not is_dm) or len(recipients) > 1,
            "text": message.content or "",
            "timestamp": message.created_at,
            "attachments": attachments,
            "profile_picture_url": _avatar_url(message.author),
        }

    async def _add_link_previews(self, payload: dict) -> None:
        urls = _LINK_RE.findall(payload.get("text") or "")
        if not urls:
            return
        existing = {a.get("url") for a in payload["attachments"]}
        ssl_context = ssl.create_default_context(cafile=certifi.where())
        try:
            async with aiohttp.ClientSession(
                timeout=aiohttp.ClientTimeout(total=8),
                connector=aiohttp.TCPConnector(ssl=ssl_context),
            ) as session:
                for index, raw_url in enumerate(urls[:3], start=len(payload["attachments"])):
                    clean_url = raw_url.rstrip(".,)")
                    host = (urlparse(clean_url).hostname or "").lower()
                    if host not in _PREVIEW_HOSTS or clean_url in existing:
                        continue
                    try:
                        async with session.get(clean_url, allow_redirects=True) as response:
                            if response.status != 200:
                                continue
                            html = await response.text(errors="ignore")
                        match = _OG_IMAGE_RE.search(html)
                        preview_url = unescape(match.group(1)) if match else ""
                        if not preview_url or preview_url in existing:
                            continue
                        suffix = Path(urlparse(preview_url).path).suffix.lower()
                        content_type = mimetypes.guess_type(suffix)[0] or "image/jpeg"
                        payload["attachments"].append(
                            {
                                "url": preview_url,
                                "filename": f"link-preview-{payload['message_id']}-{index}{suffix or '.jpg'}",
                                "type": content_type,
                                "storage_path": f"discord_media/{payload['message_id']}_{index}{suffix or '.jpg'}",
                            }
                        )
                        existing.add(preview_url)
                    except Exception as exc:
                        log.debug("could not resolve Discord link preview %s: %s", clean_url, exc)
        except Exception as exc:
            log.debug("Discord link preview session failed: %s", exc)

    async def start(self) -> None:
        try:
            await self.client.start(self.token)
        except Exception as exc:
            self.error = str(exc)
            log.error("Discord client stopped: %s", exc)

    async def stop(self) -> None:
        if not self.client.is_closed():
            await self.client.close()

    async def send_message(self, channel_id: str, content: str) -> dict:
        try:
            cid = int(channel_id)
        except ValueError:
            return {"ok": False, "error": "invalid_channel_id"}
        if not self.ready:
            return {"ok": False, "error": "discord_not_connected"}
        channel = self.client.get_channel(cid)
        if channel is None:
            try:
                channel = await self.client.fetch_channel(cid)
            except Exception as exc:
                return {"ok": False, "error": f"channel_not_found: {exc}"}
        try:
            sent = await channel.send(content)
        except Exception as exc:
            return {"ok": False, "error": str(exc)}
        try:
            await self.service.record_outgoing(
                {
                    "platform": "discord",
                    "message_id": str(sent.id),
                    "user_id": str(self.client.user.id),
                    "channel_id": str(cid),
                    "channel_name": _channel_name(sent.channel, self.client.user.id),
                    "server_id": str(sent.guild.id) if sent.guild else "DM",
                    "text": content,
                }
            )
        except Exception:
            log.exception("failed to record sent Discord message")
        return {"ok": True, "message_id": str(sent.id)}
