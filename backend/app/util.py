"""Small pure helpers shared across the backend."""

from __future__ import annotations

from datetime import datetime, timezone


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def normalize_timestamp(value: object, naive_is_local: bool = True) -> datetime:
    """Return a timezone-aware UTC datetime for whatever a platform gives us.

    - aware datetime -> converted to UTC
    - naive datetime -> interpreted as local time (instagrapi builds naive local datetimes
      via ``datetime.fromtimestamp``; the old code papered over this with ``+ timedelta(hours=5)``)
      or as UTC when ``naive_is_local`` is False
    - int/float epoch in seconds, milliseconds, or microseconds
    - None / unparseable -> now (UTC)
    """
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.astimezone(timezone.utc) if naive_is_local else value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        v = float(value)
        if v > 1e17:  # nanoseconds
            v /= 1e9
        elif v > 1e14:  # microseconds
            v /= 1e6
        elif v > 1e11:  # milliseconds
            v /= 1e3
        try:
            return datetime.fromtimestamp(v, tz=timezone.utc)
        except (OverflowError, OSError, ValueError):
            return utcnow()
    return utcnow()


def contact_id_for(platform: str, user_id: object) -> str:
    return f"{platform}:{user_id}"


def thread_id_for(platform: str, channel_id: object) -> str:
    return f"{platform}:{channel_id}"


def message_doc_id(platform: str, message_id: object) -> str:
    return f"{platform}:{message_id}"


def strip_query(url: str | None) -> str | None:
    return url.split("?", 1)[0] if url else url
