from unittest.mock import AsyncMock, MagicMock

from aiogram.exceptions import TelegramForbiddenError
from fastapi.testclient import TestClient

from golow_telegram.api import GolowApi
from golow_telegram.app import create_app

from .conftest import KEY


def client(settings, bot):
    app = create_app(settings, bot=bot, api=GolowApi(settings.golow_api_url, KEY))
    return app, TestClient(app)


def test_health(settings, bot):
    _, c = client(settings, bot)
    with c:
        assert c.get("/health").json() == {"status": "ok"}


def test_notify_requires_internal_key(settings, bot):
    _, c = client(settings, bot)
    with c:
        body = {"telegramUserId": 42, "type": "bid_activated"}
        assert c.post("/internal/notify", json=body).status_code == 401
        assert c.post("/internal/notify", json=body, headers={"X-Internal-Key": "x" * 40}).status_code == 401
    bot.send_message.assert_not_awaited()


def test_notify_sends_escaped_message_with_open_button(settings, bot):
    _, c = client(settings, bot)
    with c:
        r = c.post(
            "/internal/notify",
            json={"telegramUserId": 42, "type": "bid_activated", "lang": "en", "auction": "Tank <b>&</b>", "amount": "12.34", "auctionId": 11},
            headers={"X-Internal-Key": KEY},
        )
    assert r.status_code == 200 and r.json() == {"delivered": True}
    kwargs = bot.send_message.call_args.kwargs
    assert kwargs["chat_id"] == 42
    assert "Tank &lt;b&gt;&amp;&lt;/b&gt;: ETB 12.34" in kwargs["text"]
    assert kwargs["reply_markup"].inline_keyboard[0][0].web_app.url == "https://app.test/tg?start=auction_11"


def test_notify_in_amharic(settings, bot):
    _, c = client(settings, bot)
    with c:
        c.post("/internal/notify", json={"telegramUserId": 1, "type": "you_won", "lang": "am", "auction": "ታንክ", "amount": "5"}, headers={"X-Internal-Key": KEY})
    assert "አሸንፈዋል" in bot.send_message.call_args.kwargs["text"]


def test_notify_unknown_type_is_400(settings, bot):
    _, c = client(settings, bot)
    with c:
        r = c.post("/internal/notify", json={"telegramUserId": 1, "type": "nope"}, headers={"X-Internal-Key": KEY})
    assert r.status_code == 400


def test_notify_blocked_user_is_410_so_backend_falls_back_to_sms(settings, bot):
    bot.send_message.side_effect = TelegramForbiddenError(method=MagicMock(), message="Forbidden: bot was blocked by the user")
    _, c = client(settings, bot)
    with c:
        r = c.post("/internal/notify", json={"telegramUserId": 1, "type": "payment_failed"}, headers={"X-Internal-Key": KEY})
    assert r.status_code == 410 and r.json()["reason"] == "blocked"


UPDATE = {"update_id": 1001, "message": {"message_id": 1, "date": 0, "chat": {"id": 42, "type": "private"}, "from": {"id": 42, "is_bot": False, "first_name": "A"}, "text": "/help"}}


def test_webhook_rejects_missing_or_wrong_secret(settings, bot):
    app, c = client(settings, bot)
    app.state.dp.feed_update = AsyncMock()
    with c:
        assert c.post("/telegram/webhook", json=UPDATE).status_code == 401
        assert c.post("/telegram/webhook", json=UPDATE, headers={"X-Telegram-Bot-Api-Secret-Token": "wrong"}).status_code == 401
    app.state.dp.feed_update.assert_not_awaited()


def test_webhook_processes_each_update_once(settings, bot):
    app, c = client(settings, bot)
    app.state.dp.feed_update = AsyncMock()
    with c:
        h = {"X-Telegram-Bot-Api-Secret-Token": "hook-secret"}
        assert c.post("/telegram/webhook", json=UPDATE, headers=h).json() == {"ok": True}
        assert c.post("/telegram/webhook", json=UPDATE, headers=h).json() == {"ok": True}  # Telegram retry
    assert app.state.dp.feed_update.await_count == 1
