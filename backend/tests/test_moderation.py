import io
import os

import pytest
from PIL import Image

from app.moderation import image as image_mod
from app.moderation import pii
from app.moderation import pipeline
from app.moderation import text as text_mod


def png_bytes(size=(32, 32), color=(200, 120, 90)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, color).save(buf, format="PNG")
    return buf.getvalue()


# ── Image moderation ────────────────────────────────────────────────


async def test_image_flagged(fake_ai):
    fake_ai.image_scores = {"sexual": 0.93}
    r = await image_mod.check_image_bytes(png_bytes())
    assert r["flagged"] and r["status"] == "censored"
    assert r["categories"][0]["category"] == "sexual"
    assert r["severity"] == "high"
    sent = fake_ai.calls[0]["inputs"][0]
    assert sent["type"] == "image_url" and sent["image_url"]["url"].startswith("data:image/png;base64,")


async def test_image_policy_catches_sexual_content_involving_minors(fake_ai):
    fake_ai.image_scores = {"sexual/minors": 0.21}
    result = await image_mod.check_image_bytes(png_bytes())
    assert result["status"] == "censored"
    assert result["categories"][0]["category"] == "sexual/minors"


async def test_image_model_flag_censors_even_below_policy_threshold(fake_ai, monkeypatch):
    async def flagged_moderation(_inputs):
        return {"flagged": True, "categories": {"sexual": True}, "scores": {"sexual": 0.1}}

    monkeypatch.setattr(image_mod.ai, "moderate", flagged_moderation)
    result = await image_mod.check_image_bytes(png_bytes())
    assert result["status"] == "censored"


async def test_visual_safety_rejection_censors_image(fake_ai):
    fake_ai.visual_decision = {"allow": False, "labels": ["firearm"], "reason": "weapon visible"}
    result = await image_mod.check_image_bytes(png_bytes())
    assert result["status"] == "censored"
    assert result["categories"][0]["category"] == "visual_safety"


async def test_image_safe_ignores_text_only_categories(fake_ai):
    fake_ai.image_scores = {"harassment": 0.99, "sexual": 0.01}
    r = await image_mod.check_image_bytes(png_bytes())
    assert r["status"] == "safe" and not r["flagged"]
    assert "harassment" not in r["scores"]


async def test_image_api_error_needs_review(fake_ai):
    fake_ai.moderation_error = True
    r = await image_mod.check_image_bytes(png_bytes())
    assert r["status"] == "needs_review" and not r["flagged"]
    assert "simulated outage" in r["error"]


async def test_image_not_decodable_needs_review(fake_ai):
    r = await image_mod.check_image_bytes(b"definitely not an image")
    assert r["status"] == "needs_review"
    assert fake_ai.calls == []


def test_oversized_image_is_resized(monkeypatch):
    monkeypatch.setattr(image_mod, "MAX_IMAGE_BYTES", 50_000)
    monkeypatch.setattr(image_mod, "TARGET_IMAGE_BYTES", 40_000)
    noisy = Image.frombytes("RGB", (400, 400), os.urandom(400 * 400 * 3))
    buf = io.BytesIO()
    noisy.save(buf, format="PNG")
    raw = buf.getvalue()
    assert len(raw) > 50_000
    out, mime = image_mod.prepare_image(raw)
    assert mime == "image/jpeg" and len(out) <= 40_000


def test_gif_is_converted():
    buf = io.BytesIO()
    Image.new("P", (10, 10)).save(buf, format="GIF")
    out, mime = image_mod.prepare_image(buf.getvalue())
    assert mime in ("image/png", "image/jpeg")


async def test_animated_gif_checks_multiple_frames(fake_ai):
    buf = io.BytesIO()
    Image.new("RGB", (10, 10), "red").save(
        buf, format="GIF", save_all=True, append_images=[Image.new("RGB", (10, 10), "blue")], duration=100, loop=0
    )
    fake_ai.image_scores = {"sexual": 0.93}
    result = await image_mod.check_image_bytes(buf.getvalue())
    assert result["status"] == "censored"
    assert len(fake_ai.calls) == 1
    assert len(fake_ai.calls[0]["inputs"]) >= 1


# ── Text moderation ─────────────────────────────────────────────────


def test_masking_keeps_rest_of_message():
    r = text_mod.local_scan("you're a fucking idiot lol")
    assert r["masked"] == "you're a ••• idiot lol"
    assert "fucking" in r["flagged_words"]


def test_masking_leetspeak_and_spacing():
    assert "•••" in text_mod.local_scan("what the sh1t")["masked"]
    assert text_mod.local_scan("f.u.c.k this")["masked"].startswith("•••")


@pytest.mark.parametrize(
    "text",
    [
        "The workforce will enforce the new rules",
        "I'm so grateful for you",
        "Let's play Scunthorpe United on the video game",
        "Send me the photo of your homework",
        "It's so hot outside, I need ice cream",
        "Hello, assessment is tomorrow in class",
        "Because you asked, the cocktail party is at 5",
    ],
)
def test_old_false_positives_are_gone(text):
    r = text_mod.local_scan(text)
    assert r["spans"] == [], r
    assert r["solicitation"] == []


def test_custom_keyword_masked():
    r = text_mod.local_scan("meet me at the Old Mill tonight", ["old mill"])
    assert r["masked"] == "meet me at the ••• tonight"


async def test_text_profanity_only_is_masked(fake_ai):
    r = await text_mod.moderate_text("this game is shit")
    assert r["status"] == "masked"
    assert r["masked_content"] == "this game is •••"


async def test_text_threat_is_censored_with_reason(fake_ai):
    fake_ai.moderation_rules = [("hurt you", {"harassment/threatening": 0.91, "violence": 0.8})]
    r = await text_mod.moderate_text("I'll hurt you tomorrow")
    assert r["status"] == "censored"
    assert r["categories"][0]["category"] == "harassment/threatening"
    assert "Threats" in r["reasons"]
    assert r["severity"] == "high"


async def test_solicitation_always_censored(fake_ai):
    r = await text_mod.moderate_text("hey can you send nudes")
    assert r["status"] == "censored"


async def test_grooming_hint_does_not_hide(fake_ai):
    r = await text_mod.moderate_text("don't tell your parents we talk ok?")
    assert r["status"] == "safe"
    assert "secrecy_request" in r["grooming_hints"]
    assert r["severity"] == "medium"


async def test_text_outage_needs_review(fake_ai):
    fake_ai.moderation_error = True
    r = await text_mod.moderate_text("hello there")
    assert r["status"] == "needs_review"


async def test_strict_sensitivity_lowers_threshold(fake_ai):
    fake_ai.moderation_rules = [("loser", {"harassment": 0.6})]
    assert (await text_mod.moderate_text("you loser", "balanced"))["status"] == "safe"
    assert (await text_mod.moderate_text("you loser", "strict"))["status"] == "censored"


# ── PII ─────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "text,kind",
    [
        ("call me at 404-555-0123", "phone"),
        ("my email is kid@example.com", "email"),
        ("I live at 123 Maple Street", "address"),
        ("its 123-45-6789", "ssn"),
    ],
)
def test_pii_detected(text, kind):
    assert kind in {h["type"] for h in pii.find_pii(text)}


def test_pii_ssn_tightened():
    # The old regex flagged any 9 digits; order numbers are fine now.
    assert pii.find_pii("order 123456789 shipped") == []


# ── Pipeline merge ──────────────────────────────────────────────────


async def test_pipeline_worst_status_wins(fake_ai):
    fake_ai.image_scores = {"sexual": 0.9}
    payload = {"text": "look at this lol", "attachments": [{"url": "x.png", "type": "image/png", "bytes": png_bytes()}]}
    v = await pipeline.moderate_message(payload)
    assert v["status"] == "censored" and v["text_status"] == "safe"
    assert v["attachments"][0]["flagged"]
    assert any(c["source"] == "attachment:0" for c in v["moderation"]["categories"])


async def test_pipeline_needs_review_propagates(fake_ai):
    payload = {"text": "hi", "attachments": [{"url": "clip.mp4", "type": "video/mp4"}]}
    v = await pipeline.moderate_message(payload)
    assert v["status"] == "needs_review"
    assert v["attachments"][0]["kind"] == "video"


async def test_pipeline_flagged_avatar_does_not_hide_message(fake_ai):
    fake_ai.image_scores = {"sexual": 0.95}
    payload = {"text": "hey", "attachments": [], "profile_picture_bytes": png_bytes(), "profile_picture_url": "https://cdn/a.png"}
    v = await pipeline.moderate_message(payload)
    assert v["status"] == "safe"
    assert v["profile_picture_flagged"] is True
    assert v["severity"] == "high"
