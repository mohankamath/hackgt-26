"""Moderation policy: category thresholds, severities, statuses, and sensitivity presets.

All moderation decisions flow through here so the thresholds live in one place.
"""

from __future__ import annotations

from typing import Iterable

# ── Ordering helpers ────────────────────────────────────────────────

SEVERITIES = ["none", "low", "medium", "high"]
# Worst status wins when merging verdicts from text / attachments / profile pictures.
STATUS_PRECEDENCE = ["safe", "masked", "needs_review", "censored", "blocked"]
RISK_LEVELS = ["none", "low", "medium", "high"]


def severity_rank(severity: str | None) -> int:
    return SEVERITIES.index(severity) if severity in SEVERITIES else 0


def max_severity(values: Iterable[str | None]) -> str:
    best = "none"
    for v in values:
        if severity_rank(v) > severity_rank(best):
            best = v  # type: ignore[assignment]
    return best


def status_rank(status: str | None) -> int:
    return STATUS_PRECEDENCE.index(status) if status in STATUS_PRECEDENCE else 0


def worst_status(values: Iterable[str | None]) -> str:
    best = "safe"
    for v in values:
        if status_rank(v) > status_rank(best):
            best = v  # type: ignore[assignment]
    return best


def risk_rank(level: str | None) -> int:
    return RISK_LEVELS.index(level) if level in RISK_LEVELS else 0


# ── OpenAI omni-moderation category rules ──────────────────────────
# threshold: score at/above which the category counts as a hit (balanced sensitivity)
# severity: how serious a hit is; action: what a hit does to the content

CATEGORY_RULES: dict[str, dict] = {
    "sexual": {"threshold": 0.5, "severity": "high", "action": "censor"},
    "sexual/minors": {"threshold": 0.2, "severity": "high", "action": "censor"},
    "harassment": {"threshold": 0.8, "severity": "medium", "action": "censor"},
    "harassment/threatening": {"threshold": 0.5, "severity": "high", "action": "censor"},
    "hate": {"threshold": 0.5, "severity": "high", "action": "censor"},
    "hate/threatening": {"threshold": 0.4, "severity": "high", "action": "censor"},
    "illicit": {"threshold": 0.7, "severity": "medium", "action": "censor"},
    "illicit/violent": {"threshold": 0.5, "severity": "high", "action": "censor"},
    "self-harm": {"threshold": 0.5, "severity": "high", "action": "censor"},
    "self-harm/intent": {"threshold": 0.4, "severity": "high", "action": "censor"},
    "self-harm/instructions": {"threshold": 0.4, "severity": "high", "action": "censor"},
    "violence": {"threshold": 0.7, "severity": "medium", "action": "censor"},
    "violence/graphic": {"threshold": 0.6, "severity": "high", "action": "censor"},
}

# Categories omni-moderation scores for images (the rest are text-only and return 0).
IMAGE_CATEGORIES = {
    "sexual",
    "violence",
    "violence/graphic",
    "self-harm",
    "self-harm/intent",
    "self-harm/instructions",
}

# Human-friendly labels used in reasons shown to parents.
CATEGORY_LABELS: dict[str, str] = {
    "sexual": "Sexual content",
    "sexual/minors": "Sexual content involving minors",
    "harassment": "Harassment / bullying",
    "harassment/threatening": "Threats",
    "hate": "Hate speech",
    "hate/threatening": "Hateful threats",
    "illicit": "Illicit activity",
    "illicit/violent": "Violent illicit activity",
    "self-harm": "Self-harm",
    "self-harm/intent": "Self-harm intent",
    "self-harm/instructions": "Self-harm instructions",
    "violence": "Violence",
    "violence/graphic": "Graphic violence",
    "profanity": "Profanity",
    "slur": "Slur",
    "custom_keyword": "Custom keyword",
    "sexual_solicitation": "Sexual solicitation",
    "grooming_hint": "Possible grooming language",
    "pii": "Personal information",
}

# ── Sensitivity presets (set by the parent in Settings) ─────────────
# Multiplier applied to every threshold: lower = stricter.

SENSITIVITY_PRESETS: dict[str, float] = {
    "low": 1.25,
    "balanced": 1.0,
    "strict": 0.6,
}
DEFAULT_SENSITIVITY = "balanced"


def effective_threshold(category: str, sensitivity: str = DEFAULT_SENSITIVITY) -> float:
    rule = CATEGORY_RULES[category]
    mult = SENSITIVITY_PRESETS.get(sensitivity, 1.0)
    return min(0.95, rule["threshold"] * mult)


def evaluate_scores(
    scores: dict[str, float],
    sensitivity: str = DEFAULT_SENSITIVITY,
    allowed_categories: set[str] | None = None,
) -> dict:
    """Turn raw omni-moderation category scores into policy hits.

    Returns {"hits": [{category, label, score, severity}], "severity": str, "censor": bool}
    sorted by score (highest first).
    """
    hits = []
    for category, rule in CATEGORY_RULES.items():
        if allowed_categories is not None and category not in allowed_categories:
            continue
        score = float(scores.get(category, 0.0) or 0.0)
        if score >= effective_threshold(category, sensitivity):
            hits.append(
                {
                    "category": category,
                    "label": CATEGORY_LABELS.get(category, category),
                    "score": round(score, 4),
                    "severity": rule["severity"],
                }
            )
    hits.sort(key=lambda h: h["score"], reverse=True)
    return {
        "hits": hits,
        "severity": max_severity(h["severity"] for h in hits),
        "censor": any(CATEGORY_RULES[h["category"]]["action"] == "censor" for h in hits),
    }


def top_scores(scores: dict[str, float], n: int = 5, allowed: set[str] | None = None) -> dict[str, float]:
    """Keep only the n highest scores (keeps Firestore docs small but useful for review)."""
    items = [
        (k, float(v or 0.0)) for k, v in scores.items() if allowed is None or k in allowed
    ]
    items.sort(key=lambda kv: kv[1], reverse=True)
    return {k: round(v, 4) for k, v in items[:n]}
