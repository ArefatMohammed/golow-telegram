"""Bot texts in English and Amharic (same glossary as the GOLOW website: bid = ዋጋ, auction = ጨረታ)."""

from typing import Literal

Lang = Literal["en", "am"]


def lang_of(language_code: str | None) -> Lang:
    """Amharic for Telegram users whose app language is Amharic, English otherwise."""
    return "am" if (language_code or "").lower().startswith("am") else "en"


TEXTS: dict[Lang, dict[str, str]] = {
    "en": {
        "welcome": "Welcome to <b>GOLOW</b>! 🎯\nWin auctions with the lowest unique bid, without leaving Telegram.\n\nTap <b>Open GOLOW</b> to start.",
        "share_prompt": "First time only: share your phone number to connect your GOLOW account. It's how we keep your bids and wins safe.",
        "share_button": "📱 Share my phone number",
        "open_button": "🎯 Open GOLOW",
        "linked_existing": "✅ Connected! Your Telegram is now linked to your GOLOW account.",
        "created_account": "✅ Your GOLOW account is ready. You can start bidding right away.",
        "already_linked": "✅ Your Telegram is already connected to GOLOW.",
        "not_own_contact": "For your security, please share <b>your own</b> phone number using the button below.",
        "conflict": "This phone number or Telegram account is already connected to another GOLOW account. Contact us if you need help.",
        "invalid_phone": "Only Ethiopian phone numbers can be used with GOLOW.",
        "error": "Sorry, we couldn't connect right now. Please try again in a moment.",
        "help": "GOLOW is an auction where the <b>lowest unique bid</b> wins.\nTap <b>Open GOLOW</b>, pick an auction, place your bid and pay the bid fee.",
    },
    "am": {
        "welcome": "እንኳን ወደ <b>GOLOW</b> በደህና መጡ! 🎯\nበዝቅተኛ ብቸኛ ዋጋ ጨረታዎችን ያሸንፉ፤ ከቴሌግራም ሳይወጡ።\n\nለመጀመር <b>GOLOW ክፈት</b> የሚለውን ይንኩ።",
        "share_prompt": "ለመጀመሪያ ጊዜ ብቻ፦ የGOLOW መለያዎን ለማገናኘት ስልክ ቁጥርዎን ያጋሩ። ዋጋዎችዎና ሽልማቶችዎ በዚህ ይጠበቃሉ።",
        "share_button": "📱 ስልክ ቁጥሬን አጋራ",
        "open_button": "🎯 GOLOW ክፈት",
        "linked_existing": "✅ ተገናኝቷል! የቴሌግራም መለያዎ ከGOLOW መለያዎ ጋር ተገናኝቷል።",
        "created_account": "✅ የGOLOW መለያዎ ተዘጋጅቷል። አሁኑኑ መጫረት ይችላሉ።",
        "already_linked": "✅ የቴሌግራም መለያዎ አስቀድሞ ከGOLOW ጋር ተገናኝቷል።",
        "not_own_contact": "ለደህንነትዎ፣ እባክዎ ከታች ያለውን ቁልፍ ተጠቅመው <b>የራስዎን</b> ስልክ ቁጥር ያጋሩ።",
        "conflict": "ይህ ስልክ ቁጥር ወይም የቴሌግራም መለያ ከሌላ የGOLOW መለያ ጋር ተገናኝቷል። እርዳታ ከፈለጉ ያግኙን።",
        "invalid_phone": "ከGOLOW ጋር መጠቀም የሚቻለው የኢትዮጵያ ስልክ ቁጥር ብቻ ነው።",
        "error": "ይቅርታ፣ አሁን ማገናኘት አልተቻለም። እባክዎ ትንሽ ቆይተው እንደገና ይሞክሩ።",
        "help": "GOLOW በ<b>ዝቅተኛ ብቸኛ ዋጋ</b> የሚሸነፍ ጨረታ ነው።\n<b>GOLOW ክፈት</b>ን ይንኩ፣ ጨረታ ይምረጡ፣ ዋጋዎን ያቅርቡና የጨረታ ክፍያውን ይክፈሉ።",
    },
}

#: Notification messages the backend asks the bot to send ({auction} and {amount} are filled in, HTML-escaped).
NOTIFICATIONS: dict[Lang, dict[str, str]] = {
    "en": {
        "bid_activated": "✅ <b>Your bid is in!</b>\n{auction}: ETB {amount}. Good luck!",
        "payment_failed": "❌ Your payment for <b>{auction}</b> didn't go through, so your bid wasn't placed. Please try again.",
        "you_won": "🏆 <b>Congratulations, you won!</b>\n{auction} with your bid of ETB {amount}.",
        "settlement_due": "💳 You won <b>{auction}</b>. Please complete the payment of ETB {amount}.",
        "auction_ended": "🔔 <b>{auction}</b> has ended. See the result in GOLOW.",
        "auction_extended": "⏰ <b>{auction}</b> was extended: you have more time to bid.",
    },
    "am": {
        "bid_activated": "✅ <b>ዋጋዎ ቀርቧል!</b>\n{auction}፦ {amount} ብር። መልካም ዕድል!",
        "payment_failed": "❌ ለ<b>{auction}</b> የከፈሉት ክፍያ አልተሳካም፤ ዋጋዎ አልቀረበም። እባክዎ እንደገና ይሞክሩ።",
        "you_won": "🏆 <b>እንኳን ደስ አለዎት፣ አሸንፈዋል!</b>\n{auction} በ{amount} ብር ዋጋዎ።",
        "settlement_due": "💳 <b>{auction}</b>ን አሸንፈዋል። እባክዎ የ{amount} ብር ክፍያውን ያጠናቅቁ።",
        "auction_ended": "🔔 <b>{auction}</b> ጨረታ ተጠናቋል። ውጤቱን በGOLOW ይመልከቱ።",
        "auction_extended": "⏰ <b>{auction}</b> ጨረታ ተራዝሟል፤ ዋጋ ለማቅረብ ተጨማሪ ጊዜ አለዎት።",
    },
}
