"""Chat handlers: /start (with deep links), phone sharing → account link, /help."""

import logging

from aiogram import F, Router
from aiogram.filters import Command, CommandObject, CommandStart
from aiogram.types import Message, ReplyKeyboardRemove

from . import keyboards
from .api import GolowApi
from .config import Settings
from .texts import TEXTS, lang_of

log = logging.getLogger(__name__)

_LINK_REPLY = {
    "LinkedExisting": "linked_existing",
    "CreatedAccount": "created_account",
    "AlreadyLinked": "already_linked",
    "conflict": "conflict",
    "invalid": "invalid_phone",
    "error": "error",
}


async def on_start(message: Message, command: CommandObject, settings: Settings) -> None:
    """Welcome + "Open GOLOW". A deep link (t.me/GolowBidBot?start=auction_11) opens the Mini App on that auction."""
    lang = lang_of(message.from_user.language_code if message.from_user else None)
    await message.answer(TEXTS[lang]["welcome"], reply_markup=keyboards.open_app(settings.miniapp_url, lang, command.args))
    await message.answer(TEXTS[lang]["share_prompt"], reply_markup=keyboards.share_phone(lang))


async def on_help(message: Message, settings: Settings) -> None:
    lang = lang_of(message.from_user.language_code if message.from_user else None)
    await message.answer(TEXTS[lang]["help"], reply_markup=keyboards.open_app(settings.miniapp_url, lang))


async def on_contact(message: Message, api: GolowApi, settings: Settings) -> None:
    """Links the GOLOW account. Only the sender's own number is accepted: Telegram sets contact.user_id when the
    contact is the user's own (request_contact), so a forwarded or typed contact is refused."""
    user = message.from_user
    contact = message.contact
    lang = lang_of(user.language_code if user else None)
    if user is None or contact is None or contact.user_id is None or contact.user_id != user.id:
        log.warning("Rejected a contact that isn't the sender's own (from %s).", user.id if user else None)
        await message.answer(TEXTS[lang]["not_own_contact"], reply_markup=keyboards.share_phone(lang))
        return

    result = await api.link(user.id, contact.phone_number, user.first_name, user.last_name, user.username)
    reply = TEXTS[lang][_LINK_REPLY[result.outcome]]
    if result.outcome in ("LinkedExisting", "CreatedAccount", "AlreadyLinked"):
        await message.answer(reply, reply_markup=ReplyKeyboardRemove())
        await message.answer(TEXTS[lang]["help"], reply_markup=keyboards.open_app(settings.miniapp_url, lang))
    else:
        await message.answer(reply)


async def on_anything_else(message: Message, settings: Settings) -> None:
    lang = lang_of(message.from_user.language_code if message.from_user else None)
    await message.answer(TEXTS[lang]["help"], reply_markup=keyboards.open_app(settings.miniapp_url, lang))


def build_router() -> Router:
    """A fresh router per dispatcher (aiogram attaches a router to one dispatcher only). Order matters: the
    catch-all comes last."""
    router = Router(name="golow")
    router.message.register(on_start, CommandStart())
    router.message.register(on_help, Command("help"))
    router.message.register(on_contact, F.contact)
    router.message.register(on_anything_else)
    return router
