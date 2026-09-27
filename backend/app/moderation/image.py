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

import aiohttp
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
        prepared, mime = prepare_image(image_bytes)
    except ValueError as exc:
        return _result("needs_review", error=str(exc))

    try:
        mod = await ai.moderate(
            [{"type": "image_url", "image_url": {"url": to_data_url(prepared, mime)}}]
        )
    except ai.AIError as exc:
        log.warning("image moderation failed: %s", exc)
        return _result("needs_review", error=str(exc))

    scores = {k: v for k, v in mod["scores"].items() if k in policy.IMAGE_CATEGORIES}
    verdict = policy.evaluate_scores(scores, sensitivity, allowed_categories=policy.IMAGE_CATEGORIES)
    status = "censored" if verdict["censor"] else "safe"
    return _result(
        status,
        hits=verdict["hits"],
        scores=policy.top_scores(scores, n=4),
        severity=verdict["severity"],
    )


async def download_bytes(url: str, session: aiohttp.ClientSession | None = None) -> bytes:
    """Download a URL with a timeout and a size cap. Raises on failure."""
    own = session is None
    session = session or aiohttp.ClientSession(
        timeout=aiohttp.ClientTimeout(total=DOWNLOAD_TIMEOUT_SECONDS)
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
