"""POST /internal/notify — the GOLOW backend asks the bot to message a linked user (free, instant, instead of SMS)."""

import hmac
import html
import logging

from aiogram import Bot
from aiogram.exceptions import TelegramBadRequest, TelegramForbiddenError
from fastapi import APIRouter, Header, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field

from . import keyboards
from .config import Settings
from .texts import NOTIFICATIONS, lang_of

log = logging.getLogger(__name__)
router = APIRouter()


class NotifyRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    telegram_user_id: int = Field(alias="telegramUserId", gt=0)
    type: str = Field(max_length=40)
    lang: str | None = None
    auction: str | None = Field(default=None, max_length=200)
    amount: str | None = Field(default=None, max_length=32)
    auction_id: int | None = Field(default=None, alias="auctionId", gt=0)


def render(req: NotifyRequest) -> str:
    lang = lang_of(req.lang)
    template = NOTIFICATIONS[lang].get(req.type)
    if template is None:
        raise HTTPException(status_code=400, detail=f"Unknown notification type '{req.type}'.")
    # Auction titles come from admins and are shown with parse_mode=HTML, so escape them.
    return template.format(auction=html.escape(req.auction or "GOLOW"), amount=html.escape(req.amount or "—"))


@router.post("/internal/notify")
async def notify(req: NotifyRequest, request: Request, x_internal_key: str | None = Header(default=None)) -> JSONResponse:
    settings: Settings = request.app.state.settings
    bot: Bot = request.app.state.bot
    if not x_internal_key or not hmac.compare_digest(x_internal_key, settings.internal_key.get_secret_value()):
        raise HTTPException(status_code=401, detail="Unauthorized.")

    text = render(req)
    start = f"auction_{req.auction_id}" if req.auction_id else None
    try:
        await bot.send_message(
            chat_id=req.telegram_user_id,
            text=text,
            reply_markup=keyboards.open_app(settings.miniapp_url, lang_of(req.lang), start),
        )
    except TelegramForbiddenError:
        # The user blocked the bot: the backend should fall back to SMS.
        return JSONResponse(status_code=410, content={"delivered": False, "reason": "blocked"})
    except TelegramBadRequest as exc:
        log.warning("Telegram refused a %s notification for %s: %s", req.type, req.telegram_user_id, exc.message)
        return JSONResponse(status_code=410, content={"delivered": False, "reason": "unreachable"})
    return JSONResponse(status_code=200, content={"delivered": True})
