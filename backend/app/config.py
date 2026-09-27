"""Runtime configuration loaded from environment variables (.env supported).

Every platform credential is optional: a platform only starts when its credential is set,
so the API can boot with just Firestore + OpenAI (or even with nothing configured).
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent.parent


def _bool(value: str | None, default: bool = False) -> bool:
    if value is None or value == "":
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _int(value: str | None, default: int) -> int:
    try:
        return int(value) if value not in (None, "") else default
    except ValueError:
        return default


def _float(value: str | None, default: float) -> float:
    try:
        return float(value) if value not in (None, "") else default
    except ValueError:
        return default


@dataclass(frozen=True)
class Config:
    # Platforms
    discord_token: str = ""
    discord_dms_only: bool = True
    instagram_session_id: str = ""
    instagram_username: str = ""
    instagram_password: str = ""
    instagram_totp_seed: str = ""
    instagram_poll_interval: int = 30

    # Firebase
    firestore_credentials_path: str = ""
    firestore_database_id: str = "(default)"
    firebase_storage_bucket: str = ""

    # OpenAI
    openai_api_key: str = ""
    openai_model: str = "gpt-4o-mini"
    moderation_model: str = "omni-moderation-latest"
    openai_timeout_seconds: float = 20.0

    # API
    api_host: str = "0.0.0.0"
    api_port: int = 8000
    debug: bool = False
    cors_origins: list[str] = field(default_factory=lambda: ["*"])

    # Workers / AI scheduling
    moderation_workers: int = 4
    thread_debounce_seconds: float = 30.0

    @property
    def discord_enabled(self) -> bool:
        return bool(self.discord_token)

    @property
    def instagram_has_password(self) -> bool:
        return bool(self.instagram_username and self.instagram_password)

    @property
    def instagram_enabled(self) -> bool:
        return bool(self.instagram_session_id) or self.instagram_has_password

    @property
    def openai_enabled(self) -> bool:
        return bool(self.openai_api_key)


def load_config(env_file: str | os.PathLike | None = None) -> Config:
    """Build a Config from the environment, loading backend/.env if present."""
    load_dotenv(env_file or BACKEND_DIR / ".env")
    env = os.environ.get
    origins = [o.strip() for o in (env("CORS_ORIGINS") or "*").split(",") if o.strip()]
    return Config(
        discord_token=env("DISCORD_TOKEN", ""),
        discord_dms_only=_bool(env("DISCORD_DMS_ONLY"), True),
        instagram_session_id=env("INSTAGRAM_SESSION_ID", ""),
        instagram_username=env("INSTAGRAM_USERNAME", ""),
        instagram_password=env("INSTAGRAM_PASSWORD", ""),
        instagram_totp_seed=env("INSTAGRAM_TOTP_SEED", ""),
        instagram_poll_interval=_int(env("INSTAGRAM_POLL_INTERVAL"), 30),
        firestore_credentials_path=env("FIRESTORE_CREDENTIALS_PATH", ""),
        firestore_database_id=env("FIRESTORE_DATABASE_ID") or "(default)",
        firebase_storage_bucket=env("FIREBASE_STORAGE_BUCKET", ""),
        openai_api_key=env("OPENAI_API_KEY", ""),
        openai_model=env("OPENAI_MODEL") or "gpt-4o-mini",
        moderation_model=env("OPENAI_MODERATION_MODEL") or "omni-moderation-latest",
        openai_timeout_seconds=_float(env("OPENAI_TIMEOUT_SECONDS"), 20.0),
        api_host=env("API_HOST") or "0.0.0.0",
        api_port=_int(env("API_PORT"), 8000),
        debug=_bool(env("DEBUG"), False),
        cors_origins=origins,
        moderation_workers=_int(env("MODERATION_WORKERS"), 4),
        thread_debounce_seconds=_float(env("THREAD_DEBOUNCE_SECONDS"), 30.0),
    )
