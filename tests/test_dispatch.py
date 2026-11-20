"""Real Telegram updates through the real aiogram dispatcher: routing, filters and dependency injection."""

from unittest.mock import AsyncMock

import pytest
from aiogram.methods import SendMessage
from aiogram.types import Update

from golow_telegram.api import LinkResult
from golow_telegram.app import build_dispatcher
from golow_telegram.texts import TEXTS


def update(update_id: int, **message) -> Update:
    base = {"message_id": update_id, "date": 0, "chat": {"id": 42, "type": "private"}, "from": {"id": 42, "is_bot": False, "first_name": "Sara", "language_code": "en"}}
    return Update.model_validate({"update_id": update_id, "message": {**base, **message}})


def sent_texts(bot: AsyncMock) -> list[str]:
    return [c.args[0].text for c in bot.call_args_list if isinstance(c.args[0], SendMessage)]


@pytest.fixture
def bot():
    b = AsyncMock()  # aiogram calls `await bot(SendMessage(...))`
    b.id = 1
    return b


@pytest.mark.asyncio
async def test_start_command_is_routed(settings, bot):
    dp = build_dispatcher(settings, AsyncMock())
    await dp.feed_update(bot, update(1, text="/start auction_7"))
    assert sent_texts(bot)[:2] == [TEXTS["en"]["welcome"], TEXTS["en"]["share_prompt"]]


@pytest.mark.asyncio
async def test_own_contact_reaches_the_link_handler_with_injected_api(settings, bot):
    api = AsyncMock()
    api.link.return_value = LinkResult("CreatedAccount", 9)
    dp = build_dispatcher(settings, api)
    await dp.feed_update(bot, update(2, contact={"phone_number": "+251911999888", "first_name": "Sara", "user_id": 42}))
    api.link.assert_awaited_once_with(42, "+251911999888", "Sara", None, None)
    assert sent_texts(bot)[0] == TEXTS["en"]["created_account"]


@pytest.mark.asyncio
async def test_forwarded_contact_is_refused_end_to_end(settings, bot):
    api = AsyncMock()
    dp = build_dispatcher(settings, api)
    await dp.feed_update(bot, update(3, contact={"phone_number": "+251911000000", "first_name": "Other", "user_id": 777}))
    api.link.assert_not_awaited()
    assert sent_texts(bot) == [TEXTS["en"]["not_own_contact"]]


@pytest.mark.asyncio
async def test_other_text_gets_help(settings, bot):
    dp = build_dispatcher(settings, AsyncMock())
    await dp.feed_update(bot, update(4, text="hello"))
    assert sent_texts(bot) == [TEXTS["en"]["help"]]
