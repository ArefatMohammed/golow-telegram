# golow-telegram

**GolowBidBot**: the Telegram bot service for the GOLOW Mini App. It is the chat side of GOLOW on Telegram: users open the Mini App, connect their account by sharing their phone number once, and get their auction notifications in the chat.

| Bot | Mini App | Backend |
|---|---|---|
| `@GolowBidDevBot` | https://dev.golow.et/tg | https://api-dev.golow.et |
| `@GolowBidBot` | https://golow.et/tg | https://api.golow.et |

## What it does

- **`/start`**: a welcome message with an **Open GOLOW** button that launches the Mini App, and a one-time **Share my phone number** button. Deep links such as `t.me/GolowBidBot?start=auction_11` open the Mini App on that auction.
- **Phone sharing**: only accepts the sender's **own** number (`contact.user_id == from.id`). It calls the backend's `POST /api/v1/internal/telegram/link`, which links the existing GOLOW account with that phone or creates one.
- **`POST /internal/notify`**: the backend asks the bot to message a linked user (`bid_activated`, `payment_failed`, `you_won`, `settlement_due`, `auction_ended`, `auction_extended`) in English or Amharic. It returns **410** if the user blocked the bot, so the backend can fall back to SMS.
- **Menu button**: the chat's menu button opens the Mini App. Commands are set in English and Amharic.

## Architecture

```
Telegram ──webhook──▶ /telegram/webhook (secret-token header, duplicate updates ignored) ──▶ aiogram handlers
                                                                                              │
GOLOW backend ◀── POST /api/v1/internal/telegram/link (X-Internal-Key) ◀──────────────────────┘
GOLOW backend ──▶ POST /internal/notify (X-Internal-Key) ──▶ bot.send_message
```

Stack: Python 3.12, aiogram 3, FastAPI, uvicorn, httpx and pydantic-settings.

## Configuration (environment)

See [.env.example](.env.example).

| Variable | Description |
|---|---|
| `BOT_TOKEN` | The bot token from @BotFather |
| `INTERNAL_KEY` | Shared secret: the **same value** as the backend's `Telegram__InternalKey`, at least 32 characters |
| `GOLOW_API_URL` | The backend API, including `/api/v1` |
| `MINIAPP_URL` | The Mini App the buttons open |
| `WEBHOOK_URL` | Public HTTPS URL of `/telegram/webhook`. Leave it empty to use polling. |
| `WEBHOOK_SECRET` | Random secret that Telegram sends back on every webhook call |

## Run

```bash
# Tests (same Python as production)
docker build --target test .

# Local development with long polling (needs a .env)
pip install -r requirements-dev.txt
python -m golow_telegram polling

# Server (webhook mode)
docker build -t golow-telegram .
docker run --env-file .env -p 127.0.0.1:8000:8000 golow-telegram
```

## Deployment notes

- **Network**: run it on the internal Docker network next to the backend. Only `/telegram/webhook` should be reachable from the internet (nginx → `127.0.0.1:8000`). `/internal/notify` must stay internal.
- **Secrets**: they live only in the server's `.env`. Regenerate the production bot token in @BotFather before launch.
