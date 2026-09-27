"""Shared fixtures: an in-memory Firestore stand-in and a scriptable fake OpenAI."""

from __future__ import annotations

import copy
import itertools
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.ai import client as ai  # noqa: E402
from app.ai import coach  # noqa: E402
from app.db import firestore as fs  # noqa: E402


def _ts(v):
    return v.timestamp() if hasattr(v, "timestamp") else 0


class FakeStore:
    """Implements the FirestoreDB methods the service uses, backed by dicts."""

    available = True
    bucket = None

    def __init__(self) -> None:
        self.data: dict[str, dict[str, dict]] = {}
        self.uploads: list[dict] = []
        self._ids = itertools.count(1)
        self.settings: dict = {}

    def coll(self, name: str) -> dict:
        return self.data.setdefault(name, {})

    async def get_settings(self):
        return copy.deepcopy(self.settings)

    async def save_message(self, collection, doc_id, data):
        self.coll(collection)[doc_id] = copy.deepcopy(data)

    async def get_message(self, collection, doc_id):
        d = self.coll(collection).get(doc_id)
        return copy.deepcopy(d) if d else None

    async def update_message(self, collection, doc_id, patch):
        self.coll(collection)[doc_id].update(copy.deepcopy(patch))

    async def existing_message_ids(self, platform):
        return {m["message_id"] for m in self.coll(fs.MESSAGES).values() if m.get("platform") == platform}

    def _with_ids(self, collection):
        return [{**copy.deepcopy(v), "_id": k, "_collection": collection} for k, v in self.coll(collection).items()]

    async def thread_messages(self, thread_id, limit=30):
        items = [m for c in (fs.MESSAGES, fs.SENT_MESSAGES) for m in self._with_ids(c) if m.get("thread_id") == thread_id]
        items.sort(key=lambda m: _ts(m.get("timestamp")))
        return items[-limit:]

    async def contact_messages(self, contact_id, limit=20):
        items = [m for m in self._with_ids(fs.MESSAGES) if m.get("contact_id") == contact_id]
        items.sort(key=lambda m: _ts(m.get("timestamp")))
        return items[:limit]

    async def set_contact_visibility(self, contact_id, visible):
        n = 0
        for m in self.coll(fs.MESSAGES).values():
            if m.get("contact_id") == contact_id:
                if m.get("status") == "blocked" and visible:
                    continue
                m["visible_to_child"] = visible
                n += 1
        return n

    async def messages_since(self, since):
        items = [m for c in (fs.MESSAGES, fs.SENT_MESSAGES) for m in self._with_ids(c) if _ts(m.get("timestamp")) >= since.timestamp()]
        items.sort(key=lambda m: _ts(m.get("timestamp")))
        return items

    async def _get(self, c, i):
        d = self.coll(c).get(i)
        return copy.deepcopy(d) if d is not None else None

    async def _set(self, c, i, data, merge=True):
        if merge and i in self.coll(c):
            self.coll(c)[i].update(copy.deepcopy(data))
        else:
            self.coll(c)[i] = copy.deepcopy(data)

    async def get_contact(self, i):
        return await self._get(fs.CONTACTS, i)

    async def set_contact(self, i, data, merge=True):
        await self._set(fs.CONTACTS, i, data, merge)

    async def list_contacts(self):
        return self._with_ids(fs.CONTACTS)

    async def get_thread(self, i):
        return await self._get(fs.THREADS, i)

    async def set_thread(self, i, data, merge=True):
        await self._set(fs.THREADS, i, data, merge)

    async def list_threads(self):
        return self._with_ids(fs.THREADS)

    async def touch_thread(self, thread_id, data, participant=None):
        t = self.coll(fs.THREADS).setdefault(thread_id, {})
        t.update(copy.deepcopy(data))
        if participant:
            parts = t.setdefault("participants", [])
            if participant not in parts:
                parts.append(participant)

    async def add_alert(self, data):
        i = f"alert{next(self._ids)}"
        self.coll(fs.ALERTS)[i] = copy.deepcopy(data)
        return i

    async def add_digest(self, data):
        i = f"digest{next(self._ids)}"
        self.coll(fs.DIGESTS)[i] = copy.deepcopy(data)
        return i

    async def upload_blob(self, path, data, content_type, public):
        self.uploads.append({"path": path, "public": public, "size": len(data)})
        return f"https://storage.example/{path}" if public else None

    async def make_public(self, path):
        return f"https://storage.example/{path}"

    async def signed_url(self, path, minutes=10):
        return f"https://storage.example/{path}?signed=1"


ZERO_SCORES = {k: 0.0 for k in [
    "sexual", "sexual/minors", "harassment", "harassment/threatening", "hate", "hate/threatening",
    "illicit", "illicit/violent", "self-harm", "self-harm/intent", "self-harm/instructions",
    "violence", "violence/graphic",
]}


def mod_result(scores: dict | None = None) -> dict:
    """Build a moderation result; ``scores`` uses real category names like "self-harm/intent"."""
    s = {**ZERO_SCORES, **(scores or {})}
    return {"flagged": any(v >= 0.5 for v in s.values()), "categories": {k: v >= 0.5 for k, v in s.items()}, "scores": s, "applied_input_types": {}}


class FakeAI:
    """Scriptable replacement for app.ai.client.moderate / structured_completion."""

    def __init__(self) -> None:
        self.moderation_rules: list[tuple[str, dict]] = []  # (substring, scores)
        self.image_scores: dict = {}
        self.moderation_error = False
        self.completions: dict[str, object] = {}  # schema_name -> dict | Exception | callable
        self.calls: list[dict] = []

    async def moderate(self, inputs):
        self.calls.append({"kind": "moderate", "inputs": inputs})
        if self.moderation_error:
            raise ai.AIError("simulated outage")
        item = inputs[0]
        if item["type"] == "image_url":
            return mod_result(self.image_scores)
        text = item["text"].lower()
        for needle, scores in self.moderation_rules:
            if needle in text:
                return mod_result(scores)
        return mod_result()

    async def structured_completion(self, *, system, user, schema_name, schema, **kw):
        self.calls.append({"kind": "completion", "schema": schema_name, "user": user})
        value = self.completions.get(schema_name)
        if callable(value):
            value = value(user)
        if isinstance(value, Exception):
            raise value
        if value is None:
            raise ai.AIError(f"no scripted completion for {schema_name}")
        return copy.deepcopy(value)


@pytest.fixture
def fake_ai(monkeypatch):
    f = FakeAI()
    monkeypatch.setattr(ai, "moderate", f.moderate)
    monkeypatch.setattr(ai, "structured_completion", f.structured_completion)
    coach.clear_cache()
    yield f
    coach.clear_cache()


@pytest.fixture
def store():
    return FakeStore()
