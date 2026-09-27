"""End-to-end service + API tests with the in-memory store and fake OpenAI."""

import asyncio
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app.config import Config
from app.db import firestore as fs
from app.main import create_app
from app.services.ingest import SafeGuardService

T0 = datetime(2026, 9, 26, 12, 0, tzinfo=timezone.utc)

THREAD_HIGH = {
    "risk_level": "high",
    "risk_score": 82,
    "signals": [{"type": "secrecy_request", "explanation": "asks to hide chats", "evidence_message_ids": ["discord:2"]}],
    "summary": "This person asks your child to keep secrets.",
    "recommended_action": "Talk with your child.",
}
VET_BLOCK = {
    "recommendation": "block",
    "risk_level": "high",
    "summary": "Adult-like stranger asking for secrecy.",
    "evidence": [{"point": "Asks for secrecy", "message_id": None}],
    "positive_signals": [],
    "suggested_parent_question": "Do you know this person in real life?",
}


def payload(i, text, user="99", **extra):
    return {
        "platform": "discord",
        "message_id": str(i),
        "user_id": user,
        "username": f"user{user}",
        "channel_id": "555",
        "channel_name": f"user{user}",
        "text": text,
        "timestamp": T0 + timedelta(minutes=i),
        "attachments": [],
        "profile_picture_url": None,
        **extra,
    }


@pytest.fixture
def service(store, fake_ai):
    fake_ai.completions.update({"thread_risk": THREAD_HIGH, "contact_vetting": VET_BLOCK, "coach_tip": {"tip": "Talk to a parent."}})
    return SafeGuardService(store, workers=1, debounce_seconds=0.01)


async def settle(service):
    await asyncio.sleep(0.05)
    await asyncio.gather(*list(service._background), return_exceptions=True)
    await asyncio.sleep(0.05)


async def test_new_contact_is_pending_and_hidden(service, store):
    doc = await service.process_inbound(payload(1, "hey whats up"))
    assert doc["visible_to_child"] is False and doc["status"] == "safe"
    assert store.coll(fs.CONTACTS)["discord:99"]["status"] == "pending"
    assert store.coll(fs.THREADS)["discord:555"]["participants"] == ["discord:99"]
    alerts = list(store.coll(fs.ALERTS).values())
    assert alerts[0]["type"] == "new_contact"
    await settle(service)
    vet = store.coll(fs.CONTACTS)["discord:99"]["vetting"]
    assert vet["recommendation"] == "block" and vet["message_count_at_vet"] == 1
    assert any(a["type"] == "contact_risk" for a in store.coll(fs.ALERTS).values())
    await service.stop()


async def test_approve_then_block_flow(service, store):
    await service.process_inbound(payload(1, "hi"))
    r = await service.set_contact_status("discord:99", "approved")
    assert r["messages_updated"] == 1
    assert store.coll(fs.MESSAGES)["discord:1"]["visible_to_child"] is True
    doc = await service.process_inbound(payload(2, "what game are you playing"))
    assert doc["visible_to_child"] is True

    await service.set_contact_status("discord:99", "blocked")
    assert store.coll(fs.MESSAGES)["discord:1"]["visible_to_child"] is False
    doc = await service.process_inbound(payload(3, "why did you block me"))
    assert doc["status"] == "blocked" and doc["visible_to_child"] is False
    await service.stop()


async def test_blocked_sender_skips_ai(service, store, fake_ai):
    await store.set_contact("discord:99", {"platform": "discord", "user_id": "99", "status": "blocked", "message_count": 5})
    fake_ai.calls.clear()
    doc = await service.process_inbound(payload(1, "you there?"))
    assert doc["status"] == "blocked"
    assert fake_ai.calls == []
    await service.stop()


async def test_masked_and_censored_messages_get_tips(service, store, fake_ai):
    await store.set_contact("discord:99", {"platform": "discord", "user_id": "99", "status": "approved", "message_count": 0, "threads": []})
    masked = await service.process_inbound(payload(1, "this level is shit"))
    assert masked["status"] == "masked" and masked["masked_content"] == "this level is •••"
    assert masked["coach_tip"] == "Talk to a parent."

    fake_ai.moderation_rules = [("hurt you", {"harassment/threatening": 0.95})]
    censored = await service.process_inbound(payload(2, "i will hurt you"))
    assert censored["status"] == "censored" and censored["censored"] is True
    assert any(a["type"] == "message_flagged" for a in store.coll(fs.ALERTS).values())
    await service.stop()


async def test_flagged_attachment_is_not_public(service, store, fake_ai, monkeypatch):
    from app.moderation import image as image_mod
    from tests.test_moderation import png_bytes

    async def fake_download(url, session=None):
        return png_bytes()

    monkeypatch.setattr(image_mod, "download_bytes", fake_download)
    fake_ai.image_scores = {"sexual": 0.97}
    await store.set_contact("discord:99", {"platform": "discord", "user_id": "99", "status": "approved", "message_count": 0})
    p = payload(1, "", attachments=[{"url": "https://ig/x.jpg", "filename": "x.jpg", "type": "image/jpeg", "storage_path": "instagram_media/1.jpg"}])
    doc = await service.process_inbound(p)
    att = doc["attachments"][0]
    assert doc["status"] == "censored"
    assert att["url"] is None and att["flagged"] and att["storage_path"] == "instagram_media/1.jpg"
    assert store.uploads == [{"path": "instagram_media/1.jpg", "public": False, "size": len(png_bytes())}]

    # Parent reviews and marks it safe -> becomes public
    r = await service.review_message(fs.MESSAGES, "discord:1", "safe")
    assert r["attachments"][0]["url"].startswith("https://storage.example/")
    await service.stop()


async def test_avatar_cached_and_rechecked_on_change(service, store, fake_ai, monkeypatch):
    from app.moderation import image as image_mod
    from tests.test_moderation import png_bytes

    async def fake_download(url, session=None):
        return png_bytes()

    monkeypatch.setattr(image_mod, "download_bytes", fake_download)
    await service.process_inbound(payload(1, "hi", profile_picture_url="https://cdn/a.png"))
    n_img = lambda: sum(1 for c in fake_ai.calls if c["kind"] == "moderate" and c["inputs"][0]["type"] == "image_url")
    assert n_img() == 1
    await service.process_inbound(payload(2, "hi again", profile_picture_url="https://cdn/a.png"))
    assert n_img() == 1  # cached
    fake_ai.image_scores = {"sexual": 0.9}
    doc = await service.process_inbound(payload(3, "new pfp", profile_picture_url="https://cdn/b.png"))
    assert n_img() == 2  # re-checked because it changed
    assert doc["profile_picture"] is None and doc["profile_picture_flagged"] is True
    await service.stop()


async def test_thread_analysis_escalation_alert(service, store):
    await store.set_contact("discord:99", {"platform": "discord", "user_id": "99", "status": "approved", "message_count": 0})
    await service.process_inbound(payload(1, "you're so mature for your age"))
    await service.process_inbound(payload(2, "dont tell your mom we talk"))
    await settle(service)
    thread = store.coll(fs.THREADS)["discord:555"]
    assert thread["risk_level"] == "high" and thread["analysis_status"] == "ok"
    assert thread["signals"][0]["evidence_message_ids"] == ["discord:2"]
    assert thread["child_tip"]
    assert [a for a in store.coll(fs.ALERTS).values() if a["type"] == "thread_risk"]
    # Re-running at the same level does not alert again
    before = len(store.coll(fs.ALERTS))
    await service.run_thread_analysis("discord:555")
    assert len(store.coll(fs.ALERTS)) == before
    await service.stop()


async def test_thread_analysis_failure_needs_review(service, store, fake_ai):
    from app.ai import client as ai

    fake_ai.completions["thread_risk"] = ai.AIError("bad json")
    await service.process_inbound(payload(1, "hello"))
    t = await service.run_thread_analysis("discord:555")
    assert t["analysis_status"] == "needs_review"
    await service.stop()


async def test_outgoing_pii_alert(service, store):
    doc = await service.record_outgoing({"platform": "discord", "channel_id": "555", "text": "my number is 404-555-0199"})
    assert doc["message_id"].startswith("sent-") and doc["direction"] == "outgoing"
    assert doc["pii"][0]["type"] == "phone"
    assert any(a["type"] == "personal_info_shared" for a in store.coll(fs.ALERTS).values())
    await service.stop()


async def test_digest_generation(service, store, fake_ai):
    fake_ai.completions["parent_digest"] = {
        "headline": "A calm week.",
        "highlights": ["Mostly chatted with friends"],
        "concerns": [],
        "positive_connections": ["user99"],
        "conversation_starters": ["What was fun this week?", "Who did you game with?"],
    }
    await service.process_inbound(payload(1, "gg"))
    d = await service.generate_digest(7)
    assert d["status"] == "ok" and d["stats"]["messages_received"] == 1
    assert store.coll(fs.DIGESTS)
    await service.stop()


# ── HTTP API ────────────────────────────────────────────────────────


@pytest.fixture
def client(store, fake_ai):
    fake_ai.completions["coach_tip"] = {"tip": "Keep it private."}
    app = create_app(Config(), store=store, start_platforms=False)
    with TestClient(app) as c:
        yield c


def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["firestore"] is True
    assert body["discord"]["enabled"] is False and body["instagram"]["enabled"] is False
    assert body["openai"]["configured"] is False


def test_preview_endpoint(client):
    r = client.post("/moderate/preview", json={"text": "text me 404-555-0123"})
    assert r.status_code == 200
    assert r.json()["pii"][0]["type"] == "phone"
    assert r.json()["tip"] == "Keep it private."


def test_send_requires_platform(client):
    r = client.post("/send", json={"platform": "discord", "channel_id": "1", "content": "hi"})
    assert r.status_code == 503


def test_contact_status_endpoint(client, store):
    asyncio.run(store.set_contact("discord:7", {"status": "pending", "threads": []}))
    assert client.post("/contacts/discord:7/status", json={"status": "approved"}).status_code == 200
    assert store.coll(fs.CONTACTS)["discord:7"]["status"] == "approved"
    assert client.post("/contacts/discord:8/status", json={"status": "approved"}).status_code == 404
    assert client.post("/contacts/discord:7/status", json={"status": "friend"}).status_code == 422


def test_review_endpoint_validates(client):
    assert client.patch("/messages/nope/x", json={"status": "safe"}).status_code == 400
    assert client.patch("/messages/messages/missing", json={"status": "safe"}).status_code == 404


def test_signed_url_path_guard(client):
    assert client.get("/media/signed-url", params={"path": "../secrets"}).status_code == 400
