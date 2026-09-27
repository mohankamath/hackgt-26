"""Thread-level grooming risk analysis (the flagship AI feature).

Single-message filters can't see grooming: each message ("you're so mature", "what school do
you go to?", "don't tell your mom we talk") looks harmless alone. This module sends the recent
conversation to the chat model and asks for a structured risk assessment with evidence.

Scheduling (``ThreadScheduler``):
- debounced per thread (default 30 s) so a burst of messages costs one call
- only runs when there are >= 2 new inbound messages, or any message of medium+ severity,
  or the contact is on "watch" (then every message)
- an alert is raised only when the risk level *escalates*
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Awaitable, Callable

from app import policy
from app.ai import client as ai

log = logging.getLogger("screened.ai.thread")

SIGNAL_TYPES = [
    "flattery",
    "secrecy_request",
    "isolation",
    "gift_offer",
    "platform_move",
    "meetup_request",
    "age_probing",
    "personal_info_request",
    "sexualization",
    "bullying",
    "self_harm_concern",
]

SIGNAL_LABELS = {
    "flattery": "Excessive flattery",
    "secrecy_request": "Asks to keep secrets",
    "isolation": "Isolating from family/friends",
    "gift_offer": "Offers gifts or money",
    "platform_move": "Wants to move to another app",
    "meetup_request": "Wants to meet in person",
    "age_probing": "Asks about age or being alone",
    "personal_info_request": "Asks for personal info",
    "sexualization": "Sexual or romantic talk",
    "bullying": "Bullying",
    "self_harm_concern": "Self-harm concern",
}

THREAD_SCHEMA = {
    "type": "object",
    "properties": {
        "risk_level": {"type": "string", "enum": ["none", "low", "medium", "high"]},
        "risk_score": {"type": "integer", "description": "0-100"},
        "signals": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "type": {"type": "string", "enum": SIGNAL_TYPES},
                    "explanation": {"type": "string"},
                    "evidence_message_ids": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["type", "explanation", "evidence_message_ids"],
                "additionalProperties": False,
            },
        },
        "summary": {"type": "string"},
        "recommended_action": {"type": "string"},
    },
    "required": ["risk_level", "risk_score", "signals", "summary", "recommended_action"],
    "additionalProperties": False,
}

SYSTEM_PROMPT = """You are a child online-safety analyst helping a parent. You review a direct-message
conversation between their child (marked CHILD) and one or more other people, and assess the
risk of grooming, exploitation, bullying, or self-harm across the WHOLE conversation.

Grooming usually builds gradually. Look for patterns such as: excessive flattery or "you're so
mature"; requests for secrecy; isolating the child from parents/friends; gifts, money, or game
currency; moving to another app; requests to meet; probing age, school, location or whether
the child is alone; asking for personal info; romantic or sexual talk. Also flag bullying and
signs the child may be at risk of self-harm.

Be calibrated. Normal friendly chat between kids (games, homework, jokes, mild teasing) is
"none" or "low". Do not invent signals. Every signal must cite the ids of the messages that
show it (use only ids from the transcript).

risk_score: 0-100. none < 15, low 15-39, medium 40-69, high >= 70.
summary: at most 2 short sentences for the parent, plain language, no jargon.
recommended_action: one short sentence telling the parent what to do next (for example,
"Have a calm conversation with your child about this person" or "No action needed")."""


def _speaker(m: dict) -> str:
    return "CHILD" if m.get("direction") == "outgoing" else (m.get("username") or "Unknown")


def build_transcript(messages: list[dict], max_chars: int = 400) -> str:
    lines = []
    for m in messages:
        text = (m.get("message") or "").replace("\n", " ").strip()
        if len(text) > max_chars:
            text = text[:max_chars] + "…"
        if m.get("attachments"):
            text = f"{text} [sent {len(m['attachments'])} attachment(s)]".strip()
        if m.get("status") in ("censored", "needs_review"):
            cats = ", ".join(c.get("label", "") for c in (m.get("moderation") or {}).get("categories", [])[:3])
            text = f"{text} [automatically hidden: {cats or m.get('status')}]"
        lines.append(f"[{m.get('_id') or m.get('doc_id')}] {_speaker(m)}: {text or '(empty)'}")
    return "\n".join(lines)


def parse_result(data: dict, valid_ids: set[str]) -> dict:
    """Validate/normalise the model output. Raises AIError if unusable."""
    level = data.get("risk_level")
    if level not in policy.RISK_LEVELS:
        raise ai.AIError(f"invalid risk_level {level!r}")
    try:
        score = max(0, min(100, int(data.get("risk_score", 0))))
    except (TypeError, ValueError) as exc:
        raise ai.AIError("invalid risk_score") from exc
    signals = []
    for s in data.get("signals") or []:
        if not isinstance(s, dict) or s.get("type") not in SIGNAL_TYPES:
            continue
        ids = [str(i) for i in s.get("evidence_message_ids") or [] if str(i) in valid_ids]
        signals.append(
            {
                "type": s["type"],
                "label": SIGNAL_LABELS[s["type"]],
                "explanation": str(s.get("explanation") or "")[:300],
                "evidence_message_ids": ids,
            }
        )
    summary = str(data.get("summary") or "").strip()
    if not summary:
        raise ai.AIError("missing summary")
    return {
        "risk_level": level,
        "risk_score": score,
        "signals": signals,
        "summary": summary[:500],
        "recommended_action": str(data.get("recommended_action") or "").strip()[:200],
    }


async def analyze(messages: list[dict]) -> dict:
    """Analyze a list of thread messages (oldest first). Raises AIError on failure."""
    if not messages:
        return {"risk_level": "none", "risk_score": 0, "signals": [], "summary": "No messages yet.", "recommended_action": "No action needed."}
    transcript = build_transcript(messages)
    data = await ai.structured_completion(
        system=SYSTEM_PROMPT,
        user=f"Conversation (oldest first):\n{transcript}",
        schema_name="thread_risk",
        schema=THREAD_SCHEMA,
        max_tokens=900,
    )
    return parse_result(data, {str(m.get("_id") or m.get("doc_id")) for m in messages})


def is_escalation(previous_level: str | None, new_level: str) -> bool:
    """Alert only when risk rises to medium or high."""
    return policy.risk_rank(new_level) > policy.risk_rank(previous_level) and policy.risk_rank(new_level) >= policy.risk_rank("medium")


class ThreadScheduler:
    """Debounces analysis per thread. ``runner(thread_id)`` performs the actual analysis."""

    def __init__(self, runner: Callable[[str], Awaitable[None]], debounce_seconds: float = 30.0) -> None:
        self._runner = runner
        self._debounce = debounce_seconds
        self._pending: dict[str, dict] = {}
        self._tasks: dict[str, asyncio.Task] = {}

    def note_message(self, thread_id: str, severity: str = "none", inbound: bool = True, watch: bool = False) -> bool:
        """Record a new message. Returns True if an analysis is (now) scheduled."""
        state = self._pending.setdefault(thread_id, {"new": 0, "urgent": False, "first_at": time.monotonic()})
        if inbound:
            state["new"] += 1
        if policy.severity_rank(severity) >= policy.severity_rank("medium") or watch:
            state["urgent"] = True
        if self.should_run(state):
            self._schedule(thread_id, 0 if state["urgent"] and watch else self._debounce)
            return True
        return False

    @staticmethod
    def should_run(state: dict) -> bool:
        return state["urgent"] or state["new"] >= 2

    def _schedule(self, thread_id: str, delay: float) -> None:
        task = self._tasks.get(thread_id)
        if task and not task.done():
            return  # already scheduled; it will pick up the new messages
        self._tasks[thread_id] = asyncio.create_task(self._run_later(thread_id, delay))

    async def _run_later(self, thread_id: str, delay: float) -> None:
        try:
            if delay:
                await asyncio.sleep(delay)
            self._pending.pop(thread_id, None)
            await self._runner(thread_id)
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("thread analysis failed for %s", thread_id)

    def pending(self, thread_id: str) -> dict | None:
        return self._pending.get(thread_id)

    async def stop(self) -> None:
        for t in self._tasks.values():
            t.cancel()
        await asyncio.gather(*self._tasks.values(), return_exceptions=True)
        self._tasks.clear()
