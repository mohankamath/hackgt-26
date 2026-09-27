"""Contact rules, enforced in the backend (the old app only filtered in the browser).

Statuses:
    pending   new sender; messages saved but hidden from the child until a parent decides
    approved  child sees messages
    watch     child sees messages; the thread analyzer re-runs on every message
    blocked   messages saved with status "blocked" and never shown to the child
"""

from __future__ import annotations

from datetime import datetime, timedelta

from app.util import strip_query

CONTACT_STATUSES = ("pending", "approved", "watch", "blocked")
VISIBLE_STATUSES = ("approved", "watch")
REVET_EVERY = 3
PFP_CACHE_TTL = timedelta(hours=24)


class InvalidStatus(ValueError):
    pass


def validate_status(status: str) -> str:
    if status not in CONTACT_STATUSES:
        raise InvalidStatus(f"status must be one of {', '.join(CONTACT_STATUSES)}")
    return status


def new_contact(payload: dict, now: datetime) -> dict:
    return {
        "platform": payload["platform"],
        "user_id": str(payload["user_id"]),
        "username": payload.get("username") or "Unknown",
        "profile_picture": None,
        "status": "pending",
        "message_count": 0,
        "first_seen_at": now,
        "last_message_at": now,
        "threads": [],
        "vetting": None,
    }


def visible_to_child(contact_status: str | None, message_status: str) -> bool:
    return contact_status in VISIBLE_STATUSES and message_status != "blocked"


def should_revet(contact: dict, every: int = REVET_EVERY) -> bool:
    """Re-run AI vetting while the parent hasn't decided: first message, then every ``every``."""
    if contact.get("status") != "pending":
        return False
    count = int(contact.get("message_count") or 0)
    vetting = contact.get("vetting") or {}
    vetted_at_count = vetting.get("message_count_at_vet")
    if vetted_at_count is None:
        return count >= 1
    return count - int(vetted_at_count) >= every


def pfp_cache_valid(contact: dict | None, source_url: str | None, now: datetime, ttl: timedelta = PFP_CACHE_TTL) -> bool:
    """Reuse a stored avatar verdict only if it's for the same picture and recent enough."""
    if not contact or not source_url:
        return False
    mod = contact.get("pfp_moderation") or {}
    checked_at = mod.get("checked_at")
    if not mod or not isinstance(checked_at, datetime):
        return False
    if mod.get("source") != strip_query(source_url):
        return False
    if mod.get("status") == "needs_review":  # retry failed checks
        return False
    return now - checked_at < ttl


def can_send(participant_statuses: list[str | None]) -> tuple[bool, str | None]:
    """Child may only message a thread with at least one approved/watched contact and no blocked ones."""
    statuses = [s for s in participant_statuses if s]
    if any(s == "blocked" for s in statuses):
        return False, "This contact is blocked"
    if statuses and not any(s in VISIBLE_STATUSES for s in statuses):
        return False, "Waiting for a parent to approve this contact"
    return True, None
