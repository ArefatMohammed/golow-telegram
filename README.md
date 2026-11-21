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
- **GOLOW Live Studio** (`live.golow.et`): the OBS control panel and scenes for running auctions on TikTok Live. See [below](#golow-live-studio).

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
| `STUDIO_SECRET` | Signs Live Studio sessions and scene links, at least 32 characters. Empty: studio off |
| `STUDIO_HOST` | The studio's host: `live.golow.et` (prod) or `live-dev.golow.et` (dev) |
| `STUDIO_SESSION_HOURS` / `STUDIO_SCENE_KEY_DAYS` | Panel session length (12) and scene link lifetime (30) |

## GOLOW Live Studio

The studio from the *GOLOW Live Studio — Requirements Spec*, served by this service on its own subdomain and locked to GOLOW admins.

| Page | Who opens it | Access |
|---|---|---|
| `/` (control panel) | The host, in a browser or as an OBS Custom Browser Dock | Admin sign-in |
| `/overlay.html`, `/board.html`, `/reveal.html` | OBS Browser Sources (1080×1920) | Admin sign-in **or** a signed scene link (`?key=…`) |
| `/login` | Everyone | Public |

- **Sign-in uses the admin platform's credentials** (phone + password). The service calls `POST /api/v1/auth/login`, then confirms an **active admin** by calling `GET /api/v1/admin/auctions` (the backend's own Admin policy decides). The browser gets only the studio's own signed, httpOnly, `SameSite=Strict` cookie (default 12 h); GOLOW tokens never reach it. The **latest** admin's GOLOW tokens stay in the server's memory for the welcome feed (refreshed with `POST /api/v1/auth/refresh`), and are revoked when that admin signs out or another admin signs in. Sign-in is limited to 10 attempts per IP per 10 minutes.
- **Welcome new users**: the overlay greets each new GOLOW account with a popup, "👋 እንኳን ደህና መጡ፣ Abebe K.!" (first name + last initial, never a phone number). Telegram sign-ups come from the bot instantly; website sign-ups come from `GET /api/v1/admin/users`, checked every 5 s with the admin's token. After a restart, or when the admin session expires, website sign-ups resume once an admin signs in to the panel again (the panel says so). A burst of more than 3 sign-ups becomes one "+N" popup. The panel has a **Welcome new users** switch and a **Test welcome** button. Make sure showing new members' first names on stream fits GOLOW's privacy terms.
- **Scene links**: OBS sources can't sign in, so the panel creates signed links valid for `STUDIO_SCENE_KEY_DAYS` (default 30). Rotating `STUDIO_SECRET` revokes every link and session.
- **Data**: the pages read auctions through a read-only proxy of four public endpoints (`/auctions`, `/auctions/{id}`, `/auctions/{id}/bids`, `/auctions/{id}/result`), so **no CORS change is needed on the API**. Bid amounts of live auctions are never shown.
- **Live updates**: the pages use the SignalR hub at `/hubs/auctions` when the API has one. **Neither `api-dev.golow.et` nor `api.golow.et` runs it today** (404), so they poll instead: the overlay every 3 s (new bids, closing and the winner are detected from the changes), the panel and board every 5 s. They switch to the hub on their own once it's deployed.
- **API as deployed** (differs from the spec): auctions in progress have `status=Active`; finished ones are `Ended` with `outcome` `WinnerDeclared` or `NoUniqueBid`; bids of an unfinished auction answer **400** ("Bids are revealed only after the auction is finalized").
- **Dev and production**: the studio uses the same backend as the bot (`GOLOW_API_URL`). Run the dev bot with `STUDIO_HOST=live-dev.golow.et` and production with `STUDIO_HOST=live.golow.et`.
- **Host isolation**: requests whose `Host` is `STUDIO_HOST` are served the studio and nothing else; the webhook, `/internal/notify` and `/health` aren't reachable on that host.
- Strings are in `golow_telegram/studio/static/js/strings.js` and follow the bot's glossary (auction = ጨረታ, bid = ዋጋ). **A native speaker should review the Amharic before going live.** Recorded clips go in `golow_telegram/studio/static/sounds/<kind>.mp3` (`new-bid`, `almost`, `closed`, `winner`, `rules`, `cancel`, `hype`).

nginx for the subdomain (TLS as for the webhook; the whole host goes to the container):

```nginx
server {
    server_name live.golow.et;          # live-dev.golow.et on the dev server
    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

DNS: an `A` record for `live` (and `live-dev`) pointing to the server.

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

- **Network**: run it on the internal Docker network next to the backend. Only `/telegram/webhook` (on the bot's host) and the whole `STUDIO_HOST` should be reachable from the internet (nginx → `127.0.0.1:8000`). `/internal/notify` must stay internal.
- **Secrets**: they live only in the server's `.env`. Regenerate the production bot token in @BotFather before launch.
