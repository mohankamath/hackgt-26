"""Personal-information detection for the child's outgoing messages (send preview)."""

from __future__ import annotations

import re

_PATTERNS: list[tuple[str, str, re.Pattern]] = [
    (
        "phone",
        "Phone number",
        re.compile(r"(?<![\w-])(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}(?![\w-])"),
    ),
    ("email", "Email address", re.compile(r"\b[\w.%+-]+@[\w.-]+\.[A-Za-z]{2,}\b")),
    # SSN: require the dashed form and reject impossible area/group/serial numbers so random
    # 9-digit numbers (order IDs, scores) don't trigger it.
    (
        "ssn",
        "Social Security number",
        re.compile(r"\b(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b"),
    ),
    (
        "address",
        "Home address",
        re.compile(
            r"\b\d{1,5}\s+(?:[A-Za-z0-9.'-]+\s+){1,3}"
            r"(?:street|st|avenue|ave|road|rd|boulevard|blvd|drive|dr|lane|ln|court|ct|way|"
            r"place|pl|circle|cir|terrace|ter|parkway|pkwy|trail|trl)\b\.?",
            re.IGNORECASE,
        ),
    ),
    (
        "location_share",
        "Where you live or go to school",
        re.compile(
            r"\b(?:i live (?:at|on|in)|my address is|my school is|i go to [A-Z][\w]+ "
            r"(?:elementary|middle|high|school|academy))\b",
            re.IGNORECASE,
        ),
    ),
]

_CARD = re.compile(r"\b(?:\d[ -]?){13,19}\b")


def _luhn_ok(number: str) -> bool:
    digits = [int(c) for c in number if c.isdigit()]
    if not 13 <= len(digits) <= 19:
        return False
    total = 0
    for i, d in enumerate(reversed(digits)):
        if i % 2 == 1:
            d *= 2
            if d > 9:
                d -= 9
        total += d
    return total % 10 == 0


def find_pii(text: str) -> list[dict]:
    """Return [{type, label, match, start, end}] for personal info found in ``text``."""
    if not text:
        return []
    found: list[dict] = []
    for kind, label, pattern in _PATTERNS:
        for m in pattern.finditer(text):
            found.append(
                {"type": kind, "label": label, "match": m.group(0), "start": m.start(), "end": m.end()}
            )
    for m in _CARD.finditer(text):
        if _luhn_ok(m.group(0)):
            found.append(
                {"type": "card", "label": "Card number", "match": m.group(0), "start": m.start(), "end": m.end()}
            )
    found.sort(key=lambda f: f["start"])
    return found
