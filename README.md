# golow-telegram

**GolowBidBot**: the Telegram bot service for the GOLOW Mini App. It is the chat side of GOLOW on Telegram: users open the Mini App, connect their account by sharing their phone number once, and get their auction notifications in the chat.

| `ENVIRONMENT` | Bot | Mini App | Backend | Live Studio |
|---|---|---|---|---|
| `dev` | `@GolowBidDevBot` | https://dev.golow.et/tg | https://api-dev.golow.et | https://live-dev.golow.et |
| `prod` | `@GolowBidBot` | https://golow.et/tg | https://api.golow.et | https://live.golow.et |

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

See [.env.example](.env.example). **`ENVIRONMENT=dev|prod` picks every GOLOW address at once** (the table above); set only the secrets. Any address can still be overridden, and the service **refuses to start** when `ENVIRONMENT=prod` points at the dev API or the reverse. The startup log names the environment, API, Mini App and studio host.

| Variable | Description |
|---|---|
| `ENVIRONMENT` | `dev` (default) or `prod` |
| `BOT_TOKEN` | That environment's bot token from @BotFather |
| `INTERNAL_KEY` | Shared secret: the **same value** as that backend's `Telegram__InternalKey`, at least 32 characters |
| `WEBHOOK_URL` | Public HTTPS URL of `/telegram/webhook`. Leave it empty to use polling. |
| `WEBHOOK_SECRET` | Random secret that Telegram sends back on every webhook call |
| `STUDIO_SECRET` | Signs Live Studio sessions and scene links, at least 32 characters, different per environment. Empty: studio off |
| `STUDIO_SESSION_HOURS` / `STUDIO_SCENE_KEY_DAYS` | Panel session length (12) and scene link lifetime (30) |
| `GOLOW_API_URL`, `MINIAPP_URL`, `WEBSITE_URL`, `BOT_USERNAME`, `STUDIO_HOST` | Overrides of the preset (normally left out) |

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
- **Dev and production**: each environment is its own container with its own `.env` (see [Deployment](#deployment)). The panel shows a **DEV** or **PRODUCTION** badge, and scene links are tied to their environment's secret.
- **Host isolation**: requests whose `Host` is `STUDIO_HOST` are served the studio and nothing else; the webhook, `/internal/notify` and `/health` aren't reachable on that host. Studio pages send a strict Content-Security-Policy (only the site's own scripts, plus the pinned SignalR client).
- Strings are in `golow_telegram/studio/static/js/strings.js` and follow the bot's glossary (auction = ጨረታ, bid = ዋጋ). **A native speaker should review the Amharic before going live.** Recorded clips go in `golow_telegram/studio/static/sounds/<kind>.mp3` (`new-bid`, `almost`, `closed`, `winner`, `rules`, `cancel`, `hype`).

### Streaming platforms

- **Layouts**: the panel's **Streaming to** picker sets the canvas and the areas each platform's own UI covers; the scene links carry it as `?platform=`. Fine-tune per OBS source with `?safeTop=`, `?safeBottom=`, `?safeRight=`, `?safeLeft=` (pixels). The safe areas are estimates: check them on a test stream.

  | Platform | Canvas | Safe areas (top / bottom / right / left, px) |
  |---|---|---|
  | TikTok Live (default) | 1080×1920 | 150 / 560 / 150 / 40 |
  | Instagram Live | 1080×1920 | 210 / 480 / 60 / 40 |
  | YouTube Live, vertical | 1080×1920 | 180 / 450 / 160 / 40 |
  | YouTube Live, 16:9 | 1920×1080 | 40 / 110 / 40 / 40 |
  | Facebook Live, 16:9 | 1920×1080 | 40 / 130 / 40 / 40 |

- **QR code on the banner**: viewers scan it to open the on-air auction in the GOLOW bot (`t.me/<bot>?start=auction_<id>`), which hands them the Mini App on that auction. Generated by the server (`/qr.svg`), so it works offline in OBS and follows the auction that's on air.
- **OBS control** (obs-websocket v5, built into OBS 28+): enable *Tools → WebSocket Server Settings* in OBS and connect from the panel. It shows whether OBS is streaming (with the time) or recording, lists the scenes to switch with one click, and can switch to a chosen scene (e.g. "Reveal") when you start the animated reveal and back after 30–90 s. The address and password stay in that browser. The panel reaches OBS on the computer it runs on, so use it inside OBS (Custom Browser Dock) or a browser on the streaming PC.
- Reading TikTok chat or gifts isn't included: TikTok has no official API for that.

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

## Deployment

Dev and production run side by side, one container each, with the files in [`deploy/`](deploy):

1. **Images**: CI builds `ghcr.io/<owner>/golow-telegram:development` from the `development` branch and `:main` from `main`. Put the owner in `deploy/dev.compose.env` / `deploy/prod.compose.env`.
2. **App settings**: create `.env.dev` (`ENVIRONMENT=dev`) and `.env.prod` (`ENVIRONMENT=prod`) next to `deploy/`, from `.env.example`. Each has its own bot token, internal key, webhook secret and studio secret.
3. **Start**: `docker compose -p golow-bot-dev --env-file deploy/dev.compose.env -f deploy/docker-compose.yml up -d`, and the same with `prod`. Dev listens on `127.0.0.1:8100`, production on `127.0.0.1:8000`.
4. **nginx + TLS**: install `deploy/nginx/live-dev.golow.et.conf` and `live.golow.et.conf` (they send the studio hosts to those ports), then `sudo certbot --nginx -d live-dev.golow.et -d live.golow.et --redirect` adds HTTPS. Each bot's webhook location goes to its own port too.
5. **DNS**: `A` records for `live-dev` and `live` pointing to the server (done: 178.104.188.38).

- **Network**: run it on the internal Docker network next to the backend. Only `/telegram/webhook` (on the bot's host) and the whole `STUDIO_HOST` should be reachable from the internet. `/internal/notify` must stay internal.
- **One instance per environment**: the studio's welcome feed and its admin session live in that process. After a restart, an admin signs in to the panel once to bring back website sign-up welcomes.
- **Secrets**: they live only in the server's `.env.dev` / `.env.prod`. Regenerate the production bot token in @BotFather before launch.
