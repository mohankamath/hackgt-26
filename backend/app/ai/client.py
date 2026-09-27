"""Shared OpenAI client: omni-moderation + structured (JSON-schema) chat completions.

Callers import this module (``from app.ai import client as ai``) and call ``ai.moderate`` /
``ai.structured_completion`` so tests can monkeypatch them without touching the network.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from openai import AsyncOpenAI

from app.config import Config, load_config

log = logging.getLogger("screened.ai")


class AIError(RuntimeError):
    """Raised when an OpenAI call fails or returns unusable output."""


_config: Config | None = None
_client: AsyncOpenAI | None = None


def configure(config: Config) -> None:
    """(Re)configure the shared client. Called once at app startup."""
    global _config, _client
    _config = config
    _client = None


def get_config() -> Config:
    global _config
    if _config is None:
        _config = load_config()
    return _config


def is_configured() -> bool:
    return get_config().openai_enabled


def get_client() -> AsyncOpenAI:
    global _client
    cfg = get_config()
    if not cfg.openai_enabled:
        raise AIError("OPENAI_API_KEY is not configured")
    if _client is None:
        _client = AsyncOpenAI(
            api_key=cfg.openai_api_key,
            timeout=cfg.openai_timeout_seconds,
            max_retries=1,
        )
    return _client


def chat_model() -> str:
    return get_config().openai_model


async def moderate(inputs: list[dict[str, Any]]) -> dict[str, Any]:
    """Run omni-moderation on multimodal inputs.

    ``inputs`` items look like {"type": "text", "text": "..."} or
    {"type": "image_url", "image_url": {"url": "https://... or data:image/...;base64,..."}}.

    Returns {"flagged": bool, "categories": {name: bool}, "scores": {name: float},
    "applied_input_types": {name: [..]}} with slash/hyphen category names
    (e.g. "self-harm/intent").
    """
    try:
        resp = await get_client().moderations.create(
            model=get_config().moderation_model, input=inputs  # type: ignore[arg-type]
        )
    except AIError:
        raise
    except Exception as exc:  # network, auth, rate limit, bad request...
        raise AIError(f"moderation request failed: {exc}") from exc

    if not resp.results:
        raise AIError("moderation returned no results")
    results = resp.results
    category_scores = {}
    categories = {}
    applied_input_types = {}
    for result in results:
        for name, score in result.category_scores.model_dump(by_alias=True).items():
            category_scores[name] = max(category_scores.get(name, 0.0), float(score or 0.0))
        for name, flagged in result.categories.model_dump(by_alias=True).items():
            categories[name] = categories.get(name, False) or bool(flagged)
        input_types = getattr(result, "category_applied_input_types", None)
        if input_types:
            for name, values in input_types.model_dump(by_alias=True).items():
                applied_input_types[name] = sorted(set(applied_input_types.get(name, [])) | set(values or []))
    return {
        "flagged": any(bool(result.flagged) for result in results),
        "categories": categories,
        "scores": category_scores,
        "applied_input_types": applied_input_types,
    }


async def inspect_images(image_urls: list[str]) -> dict[str, Any]:
    """Classify whether image inputs are appropriate for a child to see.

    This complements moderation categories with visual concepts such as firearms,
    weapons, and graphic injury that are not guaranteed to cross a moderation score.
    """
    schema = {
        "type": "object",
        "properties": {
            "allow": {"type": "boolean"},
            "labels": {"type": "array", "items": {"type": "string"}},
            "reason": {"type": "string"},
        },
        "required": ["allow", "labels", "reason"],
        "additionalProperties": False,
    }
    content: list[dict[str, Any]] = [
        {
            "type": "text",
            "text": (
                "Review these images for a child-safety inbox. Set allow=true only when every image is clearly "
                "appropriate for a child. Set allow=false for nudity or sexual content, firearms or weapons, "
                "graphic injury/gore, self-harm, drug use, or anything uncertain. Ordinary people, animals, "
                "landscapes, food, and non-graphic everyday scenes may be allowed."
            ),
        }
    ]
    content.extend({"type": "image_url", "image_url": {"url": url}} for url in image_urls)
    try:
        resp = await get_client().chat.completions.create(
            model=chat_model(),
            messages=[{"role": "user", "content": content}],
            response_format={
                "type": "json_schema",
                "json_schema": {"name": "child_image_safety", "strict": True, "schema": schema},
            },
            temperature=0,
            max_completion_tokens=200,
        )
    except AIError:
        raise
    except Exception as exc:
        raise AIError(f"image safety inspection failed: {exc}") from exc
    choice = resp.choices[0] if resp.choices else None
    output = choice.message.content if choice and choice.message else None
    if not output:
        raise AIError("image safety inspection returned no result")
    try:
        result = json.loads(output)
    except json.JSONDecodeError as exc:
        raise AIError(f"image safety inspection was not valid JSON: {exc}") from exc
    if not isinstance(result, dict) or not isinstance(result.get("allow"), bool):
        raise AIError("image safety inspection returned an invalid result")
    return result


async def structured_completion(
    *,
    system: str,
    user: str,
    schema_name: str,
    schema: dict[str, Any],
    temperature: float = 0.2,
    max_tokens: int = 900,
) -> dict[str, Any]:
    """Ask the chat model for JSON that matches ``schema`` (strict structured outputs)."""
    try:
        resp = await get_client().chat.completions.create(
            model=chat_model(),
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            response_format={
                "type": "json_schema",
                "json_schema": {"name": schema_name, "strict": True, "schema": schema},
            },
            temperature=temperature,
            max_completion_tokens=max_tokens,
        )
    except AIError:
        raise
    except Exception as exc:
        raise AIError(f"completion request failed: {exc}") from exc

    choice = resp.choices[0] if resp.choices else None
    content = choice.message.content if choice and choice.message else None
    if not content:
        refusal = getattr(choice.message, "refusal", None) if choice else None
        raise AIError(f"empty completion{f' (refusal: {refusal})' if refusal else ''}")
    try:
        data = json.loads(content)
    except json.JSONDecodeError as exc:
        raise AIError(f"completion was not valid JSON: {exc}") from exc
    if not isinstance(data, dict):
        raise AIError("completion JSON was not an object")
    return data
