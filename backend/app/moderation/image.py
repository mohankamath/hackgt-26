"""Image moderation via OpenAI omni-moderation (replaces the old homemade RandomForest model).

Public API (same seam as the old ``image_filter.py``, now async):
    await check_image_bytes(image_bytes, sensitivity="balanced") -> dict
    await check_image_url(url, sensitivity="balanced") -> dict

Result shape:
    {"flagged": bool, "status": "safe" | "censored" | "needs_review",
     "categories": [ {category, label, score, severity} ], "scores": {category: score},
     "severity": "none" | "low" | "medium" | "high", "error": str | None}

Failures never pass as safe: any download/API error returns status="needs_review".
"""

from __future__ import annotations

import base64
import io
import logging
import ssl

import aiohttp
import certifi
from PIL import Image, ImageOps

from app import policy
from app.ai import client as ai

log = logging.getLogger("screened.moderation.image")

# OpenAI accepts images up to 20 MB; stay a little under to leave room for encoding.
MAX_IMAGE_BYTES = 20 * 1024 * 1024
TARGET_IMAGE_BYTES = 19 * 1024 * 1024
MAX_DOWNLOAD_BYTES = 60 * 1024 * 1024
DOWNLOAD_TIMEOUT_SECONDS = 15

_PASSTHROUGH_FORMATS = {"JPEG": "image/jpeg", "PNG": "image/png", "WEBP": "image/webp"}


def _result(status: str, *, hits=None, scores=None, severity="none", error=None) -> dict:
    return {
        "flagged": status == "censored",
        "status": status,
        "categories": hits or [],
        "scores": scores or {},
        "severity": severity,
        "error": error,
    }


def prepare_image(image_bytes: bytes) -> tuple[bytes, str]:
    """Validate and normalise an image for the moderation API.

    - Rejects bytes that are not a decodable image (raises ValueError).
    - Converts formats OpenAI may not accept (GIF/BMP/TIFF/HEIC...) to PNG/JPEG
      (animated GIFs use their first frame).
    - Downscales / recompresses anything above the 20 MB limit.
    Returns (bytes, mime_type).
    """
    try:
        img = Image.open(io.BytesIO(image_bytes))
        img.load()
    except Exception as exc:
        raise ValueError(f"not a decodable image: {exc}") from exc

    fmt = (img.format or "").upper()
    if fmt in _PASSTHROUGH_FORMATS and len(image_bytes) <= MAX_IMAGE_BYTES:
        return image_bytes, _PASSTHROUGH_FORMATS[fmt]

    img = ImageOps.exif_transpose(img) or img
    if getattr(img, "is_animated", False):
        img.seek(0)
    has_alpha = img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info)

    # Small non-standard formats: convert losslessly-ish without resizing.
    if len(image_bytes) <= MAX_IMAGE_BYTES:
        buf = io.BytesIO()
        if has_alpha:
            img.convert("RGBA").save(buf, format="PNG", optimize=True)
            if buf.tell() <= MAX_IMAGE_BYTES:
                return buf.getvalue(), "image/png"
        else:
            img.convert("RGB").save(buf, format="JPEG", quality=90)
            if buf.tell() <= MAX_IMAGE_BYTES:
                return buf.getvalue(), "image/jpeg"

    # Oversized: shrink as JPEG until it fits.
    rgb = img.convert("RGB")
    max_side = 4096
    quality = 90
    while True:
        candidate = rgb.copy()
        candidate.thumbnail((max_side, max_side))
        buf = io.BytesIO()
        candidate.save(buf, format="JPEG", quality=quality)
        if buf.tell() <= TARGET_IMAGE_BYTES or max_side <= 256:
            return buf.getvalue(), "image/jpeg"
        max_side = int(max_side * 0.75)
        quality = max(60, quality - 5)


def to_data_url(image_bytes: bytes, mime: str) -> str:
    return f"data:{mime};base64,{base64.b64encode(image_bytes).decode('ascii')}"


async def check_image_bytes(image_bytes: bytes, sensitivity: str = policy.DEFAULT_SENSITIVITY) -> dict:
    if not image_bytes:
        return _result("needs_review", error="empty image")
    try:
        source = Image.open(io.BytesIO(image_bytes))
        frame_count = getattr(source, "n_frames", 1)
        if frame_count > 1:
            # A harmful frame can be hidden in an otherwise harmless animation. Sample
            # evenly across the animation while keeping API cost bounded.
            indexes = sorted({round(i * (frame_count - 1) / 5) for i in range(min(frame_count, 6))})
            frame_bytes = []
            for index in indexes:
                source.seek(index)
                frame = source.convert("RGBA")
                buf = io.BytesIO()
                frame.save(buf, format="PNG", optimize=True)
                frame_bytes.append(buf.getvalue())
        else:
            frame_bytes = [image_bytes]
    except Exception as exc:
        return _result("needs_review", error=f"not a decodable image: {exc}")

    try:
        inputs = []
        for frame in frame_bytes:
            prepared, mime = prepare_image(frame)
            inputs.append({"type": "image_url", "image_url": {"url": to_data_url(prepared, mime)}})
        # Send sampled frames together so an animation costs one moderation request,
        # rather than one sequential request per frame.
        mod = await ai.moderate(inputs)
    except (ValueError, ai.AIError) as exc:
        log.warning("image moderation failed: %s", exc)
        return _result("needs_review", error=str(exc))

    raw_scores = mod.get("scores") or {}
    scores = {k: v for k, v in raw_scores.items() if k in policy.IMAGE_CATEGORIES}

    verdict = policy.evaluate_scores(scores, sensitivity, allowed_categories=policy.IMAGE_CATEGORIES)
    # Honor the model's image flag even when a category score is below our display
    # threshold, while ignoring unrelated text-only flags in test/mixed responses.
    applied_types = mod.get("applied_input_types") or {}
    image_was_applied = any("image" in values for values in applied_types.values())
    flagged_categories = mod.get("categories") or {}
    image_category_flagged = any(flagged_categories.get(category) for category in policy.IMAGE_CATEGORIES)
    image_model_flagged = bool(mod.get("flagged")) and (image_was_applied or image_category_flagged)
    if image_model_flagged or verdict["censor"]:
        return _result(
            "censored",
            hits=verdict["hits"],
            scores=policy.top_scores(scores, n=4),
            severity=verdict["severity"],
        )

    inspect = getattr(ai, "inspect_images", None)
    if inspect is None:
        return _result("needs_review", error="image safety inspector is unavailable")
    try:
        inspection = await inspect([item["image_url"]["url"] for item in inputs])
    except ai.AIError as exc:
        log.warning("image safety inspection failed: %s", exc)
        return _result("needs_review", error=str(exc))
    if not inspection.get("allow"):
        labels = ", ".join(inspection.get("labels") or []) or "visual safety concern"
        return _result(
            "censored",
            hits=[{"category": "visual_safety", "label": labels, "score": 1.0, "severity": "high"}],
            scores=policy.top_scores(scores, n=4),
            severity="high",
            error=inspection.get("reason") or labels,
        )

    status = "safe"
    return _result(
        status,
        hits=verdict["hits"],
        scores=policy.top_scores(scores, n=4),
        severity=verdict["severity"],
    )


async def download_bytes(url: str, session: aiohttp.ClientSession | None = None) -> bytes:
    """Download a URL with a timeout and a size cap. Raises on failure."""
    own = session is None
    if session is None:
        ssl_context = ssl.create_default_context(cafile=certifi.where())
        session = aiohttp.ClientSession(
            timeout=aiohttp.ClientTimeout(total=DOWNLOAD_TIMEOUT_SECONDS),
            connector=aiohttp.TCPConnector(ssl=ssl_context),
        )
    try:
        async with session.get(url) as resp:
            if resp.status != 200:
                raise RuntimeError(f"HTTP {resp.status}")
            data = bytearray()
            async for chunk in resp.content.iter_chunked(64 * 1024):
                data.extend(chunk)
                if len(data) > MAX_DOWNLOAD_BYTES:
                    raise RuntimeError("file too large")
            return bytes(data)
    finally:
        if own:
            await session.close()


async def check_image_url(url: str, sensitivity: str = policy.DEFAULT_SENSITIVITY) -> dict:
    try:
        data = await download_bytes(url)
    except Exception as exc:
        log.warning("image download failed for %s: %s", url[:80], exc)
        return _result("needs_review", error=f"download failed: {exc}")
    return await check_image_bytes(data, sensitivity)
