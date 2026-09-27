"""Firestore / Firebase Storage persistence. No moderation logic lives here.

Every blocking SDK call runs in a worker thread (``asyncio.to_thread``) so Firestore
latency never stalls the Discord / Instagram listeners on the event loop.

Queries deliberately avoid composite indexes (equality filter + in-memory sort, or a
single-field range) so the project works on a fresh Firebase project with no index setup.
"""

from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Any

from app.config import BACKEND_DIR, Config

log = logging.getLogger("screened.db")

MESSAGES = "messages"
SENT_MESSAGES = "sent_messages"
CONTACTS = "contacts"
THREADS = "threads"
ALERTS = "alerts"
DIGESTS = "digests"
SETTINGS = "settings"
SETTINGS_DOC = "app"


def _ts(value: Any) -> float:
    if isinstance(value, datetime):
        return value.timestamp()
    return 0.0


class FirestoreDB:
    def __init__(self) -> None:
        self.db = None
        self.bucket = None
        self.error: str | None = None

    @property
    def available(self) -> bool:
        return self.db is not None

    # ── Setup ──────────────────────────────────────────────────────

    def init(self, config: Config) -> None:
        try:
            import firebase_admin
            from firebase_admin import credentials, firestore, storage

            if not firebase_admin._apps:
                options = {"storageBucket": config.firebase_storage_bucket} if config.firebase_storage_bucket else {}
                cred_path = self._resolve_credentials(config.firestore_credentials_path)
                if not cred_path and not os.environ.get("GOOGLE_APPLICATION_CREDENTIALS"):
                    # Without this guard google-auth probes the GCE metadata server and startup stalls.
                    raise RuntimeError("no Firebase credentials (set FIRESTORE_CREDENTIALS_PATH)")
                if cred_path:
                    firebase_admin.initialize_app(credentials.Certificate(cred_path), options)
                else:
                    firebase_admin.initialize_app(options=options or None)
            self.db = firestore.client(database_id=config.firestore_database_id)
            if config.firebase_storage_bucket:
                try:
                    self.bucket = storage.bucket()
                except Exception as exc:  # storage is optional
                    log.warning("Firebase Storage unavailable: %s", exc)
            log.info("Firestore initialized")
        except Exception as exc:
            self.db = None
            self.error = str(exc)
            log.warning("Firestore unavailable (%s). Messages will not be persisted.", exc)

    @staticmethod
    def _resolve_credentials(path: str) -> str | None:
        if not path:
            return None
        candidates = [path] if os.path.isabs(path) else [BACKEND_DIR / path, BACKEND_DIR.parent / path, path]
        for c in candidates:
            if os.path.exists(c):
                return str(c)
        log.warning("FIRESTORE_CREDENTIALS_PATH %s not found; trying default credentials", path)
        return None

    async def _run(self, fn, *args, **kwargs):
        return await asyncio.to_thread(fn, *args, **kwargs)

    # ── Settings ───────────────────────────────────────────────────

    async def get_settings(self) -> dict:
        if not self.available:
            return {}
        snap = await self._run(self.db.collection(SETTINGS).document(SETTINGS_DOC).get)
        return (snap.to_dict() or {}) if snap.exists else {}

    # ── Messages ───────────────────────────────────────────────────

    async def save_message(self, collection: str, doc_id: str, data: dict) -> None:
        if not self.available:
            return
        await self._run(self.db.collection(collection).document(doc_id).set, data)

    async def get_message(self, collection: str, doc_id: str) -> dict | None:
        if not self.available:
            return None
        snap = await self._run(self.db.collection(collection).document(doc_id).get)
        return snap.to_dict() if snap.exists else None

    async def update_message(self, collection: str, doc_id: str, patch: dict) -> None:
        if not self.available:
            return
        await self._run(self.db.collection(collection).document(doc_id).update, patch)

    async def existing_message_ids(self, platform: str) -> set[str]:
        if not self.available:
            return set()

        def _load() -> set[str]:
            q = self.db.collection(MESSAGES).where("platform", "==", platform).select(["message_id"])
            return {str(d.get("message_id")) for d in q.stream() if d.get("message_id")}

        return await self._run(_load)

    def _stream_where(self, collection: str, field: str, value: Any) -> list[dict]:
        out = []
        for d in self.db.collection(collection).where(field, "==", value).stream():
            item = d.to_dict() or {}
            item["_id"] = d.id
            item["_collection"] = collection
            out.append(item)
        return out

    async def thread_messages(self, thread_id: str, limit: int = 30) -> list[dict]:
        """Most recent ``limit`` messages in a thread (both directions), oldest first."""
        if not self.available:
            return []

        def _load() -> list[dict]:
            items = self._stream_where(MESSAGES, "thread_id", thread_id) + self._stream_where(
                SENT_MESSAGES, "thread_id", thread_id
            )
            items.sort(key=lambda m: _ts(m.get("timestamp")))
            return items[-limit:]

        return await self._run(_load)

    async def contact_messages(self, contact_id: str, limit: int = 20) -> list[dict]:
        """Earliest ``limit`` inbound messages from a contact, oldest first."""
        if not self.available:
            return []

        def _load() -> list[dict]:
            items = self._stream_where(MESSAGES, "contact_id", contact_id)
            items.sort(key=lambda m: _ts(m.get("timestamp")))
            return items[:limit]

        return await self._run(_load)

    async def set_contact_visibility(self, contact_id: str, visible: bool) -> int:
        """Flip ``visible_to_child`` on every non-blocked message from a contact."""
        if not self.available:
            return 0

        def _update() -> int:
            batch, n = self.db.batch(), 0
            for d in self.db.collection(MESSAGES).where("contact_id", "==", contact_id).stream():
                data = d.to_dict() or {}
                if data.get("status") == "blocked" and visible:
                    continue
                batch.update(d.reference, {"visible_to_child": visible})
                n += 1
                if n % 450 == 0:
                    batch.commit()
                    batch = self.db.batch()
            batch.commit()
            return n

        return await self._run(_update)

    async def messages_since(self, since: datetime) -> list[dict]:
        if not self.available:
            return []

        def _load() -> list[dict]:
            out = []
            for coll in (MESSAGES, SENT_MESSAGES):
                for d in self.db.collection(coll).where("timestamp", ">=", since).stream():
                    item = d.to_dict() or {}
                    item["_id"] = d.id
                    item["_collection"] = coll
                    out.append(item)
            out.sort(key=lambda m: _ts(m.get("timestamp")))
            return out

        return await self._run(_load)

    # ── Contacts / threads ─────────────────────────────────────────

    async def _get(self, collection: str, doc_id: str) -> dict | None:
        if not self.available:
            return None
        snap = await self._run(self.db.collection(collection).document(doc_id).get)
        return snap.to_dict() if snap.exists else None

    async def _set(self, collection: str, doc_id: str, data: dict, merge: bool = True) -> None:
        if not self.available:
            return
        await self._run(self.db.collection(collection).document(doc_id).set, data, merge=merge)

    async def _list(self, collection: str) -> list[dict]:
        if not self.available:
            return []

        def _load() -> list[dict]:
            return [{**(d.to_dict() or {}), "_id": d.id} for d in self.db.collection(collection).stream()]

        return await self._run(_load)

    async def get_contact(self, contact_id: str) -> dict | None:
        return await self._get(CONTACTS, contact_id)

    async def set_contact(self, contact_id: str, data: dict, merge: bool = True) -> None:
        await self._set(CONTACTS, contact_id, data, merge)

    async def list_contacts(self) -> list[dict]:
        return await self._list(CONTACTS)

    async def get_thread(self, thread_id: str) -> dict | None:
        return await self._get(THREADS, thread_id)

    async def set_thread(self, thread_id: str, data: dict, merge: bool = True) -> None:
        await self._set(THREADS, thread_id, data, merge)

    async def list_threads(self) -> list[dict]:
        return await self._list(THREADS)

    async def touch_thread(self, thread_id: str, data: dict, participant: str | None = None) -> None:
        """Merge thread metadata and add a participant contact id (no read needed)."""
        if not self.available:
            return
        from firebase_admin import firestore

        patch = dict(data)
        if participant:
            patch["participants"] = firestore.ArrayUnion([participant])
        await self._run(self.db.collection(THREADS).document(thread_id).set, patch, merge=True)

    # ── Alerts / digests ───────────────────────────────────────────

    async def _add(self, collection: str, data: dict) -> str | None:
        if not self.available:
            return None
        ref = self.db.collection(collection).document()
        await self._run(ref.set, data)
        return ref.id

    async def add_alert(self, data: dict) -> str | None:
        return await self._add(ALERTS, data)

    async def add_digest(self, data: dict) -> str | None:
        return await self._add(DIGESTS, data)

    # ── Storage ────────────────────────────────────────────────────

    async def upload_blob(self, path: str, data: bytes, content_type: str, public: bool) -> str | None:
        """Upload bytes. Public blobs return their public URL; private ones return None."""
        if self.bucket is None:
            return None

        def _upload() -> str | None:
            blob = self.bucket.blob(path)
            blob.upload_from_string(data, content_type=content_type)
            if public:
                blob.make_public()
                return blob.public_url
            return None

        return await self._run(_upload)

    async def make_public(self, path: str) -> str | None:
        if self.bucket is None:
            return None

        def _pub() -> str:
            blob = self.bucket.blob(path)
            blob.make_public()
            return blob.public_url

        return await self._run(_pub)

    async def signed_url(self, path: str, minutes: int = 10) -> str | None:
        if self.bucket is None:
            return None

        def _sign() -> str:
            return self.bucket.blob(path).generate_signed_url(expiration=timedelta(minutes=minutes))

        return await self._run(_sign)


def utcnow() -> datetime:
    return datetime.now(timezone.utc)
