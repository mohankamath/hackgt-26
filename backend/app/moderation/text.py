"""Text moderation: fast local layer + OpenAI omni-moderation, fused into one verdict.

Statuses:
    safe          nothing found
    masked        only profanity / slurs / custom keywords: those words become "•••"
                  and the rest of the message is still shown
    censored      OpenAI category above threshold (threats, sexual, self-harm, hate...)
                  or explicit sexual solicitation: the whole message is hidden
    needs_review  OpenAI was unavailable, so we can't be sure: hidden until a parent checks
"""

from __future__ import annotations

import logging
import re
from functools import lru_cache

from app import policy
from app.ai import client as ai
from app.moderation import profanity_data as data

log = logging.getLogger("screened.moderation.text")

MASK = "•••"
_B = r"(?<![a-z0-9])"  # left word boundary on normalised text
_E = r"(?![a-z0-9])"  # right word boundary


def _term_regex(terms: list[str]) -> re.Pattern:
    parts = sorted({t.lower().strip() for t in terms if t.strip()}, key=len, reverse=True)
    body = "|".join(re.escape(p).replace(r"\ ", r"\s+") for p in parts)
    return re.compile(f"{_B}(?:{body}){_E}")


_PROFANITY_RE = _term_regex(data.PROFANITY)
_SLUR_RE = _term_regex(data.SLURS)
_SEXUAL_RE = _term_regex(data.SEXUAL_TERMS)
_EVASION_RES = [(re.compile(f"{_B}{p}{_E}"), canon) for p, canon in data.EVASION_PATTERNS.items()]
_SLUR_CANON = {s.lower() for s in data.SLURS}


@lru_cache(maxsize=32)
def _custom_regex(keywords: tuple[str, ...]) -> re.Pattern | None:
    kws = [k for k in keywords if k and k.strip()]
    return _term_regex(kws) if kws else None


def _normalise_positions(text: str) -> str:
    """Lowercase + leet-speak substitution that keeps a 1:1 character mapping with ``text``."""
    lowered = "".join(c.lower() if len(c.lower()) == 1 else c for c in text)
    return lowered.translate(data.LEET_MAP)


def _normalise_phrases(text: str) -> str:
    """Normalise for phrase matching: lowercase, drop apostrophes, collapse punctuation."""
    t = text.lower().replace("’", "").replace("'", "")
    t = re.sub(r"[^a-z0-9]+", " ", t)
    return f" {t.strip()} "


def _merge_spans(spans: list[dict]) -> list[dict]:
    spans = sorted(spans, key=lambda s: (s["start"], -s["end"]))
    merged: list[dict] = []
    for s in spans:
        if merged and s["start"] < merged[-1]["end"]:
            if s["end"] > merged[-1]["end"]:
                merged[-1]["end"] = s["end"]
            continue
        merged.append(dict(s))
    return merged


def mask_text(text: str, spans: list[dict]) -> str:
    out, cursor = [], 0
    for s in sorted(spans, key=lambda s: s["start"]):
        out.append(text[cursor : s["start"]])
        out.append(MASK)
        cursor = s["end"]
    out.append(text[cursor:])
    return "".join(out)


def local_scan(text: str, custom_keywords: list[str] | tuple[str, ...] = ()) -> dict:
    """Pure, synchronous local checks. Returns spans to mask plus phrase-level hits."""
    if not text:
        return {"spans": [], "masked": text, "flagged_words": [], "solicitation": [], "grooming_hints": {}}

    norm = _normalise_positions(text)
    spans: list[dict] = []

    def add(match: re.Match, kind: str, term: str | None = None) -> None:
        spans.append(
            {
                "start": match.start(),
                "end": match.end(),
                "kind": kind,
                "term": term or text[match.start() : match.end()].lower(),
            }
        )

    for m in _SLUR_RE.finditer(norm):
        add(m, "slur", norm[m.start() : m.end()])
    for m in _PROFANITY_RE.finditer(norm):
        add(m, "profanity", norm[m.start() : m.end()])
    for m in _SEXUAL_RE.finditer(norm):
        add(m, "profanity", norm[m.start() : m.end()])
    lowered = text.lower()
    for rx, canon in _EVASION_RES:
        for m in rx.finditer(lowered):
            add(m, "slur" if canon in _SLUR_CANON else "profanity", canon)
    custom_rx = _custom_regex(tuple(sorted(k.lower() for k in custom_keywords)))
    if custom_rx:
        for m in custom_rx.finditer(norm):
            add(m, "custom_keyword", norm[m.start() : m.end()])

    merged = _merge_spans(spans)
    phrase_text = _normalise_phrases(text)
    solicitation = [
        p for p in data.SEXUAL_SOLICITATION_PHRASES if f" {_normalise_phrases(p).strip()} " in phrase_text
    ]
    hints: dict[str, list[str]] = {}
    for signal, phrases in data.GROOMING_HINT_PHRASES.items():
        hit = [p for p in phrases if f" {_normalise_phrases(p).strip()} " in phrase_text]
        if hit:
            hints[signal] = hit

    return {
        "spans": merged,
        "masked": mask_text(text, merged),
        "flagged_words": sorted({s["term"] for s in spans}),
        "kinds": sorted({s["kind"] for s in spans}),
        "solicitation": solicitation,
        "grooming_hints": hints,
    }


def _local_hits(local: dict) -> list[dict]:
    hits = []
    kinds = set(local.get("kinds", []))
    if local["solicitation"]:
        hits.append({"category": "sexual_solicitation", "label": policy.CATEGORY_LABELS["sexual_solicitation"], "score": 1.0, "severity": "high"})
    if "slur" in kinds:
        hits.append({"category": "slur", "label": policy.CATEGORY_LABELS["slur"], "score": 1.0, "severity": "medium"})
    if "profanity" in kinds:
        hits.append({"category": "profanity", "label": policy.CATEGORY_LABELS["profanity"], "score": 1.0, "severity": "low"})
    if "custom_keyword" in kinds:
        hits.append({"category": "custom_keyword", "label": policy.CATEGORY_LABELS["custom_keyword"], "score": 1.0, "severity": "low"})
    if local["grooming_hints"]:
        hits.append({"category": "grooming_hint", "label": policy.CATEGORY_LABELS["grooming_hint"], "score": 1.0, "severity": "medium"})
    return hits


def fuse(local: dict, mod: dict | None, sensitivity: str, error: str | None = None) -> dict:
    """Combine the local scan and the OpenAI result into the final text verdict (pure)."""
    verdict = policy.evaluate_scores(mod["scores"], sensitivity) if mod else {"hits": [], "severity": "none", "censor": False}
    hits = verdict["hits"] + _local_hits(local)

    if verdict["censor"] or local["solicitation"]:
        status = "censored"
    elif mod is None:
        status = "needs_review"
    elif local["spans"]:
        status = "masked"
    else:
        status = "safe"

    reasons = []
    for h in hits:
        if h["label"] not in reasons:
            reasons.append(h["label"])
    if mod is None:
        reasons.append("Automatic check unavailable")

    return {
        "status": status,
        "masked_content": local["masked"] if status == "masked" else None,
        "flagged_spans": local["spans"],
        "flagged_words": local["flagged_words"],
        "categories": hits,
        "scores": policy.top_scores(mod["scores"]) if mod else {},
        "severity": policy.max_severity(h["severity"] for h in hits),
        "reasons": reasons,
        "grooming_hints": local["grooming_hints"],
        "error": error,
    }


def safe_verdict() -> dict:
    return {
        "status": "safe",
        "masked_content": None,
        "flagged_spans": [],
        "flagged_words": [],
        "categories": [],
        "scores": {},
        "severity": "none",
        "reasons": [],
        "grooming_hints": {},
        "error": None,
    }


async def moderate_text(
    text: str,
    sensitivity: str = policy.DEFAULT_SENSITIVITY,
    custom_keywords: list[str] | tuple[str, ...] = (),
) -> dict:
    if not text or not text.strip():
        return safe_verdict()
    local = local_scan(text, custom_keywords)
    try:
        mod = await ai.moderate([{"type": "text", "text": text}])
        error = None
    except ai.AIError as exc:
        log.warning("text moderation failed: %s", exc)
        mod, error = None, str(exc)
    return fuse(local, mod, sensitivity, error)
