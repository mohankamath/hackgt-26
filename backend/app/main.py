"""SafeGuard 2.0 FastAPI app.

Run:  cd backend && .venv/bin/python -m app.main     (or: uvicorn app.main:app --reload)

Note: like the original prototype, this API has no authentication. Anyone who can reach the
port can send messages as the child and change contact decisions. Keep it on localhost /
a trusted network for the demo.
"""

from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager
from typing import Literal

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from app.ai import client as ai
from app.ai import coach
from app.config import Config, load_config
from app.db.firestore import FirestoreDB
from app.services.contacts import InvalidStatus
from app.services.ingest import SafeGuardService

log = logging.getLogger("safeguard")


# ── Request models ──────────────────────────────────────────────────


class SendRequest(BaseModel):
    platform: Literal["discord", "instagram"]
    channel_id: str = Field(min_length=1, max_length=64)
    content: str = Field(min_length=1, max_length=2000)


class PreviewRequest(BaseModel):
    text: str = Field(max_length=2000)


class ContactStatusRequest(BaseModel):
    status: Literal["pending", "approved", "watch", "blocked"]


class ReviewRequest(BaseModel):
    status: Literal["safe", "masked", "censored"]


class DigestRequest(BaseModel):
    days: int = Field(default=7, ge=1, le=30)


# ── App factory ─────────────────────────────────────────────────────


def create_app(config: Config | None = None, store: FirestoreDB | None = None, start_platforms: bool = True) -> FastAPI:
    config = config or load_config()
    ai.configure(config)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        db = store
        if db is None:
            db = FirestoreDB()
            await asyncio.to_thread(db.init, config)
        service = SafeGuardService(db, workers=config.moderation_workers, debounce_seconds=config.thread_debounce_seconds)
        await service.start()
        app.state.store = db
        app.state.service = service
        app.state.platforms = {}
        tasks: list[asyncio.Task] = []

        if start_platforms and config.discord_enabled:
            from app.platforms.discord import DiscordPlatform

            discord_p = DiscordPlatform(service, config.discord_token, config.discord_dms_only)
            app.state.platforms["discord"] = discord_p
            tasks.append(asyncio.create_task(discord_p.start()))
        if start_platforms and config.instagram_enabled:
            try:
                from app.platforms.instagram import InstagramPlatform

                ig = InstagramPlatform(
                    service,
                    config.instagram_session_id,
                    config.instagram_poll_interval,
                    username=config.instagram_username,
                    password=config.instagram_password,
                    totp_seed=config.instagram_totp_seed,
                )
                app.state.platforms["instagram"] = ig
                tasks.append(asyncio.create_task(ig.start()))
            except ImportError as exc:
                log.error("instagrapi not installed: %s", exc)

        if not config.openai_enabled:
            log.warning("OPENAI_API_KEY missing: every message will be marked needs_review")
        yield

        for p in app.state.platforms.values():
            try:
                await p.stop()
            except Exception:
                log.exception("error stopping %s", p.name)
        for t in tasks:
            t.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        await service.stop()

    app = FastAPI(title="SafeGuard 2.0 API", version="2.0.0", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=config.cors_origins,
        allow_credentials="*" not in config.cors_origins,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    def svc(request: Request) -> SafeGuardService:
        return request.app.state.service

    def require_store(request: Request) -> None:
        if not request.app.state.store.available:
            raise HTTPException(503, "Firestore is not configured")

    # ── Health ──────────────────────────────────────────────────────

    @app.get("/", tags=["health"])
    async def root():
        return {"name": "SafeGuard 2.0 API", "version": "2.0.0", "docs": "/docs"}

    @app.get("/health", tags=["health"])
    async def health(request: Request):
        platforms = request.app.state.platforms
        d = platforms.get("discord")
        ig = platforms.get("instagram")
        service: SafeGuardService = request.app.state.service
        return {
            "status": "ok",
            "firestore": request.app.state.store.available,
            "openai": {"configured": config.openai_enabled, "model": config.openai_model, "moderation_model": config.moderation_model},
            "discord": {"enabled": config.discord_enabled, "ready": bool(d and d.ready), "user": d.user if d else None, "error": d.error if d else None},
            "instagram": {
                "enabled": config.instagram_enabled,
                "running": bool(ig and ig.is_running),
                "user": ig.user if ig else None,
                "login_method": ig.login_method if ig else None,
                "error": ig.error if ig else None,
            },
            "queue": {"size": service.queue.size, "processed": service.queue.processed, "failed": service.queue.failed},
        }

    # ── Messaging ───────────────────────────────────────────────────

    @app.post("/send", tags=["messages"])
    async def send(body: SendRequest, request: Request):
        platform = request.app.state.platforms.get(body.platform)
        if platform is None:
            raise HTTPException(503, f"{body.platform} is not configured")
        allowed, reason = await svc(request).check_can_send(body.platform, body.channel_id)
        if not allowed:
            raise HTTPException(403, reason)
        result = await platform.send_message(body.channel_id, body.content)
        if not result.get("ok"):
            raise HTTPException(502, result.get("error") or "send failed")
        return {"status": "sent", "platform": body.platform, "message_id": result.get("message_id")}

    @app.post("/moderate/preview", tags=["moderation"])
    async def preview(body: PreviewRequest, request: Request):
        settings = await svc(request).settings.get()
        return await coach.preview_outgoing(body.text, settings["sensitivity"], settings["customKeywords"])

    @app.patch("/messages/{collection}/{doc_id}", tags=["messages"])
    async def review_message(collection: str, doc_id: str, body: ReviewRequest, request: Request):
        require_store(request)
        try:
            return await svc(request).review_message(collection, doc_id, body.status)
        except KeyError:
            raise HTTPException(404, "message not found")
        except ValueError as exc:
            raise HTTPException(400, str(exc))

    @app.get("/media/signed-url", tags=["messages"])
    async def signed_url(path: str, request: Request):
        if not path.startswith(("instagram_media/", "instagram_pfps/")):
            raise HTTPException(400, "invalid path")
        url = await request.app.state.store.signed_url(path)
        if not url:
            raise HTTPException(503, "Firebase Storage is not configured")
        return {"url": url}

    # ── Contacts / threads / digest ─────────────────────────────────

    @app.post("/contacts/{contact_id}/status", tags=["contacts"])
    async def contact_status(contact_id: str, body: ContactStatusRequest, request: Request):
        require_store(request)
        try:
            return await svc(request).set_contact_status(contact_id, body.status)
        except KeyError:
            raise HTTPException(404, "contact not found")
        except InvalidStatus as exc:
            raise HTTPException(400, str(exc))

    @app.post("/contacts/{contact_id}/vet", tags=["contacts"])
    async def vet_contact(contact_id: str, request: Request):
        require_store(request)
        result = await svc(request).vet_contact(contact_id)
        if result is None:
            raise HTTPException(409, "contact not found or vetting already running")
        return result

    @app.post("/threads/{thread_id}/analyze", tags=["threads"])
    async def analyze_thread(thread_id: str, request: Request):
        require_store(request)
        return await svc(request).run_thread_analysis(thread_id)

    @app.post("/digest/generate", tags=["digest"])
    async def generate_digest(request: Request, body: DigestRequest | None = None):
        require_store(request)
        return await svc(request).generate_digest((body or DigestRequest()).days)

    return app


app = create_app()


def run() -> None:
    import uvicorn

    cfg = load_config()
    logging.basicConfig(level=logging.DEBUG if cfg.debug else logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    uvicorn.run("app.main:app", host=cfg.api_host, port=cfg.api_port, reload=cfg.debug)


if __name__ == "__main__":
    run()
