"""FastAPI service: Telegram webhook, backend → bot notifications, health check."""

import asyncio
import contextlib
import hmac
import logging
from collections import OrderedDict
from contextlib import asynccontextmanager

from aiogram import Bot, Dispatcher
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode
from aiogram.types import BotCommand, MenuButtonWebApp, Update, WebAppInfo
from fastapi import FastAPI, Header, HTTPException, Request

from . import notify, studio
from .api import GolowApi
from .config import Settings, get_settings
from .handlers import build_router
from .studio.feed import NewUserFeed

log = logging.getLogger(__name__)


def build_dispatcher(settings: Settings, api: GolowApi, welcome_feed: NewUserFeed | None = None) -> Dispatcher:
    dp = Dispatcher()
    dp.include_router(build_router())
    # Injected into handlers by parameter name.
    dp["settings"] = settings
    dp["api"] = api
    dp["welcome_feed"] = welcome_feed
    return dp


async def setup_bot_profile(bot: Bot, settings: Settings) -> None:
    """Commands and the chat's menu button, which opens the Mini App."""
    await bot.set_my_commands([BotCommand(command="start", description="Open GOLOW"), BotCommand(command="help", description="How GOLOW works")])
    await bot.set_my_commands(
        [BotCommand(command="start", description="GOLOW ክፈት"), BotCommand(command="help", description="GOLOW እንዴት ይሠራል")],
        language_code="am",
    )
    await bot.set_chat_menu_button(menu_button=MenuButtonWebApp(text="GOLOW", web_app=WebAppInfo(url=settings.miniapp_url)))


class _SeenUpdates:
    """Telegram retries a webhook call that didn't get a 200; remember recent update ids so nothing runs twice."""

    def __init__(self, size: int = 2000) -> None:
        self._ids: OrderedDict[int, None] = OrderedDict()
        self._size = size

    def first_time(self, update_id: int) -> bool:
        if update_id in self._ids:
            return False
        self._ids[update_id] = None
        if len(self._ids) > self._size:
            self._ids.popitem(last=False)
        return True


def create_app(settings: Settings | None = None, bot: Bot | None = None, api: GolowApi | None = None) -> FastAPI:
    settings = settings or get_settings()
    bot = bot or Bot(settings.bot_token.get_secret_value(), default=DefaultBotProperties(parse_mode=ParseMode.HTML))
    api = api or GolowApi(settings.golow_api_url, settings.internal_key.get_secret_value())
    welcome_feed = NewUserFeed(api) if settings.studio_secret is not None else None
    dp = build_dispatcher(settings, api, welcome_feed)
    seen = _SeenUpdates()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        if settings.setup_bot_profile:
            await setup_bot_profile(bot, settings)
        polling: asyncio.Task | None = None
        if settings.webhook_url:
            await bot.set_webhook(
                url=settings.webhook_url,
                secret_token=settings.webhook_secret.get_secret_value() if settings.webhook_secret else None,
                allowed_updates=dp.resolve_used_update_types(),
            )
            log.info("Webhook set to %s", settings.webhook_url)
        elif settings.polling:
            # No public URL: receive updates by long polling in the background, while this app still serves
            # /internal/notify for the backend. uvicorn owns the signals and the bot session.
            await bot.delete_webhook(drop_pending_updates=False)
            polling = asyncio.create_task(dp.start_polling(bot, handle_signals=False, close_bot_session=False))
            log.info("Long polling started")
        app.state.polling = polling
        yield
        if polling is not None:
            await dp.stop_polling()
            polling.cancel()
            with contextlib.suppress(asyncio.CancelledError, RuntimeError):
                await polling
        await api.aclose()
        await bot.session.close()

    app = FastAPI(title="GolowBidBot", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
    app.state.settings = settings
    app.state.bot = bot
    app.state.dp = dp
    app.include_router(notify.router)
    if settings.studio_secret is not None:
        studio.mount(app, settings, api, welcome_feed)

    @app.post("/telegram/webhook")
    async def telegram_webhook(request: Request, x_telegram_bot_api_secret_token: str | None = Header(default=None)) -> dict:
        expected = settings.webhook_secret.get_secret_value() if settings.webhook_secret else None
        if not expected or not x_telegram_bot_api_secret_token or not hmac.compare_digest(x_telegram_bot_api_secret_token, expected):
            raise HTTPException(status_code=401, detail="Unauthorized.")
        update = Update.model_validate(await request.json(), context={"bot": bot})
        if seen.first_time(update.update_id):
            await dp.feed_update(bot, update)
        return {"ok": True}

    @app.get("/health")
    async def health() -> dict:
        return {"status": "ok"}

    return app


async def run_polling() -> None:
    """Local development: no public URL needed."""
    settings = get_settings()
    bot = Bot(settings.bot_token.get_secret_value(), default=DefaultBotProperties(parse_mode=ParseMode.HTML))
    api = GolowApi(settings.golow_api_url, settings.internal_key.get_secret_value())
    dp = build_dispatcher(settings, api)
    if settings.setup_bot_profile:
        await setup_bot_profile(bot, settings)
    await bot.delete_webhook(drop_pending_updates=False)
    try:
        await dp.start_polling(bot)
    finally:
        await api.aclose()
