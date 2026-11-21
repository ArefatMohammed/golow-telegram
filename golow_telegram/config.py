"""Settings from environment variables (or a local .env). Secrets are SecretStr so they never end up in logs.

ENVIRONMENT=dev|prod picks every GOLOW address at once (API, Mini App, bot, website, studio host). Any of them can
still be set explicitly; an explicit value always wins over the preset.
"""

import logging
from functools import lru_cache
from typing import Literal

from pydantic import SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

log = logging.getLogger(__name__)

Environment = Literal["dev", "prod"]

#: Addresses per environment (see the table in the README).
PRESETS: dict[str, dict[str, str]] = {
    "dev": {
        "golow_api_url": "https://api-dev.golow.et/api/v1",
        "public_api_url": "https://api-dev.golow.et",
        "miniapp_url": "https://dev.golow.et/tg",
        "website_url": "https://dev.golow.et",
        "bot_username": "GolowBidDevBot",
        "studio_host": "live-dev.golow.et",
    },
    "prod": {
        "golow_api_url": "https://api.golow.et/api/v1",
        "public_api_url": "https://api.golow.et",
        "miniapp_url": "https://golow.et/tg",
        "website_url": "https://golow.et",
        "bot_username": "GolowBidBot",
        "studio_host": "live.golow.et",
    },
}


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    #: dev or prod: sets the defaults below.
    environment: Environment = "dev"
    #: Bot token from @BotFather (@GolowBidDevBot for dev, @GolowBidBot for production).
    bot_token: SecretStr
    #: Shared with the backend (Telegram__InternalKey): the bot sends it to /internal/telegram/*, and the backend
    #: sends it to this service's /internal/notify.
    internal_key: SecretStr

    # Preset per environment unless set explicitly.
    #: GOLOW backend API, including /api/v1, as this service reaches it (may be an internal Docker address such as
    #: http://wagago-prod-backend:8080/api/v1).
    golow_api_url: str = ""
    #: The same API as browsers reach it (no /api/v1): the studio pages connect to its live-events hub.
    public_api_url: str = ""
    #: The Mini App the "Open GOLOW" buttons launch.
    miniapp_url: str = ""
    #: The public website (shown on stream).
    website_url: str = ""
    #: The bot's @username without @, for t.me deep links (the studio's QR code).
    bot_username: str = ""

    #: Public HTTPS URL of /telegram/webhook. Unset: long polling (local development).
    webhook_url: str | None = None
    #: Telegram echoes this in X-Telegram-Bot-Api-Secret-Token on every webhook call.
    webhook_secret: SecretStr | None = None
    #: Set the bot's commands and menu button on start-up.
    setup_bot_profile: bool = True
    #: Without WEBHOOK_URL, receive updates by long polling inside the web app (so /internal/notify keeps working).
    polling: bool = True

    # --- GOLOW Live Studio -------------------------------------------------------------------------------------
    #: Signs studio sessions and OBS scene links. Unset: the studio is off. Rotating it signs everyone out and
    #: invalidates every scene link. Use a different value per environment.
    studio_secret: SecretStr | None = None
    #: Requests with this Host are served the studio at / (and nothing else of this service). Preset per environment.
    studio_host: str = ""
    #: How long an admin stays signed in to the control panel.
    studio_session_hours: int = 12
    #: How long an OBS scene link (overlay/board/reveal with ?key=) keeps working.
    studio_scene_key_days: int = 30
    #: Send the session cookie over HTTPS only. Turn off only for local development over http.
    studio_cookie_secure: bool = True

    @field_validator("environment", mode="before")
    @classmethod
    def _env_alias(cls, v: str) -> str:
        v = str(v or "dev").strip().lower()
        return {"development": "dev", "production": "prod"}.get(v, v)

    @field_validator("internal_key")
    @classmethod
    def _key_long_enough(cls, v: SecretStr) -> SecretStr:
        if len(v.get_secret_value()) < 32:
            raise ValueError("INTERNAL_KEY must be at least 32 characters (same value as the backend's Telegram__InternalKey)")
        return v

    @field_validator("studio_secret")
    @classmethod
    def _studio_secret_long_enough(cls, v: SecretStr | None) -> SecretStr | None:
        if v is not None and not v.get_secret_value():
            return None
        if v is not None and len(v.get_secret_value()) < 32:
            raise ValueError("STUDIO_SECRET must be at least 32 characters")
        return v

    @model_validator(mode="after")
    def _apply_preset(self) -> "Settings":
        for name, value in PRESETS[self.environment].items():
            if not getattr(self, name):
                setattr(self, name, value)
        self.golow_api_url = self.golow_api_url.rstrip("/")
        self.public_api_url = self.public_api_url.rstrip("/")
        self.miniapp_url = self.miniapp_url.rstrip("/")
        self.website_url = self.website_url.rstrip("/")
        self.bot_username = self.bot_username.lstrip("@")
        self.studio_host = self.studio_host.strip().lower()
        # The costly mistake is a production bot or studio showing dev data (or the reverse): refuse to start.
        other = "dev" if self.environment == "prod" else "prod"
        if self.golow_api_url == PRESETS[other]["golow_api_url"]:
            raise ValueError(f"ENVIRONMENT={self.environment} but GOLOW_API_URL is the {other} API ({self.golow_api_url})")
        if self.public_api_url == PRESETS[other]["public_api_url"]:
            raise ValueError(f"ENVIRONMENT={self.environment} but PUBLIC_API_URL is the {other} API ({self.public_api_url})")
        return self

    @property
    def golow_api_origin(self) -> str:
        """The public API origin browsers use, e.g. https://api-dev.golow.et (the SignalR hub lives there)."""
        return self.public_api_url


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
