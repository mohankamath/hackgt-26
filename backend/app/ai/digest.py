"""Weekly parent digest: aggregated stats (pure Python) + an AI-written summary with
conversation starters, so the parent talks *with* their child instead of just monitoring."""

from __future__ import annotations

from collections import Counter
from datetime import datetime, timedelta

from app import policy
from app.ai import client as ai

DIGEST_SCHEMA = {
    "type": "object",
    "properties": {
        "headline": {"type": "string"},
        "highlights": {"type": "array", "items": {"type": "string"}},
        "concerns": {"type": "array", "items": {"type": "string"}},
        "positive_connections": {"type": "array", "items": {"type": "string"}},
        "conversation_starters": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["headline", "highlights", "concerns", "positive_connections", "conversation_starters"],
    "additionalProperties": False,
}

SYSTEM_PROMPT = """You write a short weekly digest for a parent about their child's online
messaging, based ONLY on the aggregated stats provided (you never see raw messages). Tone: calm,
warm, balanced; celebrate healthy friendships as much as you flag concerns. No fear-mongering.
headline: one sentence. highlights: 2-4 bullets. concerns: 0-3 bullets (empty if none).
positive_connections: 0-3 bullets about contacts the child talks with in healthy ways.
conversation_starters: exactly 2 open, non-accusatory questions the parent could ask the child
(e.g. "What's the funniest thing that happened in your Minecraft group this week?")."""


def aggregate(messages: list[dict], contacts: list[dict], threads: list[dict], since: datetime, now: datetime) -> dict:
    """Pure aggregation of the last period. Only counts and names, no message content."""
    inbound = [m for m in messages if m.get("direction") != "outgoing"]
    outgoing = [m for m in messages if m.get("direction") == "outgoing"]
    status_counts = Counter(m.get("status", "safe") for m in inbound)
    categories: Counter = Counter()
    for m in inbound:
        for c in (m.get("moderation") or {}).get("categories", []):
            if c.get("category") != "grooming_hint":
                categories[c.get("label") or c.get("category")] += 1

    per_contact: Counter = Counter(m.get("contact_id") for m in inbound if m.get("contact_id"))
    by_id = {c.get("_id"): c for c in contacts}
    top_contacts = []
    for cid, n in per_contact.most_common(5):
        c = by_id.get(cid, {})
        flagged = sum(1 for m in inbound if m.get("contact_id") == cid and m.get("status") in ("censored", "masked"))
        top_contacts.append(
            {"username": c.get("username") or cid, "platform": c.get("platform"), "status": c.get("status"), "messages": n, "flagged": flagged}
        )

    def _after(value) -> bool:
        return isinstance(value, datetime) and value >= since

    new_contacts = [
        {"username": c.get("username"), "status": c.get("status"), "recommendation": (c.get("vetting") or {}).get("recommendation")}
        for c in contacts
        if _after(c.get("first_seen_at"))
    ]
    risky = [
        {"name": t.get("channel_name") or t.get("_id"), "risk_level": t.get("risk_level"), "signals": [s.get("label") for s in t.get("signals", [])][:4]}
        for t in threads
        if policy.risk_rank(t.get("risk_level")) >= policy.risk_rank("medium")
    ]
    days = max(1, (now - since).days)
    return {
        "period_days": days,
        "messages_received": len(inbound),
        "messages_sent": len(outgoing),
        "status_counts": dict(status_counts),
        "top_categories": dict(categories.most_common(5)),
        "top_contacts": top_contacts,
        "new_contacts": new_contacts,
        "risky_threads": risky,
        "safe_rate": round(100 * status_counts.get("safe", 0) / len(inbound)) if inbound else 100,
    }


def parse_result(data: dict) -> dict:
    headline = str(data.get("headline") or "").strip()
    if not headline:
        raise ai.AIError("missing headline")

    def _list(key: str, n: int) -> list[str]:
        return [str(x).strip()[:240] for x in (data.get(key) or []) if str(x).strip()][:n]

    return {
        "headline": headline[:240],
        "highlights": _list("highlights", 4),
        "concerns": _list("concerns", 3),
        "positive_connections": _list("positive_connections", 3),
        "conversation_starters": _list("conversation_starters", 2),
    }


async def write_digest(stats: dict, child_name: str) -> dict:
    import json

    data = await ai.structured_completion(
        system=SYSTEM_PROMPT,
        user=f"Child's name: {child_name}\nStats for the last {stats['period_days']} days:\n{json.dumps(stats, default=str, indent=1)}",
        schema_name="parent_digest",
        schema=DIGEST_SCHEMA,
        temperature=0.4,
        max_tokens=700,
    )
    return parse_result(data)


def period(now: datetime, days: int = 7) -> datetime:
    return now - timedelta(days=days)
