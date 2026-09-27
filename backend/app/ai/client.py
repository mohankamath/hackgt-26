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
    result = resp.results[0]
    return {
        "flagged": bool(result.flagged),
        "categories": result.categories.model_dump(by_alias=True),
        "scores": result.category_scores.model_dump(by_alias=True),
        "applied_input_types": (
            result.category_applied_input_types.model_dump(by_alias=True)
            if getattr(result, "category_applied_input_types", None)
            else {}
        ),
    }


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
