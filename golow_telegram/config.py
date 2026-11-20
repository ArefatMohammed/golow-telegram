"""Settings from environment variables (or a local .env). Secrets are SecretStr so they never end up in logs."""

from functools import lru_cache

from pydantic import SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    #: Bot token from @BotFather (@GolowBidDevBot for dev, @GolowBidBot for production).
    bot_token: SecretStr
    #: GOLOW backend API, including /api/v1.
    golow_api_url: str = "https://api-dev.golow.et/api/v1"
    #: Shared with the backend (Telegram__InternalKey): the bot sends it to /internal/telegram/*, and the backend
    #: sends it to this service's /internal/notify.
    internal_key: SecretStr
    #: The Mini App the "Open GOLOW" buttons launch.
    miniapp_url: str = "https://dev.golow.et/tg"
    #: Public HTTPS URL of /telegram/webhook. Unset: long polling (local development).
    webhook_url: str | None = None
    #: Telegram echoes this in X-Telegram-Bot-Api-Secret-Token on every webhook call.
    webhook_secret: SecretStr | None = None
    #: Set the bot's commands and menu button on start-up.
    setup_bot_profile: bool = True
    #: Without WEBHOOK_URL, receive updates by long polling inside the web app (so /internal/notify keeps working).
    polling: bool = True

    @field_validator("internal_key")
    @classmethod
    def _key_long_enough(cls, v: SecretStr) -> SecretStr:
        if len(v.get_secret_value()) < 32:
            raise ValueError("INTERNAL_KEY must be at least 32 characters (same value as the backend's Telegram__InternalKey)")
        return v

    @field_validator("golow_api_url", "miniapp_url")
    @classmethod
    def _no_trailing_slash(cls, v: str) -> str:
        return v.rstrip("/")


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
