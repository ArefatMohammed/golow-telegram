"""Buttons: open the Mini App, share the user's own phone number."""

import re

from aiogram.types import (
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    KeyboardButton,
    ReplyKeyboardMarkup,
    WebAppInfo,
)

from .texts import TEXTS, Lang

#: Deep-link payloads the Mini App understands, e.g. t.me/GolowBidBot?start=auction_11.
START_PAYLOAD = re.compile(r"^(auction|bid|pay)_[0-9]{1,9}$")


def miniapp_link(base_url: str, start: str | None = None) -> str:
    """Mini App URL, passing a validated deep-link payload through as ?start=…"""
    return f"{base_url}?start={start}" if start and START_PAYLOAD.match(start) else base_url


def open_app(base_url: str, lang: Lang, start: str | None = None) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[[InlineKeyboardButton(text=TEXTS[lang]["open_button"], web_app=WebAppInfo(url=miniapp_link(base_url, start)))]]
    )


def share_phone(lang: Lang) -> ReplyKeyboardMarkup:
    # request_contact only ever sends the user's own number, and Telegram includes their user id with it.
    return ReplyKeyboardMarkup(
        keyboard=[[KeyboardButton(text=TEXTS[lang]["share_button"], request_contact=True)]],
        resize_keyboard=True,
        one_time_keyboard=True,
    )
