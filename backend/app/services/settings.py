"""Cached access to the parent's settings document (settings/app)."""

from __future__ import annotations

import time

from app import policy

DEFAULT_SETTINGS = {
    "privacyMode": False,
    "customKeywords": [],
    "sensitivity": policy.DEFAULT_SENSITIVITY,
    "childName": "Your child",
    "childAvatar": "",
}


class SettingsCache:
    """Reads settings at most once per ``ttl`` seconds (custom keywords, sensitivity...)."""

    def __init__(self, store, ttl: float = 60.0) -> None:
        self._store = store
        self._ttl = ttl
        self._value: dict | None = None
        self._loaded_at = 0.0

    def invalidate(self) -> None:
        self._value = None

    async def get(self) -> dict:
        now = time.monotonic()
        if self._value is None or now - self._loaded_at > self._ttl:
            try:
                raw = await self._store.get_settings()
            except Exception:
                raw = {}
            merged = {**DEFAULT_SETTINGS, **(raw or {})}
            if merged.get("sensitivity") not in policy.SENSITIVITY_PRESETS:
                merged["sensitivity"] = policy.DEFAULT_SENSITIVITY
            merged["customKeywords"] = [
                str(k).strip().lower() for k in (merged.get("customKeywords") or []) if str(k).strip()
            ]
            self._value = merged
            self._loaded_at = now
        return self._value
