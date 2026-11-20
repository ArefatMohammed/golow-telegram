from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from golow_telegram.config import Settings

KEY = "k" * 40


@pytest.fixture
def settings() -> Settings:
    return Settings(
        bot_token="123456:TEST-TOKEN",
        internal_key=KEY,
        golow_api_url="https://api.test/api/v1",
        miniapp_url="https://app.test/tg",
        webhook_secret="hook-secret",
        setup_bot_profile=False,
        _env_file=None,
    )


def make_message(user_id: int = 42, lang: str = "en", contact: dict | None = None):
    user = SimpleNamespace(id=user_id, language_code=lang, first_name="Abebe", last_name="Kebede", username="abebe_k")
    return SimpleNamespace(
        from_user=user,
        contact=SimpleNamespace(**contact) if contact else None,
        answer=AsyncMock(),
    )


@pytest.fixture
def bot() -> MagicMock:
    b = MagicMock()
    b.send_message = AsyncMock()
    b.session.close = AsyncMock()
    return b
