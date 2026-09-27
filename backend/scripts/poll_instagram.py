"""Run one Instagram poll using the same ingestion service as the API.

Useful for verifying credentials, thread visibility, and message ingestion without
waiting for the background poll interval. Run from ``backend/``.
"""

from __future__ import annotations

import asyncio
import logging

from app.ai import client as ai
from app.config import load_config
from app.db.firestore import FirestoreDB
from app.platforms.instagram import InstagramPlatform
from app.services.ingest import ScreenedService


async def main() -> None:
    config = load_config()
    if not config.instagram_enabled:
        raise SystemExit("Set INSTAGRAM_SESSION_ID or INSTAGRAM_USERNAME and INSTAGRAM_PASSWORD")
    ai.configure(config)
    store = FirestoreDB()
    await asyncio.to_thread(store.init, config)
    service = ScreenedService(store, workers=config.moderation_workers, debounce_seconds=config.thread_debounce_seconds)
    await service.start()
    platform = InstagramPlatform(
        service,
        config.instagram_session_id,
        config.instagram_poll_interval,
        username=config.instagram_username,
        password=config.instagram_password,
        totp_seed=config.instagram_totp_seed,
    )
    try:
        platform.login_method = await asyncio.to_thread(platform.login_sync)
        platform.is_running = True
        platform._seen = await store.existing_message_ids("instagram")
        count = await platform.poll_once()
        logging.getLogger("screened.instagram").info("one-shot poll queued %d message(s)", count)
    finally:
        platform.is_running = False
        await service.stop()


if __name__ == "__main__":
    asyncio.run(main())