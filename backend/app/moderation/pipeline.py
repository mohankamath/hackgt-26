"""Moderation pipeline: runs text, attachment, and profile-picture checks concurrently and
merges them into one verdict (worst status and highest severity win).

The profile picture never hides the message itself: a flagged avatar is swapped for a
default avatar in the UI and raises the severity (and the contact's risk) instead.
"""

from __future__ import annotations

import asyncio
import logging
import re

from app import policy
from app.moderation import image as image_mod
from app.moderation import text as text_mod

log = logging.getLogger("safeguard.moderation.pipeline")

_IMAGE_EXT = re.compile(r"\.(png|jpe?g|gif|webp|bmp|avif|heic|tiff?)(\?|$)", re.IGNORECASE)
_VIDEO_EXT = re.compile(r"\.(mp4|mov|webm|mkv|avi|m4v)(\?|$)", re.IGNORECASE)


def attachment_kind(att: dict) -> str:
    ctype = (att.get("type") or "").lower()
    ref = att.get("filename") or att.get("url") or ""
    if ctype.startswith("image/") or _IMAGE_EXT.search(ref):
        return "image"
    if ctype.startswith("video/") or _VIDEO_EXT.search(ref):
        return "video"
    return "file"


async def moderate_attachment(att: dict, sensitivity: str) -> dict:
    """Moderate one attachment. Returns the image verdict plus ``kind`` and optional ``_bytes``
    (downloaded content kept in memory so the caller can upload it without re-downloading)."""
    kind = attachment_kind(att)
    if kind != "image":
        label = "Videos can't be scanned automatically" if kind == "video" else "File type can't be scanned automatically"
        return {
            "kind": kind,
            "flagged": False,
            "status": "needs_review",
            "categories": [],
            "scores": {},
            "severity": "none",
            "error": label,
        }

    data = att.get("bytes")
    if data is None and att.get("storage_path") and att.get("url"):
        # We need the bytes anyway to re-host the file, so download once here.
        try:
            data = await image_mod.download_bytes(att["url"])
        except Exception as exc:
            return {"kind": kind, **image_mod._result("needs_review", error=f"download failed: {exc}")}

    if data is not None:
        verdict = await image_mod.check_image_bytes(data, sensitivity)
        verdict["_bytes"] = data
    elif att.get("url"):
        verdict = await image_mod.check_image_url(att["url"], sensitivity)
    else:
        verdict = image_mod._result("needs_review", error="attachment has no content")
    return {"kind": kind, **verdict}


async def moderate_profile_picture(url: str | None, sensitivity: str, data: bytes | None = None) -> dict | None:
    if not url and data is None:
        return None
    if data is None:
        try:
            data = await image_mod.download_bytes(url)  # type: ignore[arg-type]
        except Exception as exc:
            return {**image_mod._result("needs_review", error=f"download failed: {exc}")}
    verdict = await image_mod.check_image_bytes(data, sensitivity)
    verdict["_bytes"] = data
    return verdict


def merge_verdicts(text_v: dict, attachment_vs: list[dict], pfp_v: dict | None) -> dict:
    """Pure merge of component verdicts into the message-level verdict."""
    status = policy.worst_status([text_v["status"], *(a["status"] for a in attachment_vs)])
    severity = policy.max_severity(
        [text_v["severity"], *(a["severity"] for a in attachment_vs), (pfp_v or {}).get("severity")]
    )

    categories = [{**h, "source": "text"} for h in text_v["categories"]]
    reasons = list(text_v["reasons"])
    for i, a in enumerate(attachment_vs):
        for h in a["categories"]:
            categories.append({**h, "source": f"attachment:{i}"})
            reasons.append(f"Image: {h['label']}")
        if a["status"] == "needs_review" and a.get("error"):
            reasons.append(f"Attachment needs review ({a['error']})")
    pfp_flagged = bool(pfp_v and pfp_v["status"] == "censored")
    if pfp_v:
        for h in pfp_v["categories"]:
            categories.append({**h, "source": "profile_picture"})
            reasons.append(f"Profile picture: {h['label']}")

    deduped: list[str] = []
    for r in reasons:
        if r not in deduped:
            deduped.append(r)

    return {
        "status": status,
        "text_status": text_v["status"],
        "severity": severity,
        "masked_content": text_v["masked_content"],
        "flagged_words": text_v["flagged_words"],
        "grooming_hints": text_v["grooming_hints"],
        "profile_picture_flagged": pfp_flagged,
        "moderation": {
            "categories": categories,
            "scores": text_v["scores"],
            "reasons": deduped,
            "error": text_v.get("error"),
        },
        "attachments": attachment_vs,
        "profile_picture": pfp_v,
    }


async def moderate_message(
    payload: dict,
    sensitivity: str = policy.DEFAULT_SENSITIVITY,
    custom_keywords: list[str] | tuple[str, ...] = (),
    cached_pfp: dict | None = None,
) -> dict:
    """Moderate a normalised platform payload.

    ``cached_pfp`` is a previous profile-picture verdict still considered valid; when given,
    the avatar is not re-checked.
    """
    attachments = payload.get("attachments") or []
    check_pfp = cached_pfp is None and (payload.get("profile_picture_url") or payload.get("profile_picture_bytes"))

    tasks = [
        text_mod.moderate_text(payload.get("text") or "", sensitivity, custom_keywords),
        *(moderate_attachment(a, sensitivity) for a in attachments),
    ]
    if check_pfp:
        tasks.append(
            moderate_profile_picture(payload.get("profile_picture_url"), sensitivity, payload.get("profile_picture_bytes"))
        )
    results = await asyncio.gather(*tasks)

    text_v = results[0]
    att_vs = list(results[1 : 1 + len(attachments)])
    pfp_v = results[-1] if check_pfp else cached_pfp
    merged = merge_verdicts(text_v, att_vs, pfp_v)
    merged["profile_picture_checked"] = bool(check_pfp)
    return merged
