from unittest.mock import AsyncMock

import pytest
from aiogram.filters import CommandObject

from golow_telegram import handlers
from golow_telegram.api import LinkResult
from golow_telegram.texts import TEXTS

from .conftest import make_message


def buttons(call) -> list:
    markup = call.kwargs.get("reply_markup")
    return [b for row in getattr(markup, "inline_keyboard", []) for b in row]


@pytest.mark.asyncio
async def test_start_shows_open_button_and_share_prompt(settings):
    msg = make_message()
    await handlers.on_start(msg, CommandObject(prefix="/", command="start", args=None), settings)
    first, second = msg.answer.call_args_list
    assert first.args[0] == TEXTS["en"]["welcome"]
    assert buttons(first)[0].web_app.url == "https://app.test/tg"
    assert second.kwargs["reply_markup"].keyboard[0][0].request_contact is True


@pytest.mark.asyncio
async def test_start_deep_link_opens_that_auction(settings):
    msg = make_message()
    await handlers.on_start(msg, CommandObject(prefix="/", command="start", args="auction_11"), settings)
    assert buttons(msg.answer.call_args_list[0])[0].web_app.url == "https://app.test/tg?start=auction_11"


@pytest.mark.asyncio
async def test_start_ignores_unknown_payload(settings):
    msg = make_message()
    await handlers.on_start(msg, CommandObject(prefix="/", command="start", args="javascript:alert(1)"), settings)
    assert buttons(msg.answer.call_args_list[0])[0].web_app.url == "https://app.test/tg"


@pytest.mark.asyncio
async def test_amharic_user_gets_amharic(settings):
    msg = make_message(lang="am")
    await handlers.on_help(msg, settings)
    assert msg.answer.call_args.args[0] == TEXTS["am"]["help"]


@pytest.mark.asyncio
async def test_own_contact_links_account(settings):
    api = AsyncMock()
    api.link.return_value = LinkResult("LinkedExisting", 2)
    msg = make_message(user_id=42, contact={"user_id": 42, "phone_number": "+251911222333"})
    await handlers.on_contact(msg, api, settings)
    api.link.assert_awaited_once_with(42, "+251911222333", "Abebe", "Kebede", "abebe_k", "en")
    assert msg.answer.call_args_list[0].args[0] == TEXTS["en"]["linked_existing"]


@pytest.mark.parametrize("contact", [{"user_id": 999, "phone_number": "+251911000000"}, {"user_id": None, "phone_number": "+251911000000"}])
@pytest.mark.asyncio
async def test_someone_elses_contact_is_refused(settings, contact):
    api = AsyncMock()
    msg = make_message(user_id=42, contact=contact)
    await handlers.on_contact(msg, api, settings)
    api.link.assert_not_awaited()
    assert msg.answer.call_args.args[0] == TEXTS["en"]["not_own_contact"]


@pytest.mark.parametrize(("outcome", "key"), [("conflict", "conflict"), ("invalid", "invalid_phone"), ("error", "error"), ("CreatedAccount", "created_account")])
@pytest.mark.asyncio
async def test_link_outcomes_are_explained(settings, outcome, key):
    api = AsyncMock()
    api.link.return_value = LinkResult(outcome)
    msg = make_message(user_id=7, contact={"user_id": 7, "phone_number": "0911999888"})
    await handlers.on_contact(msg, api, settings)
    assert msg.answer.call_args_list[0].args[0] == TEXTS["en"][key]
