"""Child safety coaching: short, kind, age-appropriate tips instead of silent censorship.

Tips are generated per *situation* (category), not per message, and cached in memory, so
the cost is a handful of LLM calls per process rather than one per message. If the LLM is
unavailable a hand-written fallback is used, so a tip is always returned.
"""

from __future__ import annotations

import logging

from app import policy
from app.ai import client as ai
from app.moderation import pii as pii_mod
from app.moderation import text as text_mod

log = logging.getLogger("safeguard.ai.coach")

# situation key -> (description for the LLM, fallback tip)
SITUATIONS: dict[str, tuple[str, str]] = {
    # Incoming messages
    "in:profanity": (
        "someone sent the child a message with swear words, which were hidden",
        "Some words in this message were hidden. You don't have to reply to people who talk to you that way.",
    ),
    "in:slur": (
        "someone sent the child a message containing a hurtful slur",
        "This message had a hurtful word in it. That's not okay, and it's a good idea to tell a grown-up you trust.",
    ),
    "in:harassment": (
        "someone sent the child a mean or bullying message, which was hidden",
        "This message looked mean, so we hid it. Being bullied is never your fault. Talk to a grown-up you trust.",
    ),
    "in:threat": (
        "someone sent the child a threatening message, which was hidden",
        "This message had a threat in it. You're not in trouble. Please tell a parent or trusted adult right away.",
    ),
    "in:sexual": (
        "someone sent the child sexual content, which was hidden",
        "We hid something that isn't okay for you to see. You did nothing wrong. Let a parent know about it.",
    ),
    "in:self_harm": (
        "someone sent the child content about self-harm, which was hidden",
        "This message talked about getting hurt. If you or a friend feel unsafe, tell a trusted adult. You matter.",
    ),
    "in:violence": (
        "someone sent the child violent content, which was hidden",
        "We hid something violent. If it upset you, it's okay to talk about it with a grown-up.",
    ),
    "in:hate": (
        "someone sent the child hateful content, which was hidden",
        "This message was hateful, so we hid it. Nobody deserves to be treated that way.",
    ),
    "in:solicitation": (
        "someone asked the child for private or sexual photos",
        "Someone asked for private pictures. Never send those, even to people you like. Tell a parent right away.",
    ),
    "in:needs_review": (
        "a message is waiting for a parent to check it",
        "A grown-up is double-checking this message. It'll show up if it's okay.",
    ),
    "in:other": (
        "a message was hidden for safety",
        "We hid this message to keep you safe. You can always ask a grown-up about it.",
    ),
    # Thread-level grooming signals
    "thread:secrecy_request": (
        "someone in a chat is asking the child to keep secrets from their parents",
        "Safe friends don't ask you to keep secrets from your parents. It's always okay to tell them.",
    ),
    "thread:meetup_request": (
        "someone the child knows only online wants to meet in person",
        "Never meet someone from online without a parent. Real friends will understand.",
    ),
    "thread:platform_move": (
        "someone wants the child to move the chat to another app",
        "If someone wants to chat on a different app, check with a parent first.",
    ),
    "thread:personal_info_request": (
        "someone is asking the child for personal details like address, school, or phone number",
        "Keep your address, school, and phone number private online. Ask a parent before sharing.",
    ),
    "thread:gift_offer": (
        "someone online is offering the child gifts, money, or game currency",
        "Be careful when someone online offers gifts or free stuff. Tell a parent about it.",
    ),
    "thread:age_probing": (
        "someone is asking the child about their age or whether they are home alone",
        "You don't have to tell people online your age or if you're home alone.",
    ),
    "thread:other": (
        "a conversation shows some warning signs of an unsafe online relationship",
        "Something in this chat seems off. Trust your feelings and talk to a parent about it.",
    ),
    # Outgoing messages (send preview)
    "out:pii": (
        "the child is about to send personal information (phone, address, email, school)",
        "Looks like you're sharing personal info. Only share it with people you know in real life.",
    ),
    "out:unkind": (
        "the child is about to send an unkind or rude message",
        "This might hurt someone's feelings. Want to say it a different way?",
    ),
    "out:self_harm": (
        "the child is about to send a message suggesting they may want to hurt themselves",
        "It sounds like you might be going through something hard. You're not alone. Please talk to a trusted adult.",
    ),
    "out:sexual": (
        "the child is about to send sexual content",
        "This isn't safe to send. Once something is sent, you can't take it back.",
    ),
    "out:other": (
        "the child is about to send something that could get flagged",
        "Take a second to double-check this message before you send it.",
    ),
}

_TIP_SCHEMA = {
    "type": "object",
    "properties": {"tip": {"type": "string"}},
    "required": ["tip"],
    "additionalProperties": False,
}

_SYSTEM = (
    "You are a warm, calm online-safety coach for kids aged 8 to 13. Write ONE tip of at most "
    "28 words, in simple words a 9-year-old understands. Never shame or scare the child, never "
    "blame them, never mention AI or moderation systems, and do not quote harmful content. When "
    "it fits, gently suggest talking to a parent or trusted adult."
)

_cache: dict[str, str] = {}


def clear_cache() -> None:
    _cache.clear()


def _situation(key: str) -> tuple[str, str]:
    prefix = key.split(":", 1)[0]
    return SITUATIONS.get(key) or SITUATIONS.get(f"{prefix}:other") or SITUATIONS["in:other"]


def fallback_tip(key: str) -> str:
    return _situation(key)[1]


async def tip_for(key: str) -> str:
    if key in _cache:
        return _cache[key]
    description = _situation(key)[0]
    try:
        data = await ai.structured_completion(
            system=_SYSTEM,
            user=f"Situation: {description}. Write the tip.",
            schema_name="coach_tip",
            schema=_TIP_SCHEMA,
            temperature=0.4,
            max_tokens=120,
        )
        tip = str(data.get("tip") or "").strip()
        if not tip:
            raise ai.AIError("empty tip")
    except ai.AIError as exc:
        log.info("coach tip fallback for %s: %s", key, exc)
        return fallback_tip(key)  # don't cache failures; try the LLM again next time
    _cache[key] = tip
    return tip


_CATEGORY_TO_SITUATION = {
    "sexual_solicitation": "solicitation",
    "sexual": "sexual",
    "sexual/minors": "sexual",
    "harassment/threatening": "threat",
    "hate/threatening": "threat",
    "illicit/violent": "threat",
    "harassment": "harassment",
    "hate": "hate",
    "self-harm": "self_harm",
    "self-harm/intent": "self_harm",
    "self-harm/instructions": "self_harm",
    "violence": "violence",
    "violence/graphic": "violence",
    "slur": "slur",
    "profanity": "profanity",
    "custom_keyword": "profanity",
}


def situation_for_message(verdict: dict) -> str | None:
    """Pick the coaching situation for an incoming message verdict (pure)."""
    status = verdict.get("status")
    if status not in ("censored", "masked", "needs_review"):
        return None
    if status == "needs_review":
        return "in:needs_review"
    cats = [c for c in verdict.get("moderation", {}).get("categories", []) if c.get("source", "text") != "profile_picture"]
    ordered = sorted(cats, key=lambda c: (policy.severity_rank(c.get("severity")), c.get("score", 0)), reverse=True)
    for c in ordered:
        situation = _CATEGORY_TO_SITUATION.get(c.get("category"))
        if situation:
            return f"in:{situation}"
    return "in:other"


async def tip_for_message(verdict: dict) -> str | None:
    key = situation_for_message(verdict)
    return await tip_for(key) if key else None


def situation_for_signals(signal_types: list[str]) -> str:
    priority = [
        "secrecy_request", "meetup_request", "personal_info_request", "platform_move",
        "gift_offer", "age_probing",
    ]
    for p in priority:
        if p in signal_types:
            return f"thread:{p}"
    return "thread:other"


def _outgoing_situation(text_verdict: dict, pii_hits: list[dict]) -> str | None:
    cats = {c["category"] for c in text_verdict.get("categories", [])}
    if cats & {"self-harm", "self-harm/intent", "self-harm/instructions"}:
        return "out:self_harm"
    if pii_hits:
        return "out:pii"
    if cats & {"sexual", "sexual/minors", "sexual_solicitation"}:
        return "out:sexual"
    if cats & {"harassment", "harassment/threatening", "hate", "hate/threatening", "slur", "profanity", "custom_keyword"}:
        return "out:unkind"
    if text_verdict.get("status") in ("censored", "masked"):
        return "out:other"
    return None


async def preview_outgoing(text: str, sensitivity: str, custom_keywords: list[str]) -> dict:
    """Check a message the child is about to send. Advisory: the child can still send it."""
    pii_hits = pii_mod.find_pii(text)
    verdict = await text_mod.moderate_text(text, sensitivity, custom_keywords)
    warnings = [
        {"type": "sensitive", "label": f"Possible {h['label'].lower()}", "match": h["match"]} for h in pii_hits
    ]
    for c in verdict["categories"]:
        if c["category"] == "grooming_hint":
            continue
        warnings.append({"type": "inappropriate", "label": c["label"], "match": None})
    key = _outgoing_situation(verdict, pii_hits)
    tip = await tip_for(key) if key else None
    return {
        "status": verdict["status"],
        "ok": not warnings,
        "warnings": warnings,
        "pii": [{"type": h["type"], "label": h["label"], "match": h["match"]} for h in pii_hits],
        "categories": verdict["categories"],
        "severity": verdict["severity"],
        "tip": tip,
        "check_unavailable": verdict["status"] == "needs_review",
    }
