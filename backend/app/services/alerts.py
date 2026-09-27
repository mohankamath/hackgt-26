"""Parent alerts (shown live in the dashboard via Firestore onSnapshot)."""

from __future__ import annotations

import logging
import time

from app.util import utcnow

log = logging.getLogger("screened.alerts")

ALERT_TYPES = (
    "new_contact",
    "contact_risk",
    "thread_risk",
    "message_flagged",
    "child_wellbeing",
    "personal_info_shared",
)


class AlertService:
    """Creates alert docs, de-duplicating bursts of the same alert for the same subject."""

    def __init__(self, store, cooldown_seconds: float = 600.0) -> None:
        self._store = store
        self._cooldown = cooldown_seconds
        self._last: dict[tuple, float] = {}

    async def raise_alert(
        self,
        type: str,
        severity: str,
        title: str,
        body: str,
        *,
        thread_id: str | None = None,
        contact_id: str | None = None,
        message_doc_id: str | None = None,
        dedupe: bool = True,
    ) -> str | None:
        key = (type, thread_id or contact_id or message_doc_id)
        now = time.monotonic()
        if dedupe and key in self._last and now - self._last[key] < self._cooldown:
            return None
        self._last[key] = now
        doc = {
            "type": type,
            "severity": severity,
            "title": title,
            "body": body,
            "thread_id": thread_id,
            "contact_id": contact_id,
            "message_doc_id": message_doc_id,
            "read": False,
            "created_at": utcnow(),
        }
        try:
            return await self._store.add_alert(doc)
        except Exception:
            log.exception("failed to save alert %s", type)
            return None
