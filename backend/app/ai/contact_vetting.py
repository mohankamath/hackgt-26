"""AI contact vetting: instead of a blanket block on every new sender, the parent gets a
short risk summary, evidence, and a recommendation (approve / watch / block) plus a question
to ask their child. This is the "safe new connections" piece of the product.
"""

from __future__ import annotations

from app import policy
from app.ai import client as ai
from app.ai.thread_analyzer import build_transcript

VETTING_SCHEMA = {
    "type": "object",
    "properties": {
        "recommendation": {"type": "string", "enum": ["approve", "watch", "block"]},
        "risk_level": {"type": "string", "enum": ["none", "low", "medium", "high"]},
        "summary": {"type": "string"},
        "evidence": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "point": {"type": "string"},
                    "message_id": {"type": ["string", "null"]},
                },
                "required": ["point", "message_id"],
                "additionalProperties": False,
            },
        },
        "positive_signals": {"type": "array", "items": {"type": "string"}},
        "suggested_parent_question": {"type": "string"},
    },
    "required": ["recommendation", "risk_level", "summary", "evidence", "positive_signals", "suggested_parent_question"],
    "additionalProperties": False,
}

SYSTEM_PROMPT = """You help a parent decide whether a NEW contact should be allowed to message
their child (aged roughly 8-13) on Discord or Instagram. You see the contact's profile info and
their first messages to the child.

Recommend:
- "approve": looks like a normal peer (classmate, teammate, gaming friend) with no warning signs
- "watch": probably fine or unclear; allow, but keep an eye on the conversation
- "block": clear warning signs (sexual content, asking for photos/secrets/meetups/personal info,
  an adult pursuing a child, scams, threats, harassment)

Be fair: most new contacts are other kids. Don't penalise slang, gaming talk, or typos.
summary: at most 2 short sentences. evidence: 0-4 concrete points; cite a message id from the
transcript when a point comes from a message, otherwise null. positive_signals: 0-3 short
reassuring observations (e.g. "mentions the same school club"). suggested_parent_question:
one friendly question the parent can ask their child, e.g. "How do you know Sam?"."""


def build_prompt(contact: dict, messages: list[dict], thread_risk: dict | None) -> str:
    pfp = contact.get("pfp_moderation") or {}
    pfp_note = "flagged as inappropriate" if pfp.get("status") == "censored" else ("not checked" if not pfp else "looks fine")
    lines = [
        f"Platform: {contact.get('platform')}",
        f"Username: {contact.get('username')}",
        f"Profile picture: {pfp_note}",
        f"Messages sent so far: {contact.get('message_count', len(messages))}",
    ]
    if thread_risk and thread_risk.get("risk_level"):
        lines.append(f"Conversation risk analysis so far: {thread_risk['risk_level']} ({thread_risk.get('summary', '')})")
    lines.append("")
    lines.append("First messages (oldest first):")
    lines.append(build_transcript(messages) or "(no text)")
    return "\n".join(lines)


def parse_result(data: dict, valid_ids: set[str]) -> dict:
    rec = data.get("recommendation")
    if rec not in ("approve", "watch", "block"):
        raise ai.AIError(f"invalid recommendation {rec!r}")
    level = data.get("risk_level")
    if level not in policy.RISK_LEVELS:
        raise ai.AIError(f"invalid risk_level {level!r}")
    summary = str(data.get("summary") or "").strip()
    if not summary:
        raise ai.AIError("missing summary")
    evidence = []
    for e in (data.get("evidence") or [])[:4]:
        if not isinstance(e, dict) or not e.get("point"):
            continue
        mid = e.get("message_id")
        evidence.append({"point": str(e["point"])[:240], "message_id": str(mid) if mid and str(mid) in valid_ids else None})
    return {
        "recommendation": rec,
        "risk_level": level,
        "summary": summary[:400],
        "evidence": evidence,
        "positive_signals": [str(p)[:160] for p in (data.get("positive_signals") or [])[:3]],
        "suggested_parent_question": str(data.get("suggested_parent_question") or "").strip()[:200],
    }


async def vet(contact: dict, messages: list[dict], thread_risk: dict | None = None) -> dict:
    """Raises AIError on failure."""
    data = await ai.structured_completion(
        system=SYSTEM_PROMPT,
        user=build_prompt(contact, messages, thread_risk),
        schema_name="contact_vetting",
        schema=VETTING_SCHEMA,
        max_tokens=700,
    )
    return parse_result(data, {str(m.get("_id") or m.get("doc_id")) for m in messages})
