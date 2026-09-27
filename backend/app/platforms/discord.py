"""Discord adapter (discord.py-self user-account client, same approach as the original).

Changes from the original:
- the listener only builds a payload and queues it; moderation happens on queue workers
- uses the real ``message.created_at`` (timezone-aware) instead of the save time
- by default only DMs / group DMs are ingested (DISCORD_DMS_ONLY=true); set it to false to
  also ingest server channels like the original did
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

import discord

if TYPE_CHECKING:
    from app.services.ingest import SafeGuardService

log = logging.getLogger("safeguard.discord")


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

    def __init__(self, service: "SafeGuardService", token: str, dms_only: bool = True) -> None:
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
                await self.service.submit(self.build_payload(message))
            except Exception:
                log.exception("failed to queue Discord message")

    def build_payload(self, message: discord.Message) -> dict:
        channel = message.channel
        is_dm = message.guild is None
        recipients = getattr(channel, "recipients", None) or []
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
            "attachments": [
                {"url": a.url, "filename": a.filename, "type": a.content_type or ""} for a in message.attachments
            ],
            "profile_picture_url": _avatar_url(message.author),
        }

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
