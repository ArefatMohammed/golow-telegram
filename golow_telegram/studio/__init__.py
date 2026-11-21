"""GOLOW Live Studio: the OBS control panel and scenes for TikTok Live, served at live.golow.et.

* Admins sign in with their GOLOW admin platform credentials (phone + password). The backend checks them and
  confirms an active admin; the browser gets only the studio's own signed session cookie. The latest admin's
  GOLOW tokens stay in this server's memory for the new-user feed (see feed.py) until they sign out.
* OBS Browser Sources can't sign in, so the panel mints signed, expiring scene links (``?key=…``).
* Auction data comes through a read-only proxy of four public GET endpoints (no CORS setup needed on the API).
  Live events come straight from the API's anonymous SignalR hub.
"""

import json
import logging
import re
import time
from collections import deque
from pathlib import Path

from fastapi import APIRouter, FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from ..api import GolowApi, Tokens
from ..config import Settings
from .feed import NewUserFeed
from .tokens import sign, verify

log = logging.getLogger(__name__)

STATIC = Path(__file__).parent / "static"
COOKIE = "golow_studio"
#: Pages the panel session opens; the scenes also accept a scene key.
PANEL_PAGES = {"index.html"}
SCENE_PAGES = {"overlay.html", "board.html", "reveal.html"}
#: The only API paths the proxy forwards (all anonymous GETs). Query parameters are filtered too.
PROXY_PATHS = [
    re.compile(r"^auctions$"),
    re.compile(r"^auctions/[0-9]{1,9}$"),
    re.compile(r"^auctions/[0-9]{1,9}/bids$"),
    re.compile(r"^auctions/[0-9]{1,9}/result$"),
]
PROXY_PARAMS = {"status", "page", "pageSize"}


class LoginBody(BaseModel):
    phone: str = Field(min_length=4, max_length=32)
    password: str = Field(min_length=1, max_length=256)


class _Attempts:
    """Login attempts per client IP. The backend rate-limits by IP too, but it sees this server's IP for everyone,
    so without this one person could lock every admin out."""

    def __init__(self, limit: int = 10, window: float = 600.0) -> None:
        self.limit, self.window = limit, window
        self._hits: dict[str, deque[float]] = {}

    def allow(self, ip: str, now: float | None = None) -> bool:
        now = time.monotonic() if now is None else now
        hits = self._hits.setdefault(ip, deque())
        while hits and now - hits[0] > self.window:
            hits.popleft()
        if len(hits) >= self.limit:
            return False
        hits.append(now)
        if len(self._hits) > 10_000:  # forget idle IPs
            self._hits = {k: v for k, v in self._hits.items() if v and now - v[-1] <= self.window}
        return True


def _secret(settings: Settings) -> bytes:
    assert settings.studio_secret is not None
    return settings.studio_secret.get_secret_value().encode()


def session_of(request: Request) -> dict | None:
    settings: Settings = request.app.state.settings
    token = request.cookies.get(COOKIE)
    return verify(_secret(settings), token, "session") if token else None


def scene_key_ok(request: Request) -> bool:
    settings: Settings = request.app.state.settings
    key = request.query_params.get("key") or request.headers.get("x-studio-key")
    return bool(key) and verify(_secret(settings), key, "scene") is not None


def build_router(settings: Settings, api: GolowApi, feed: NewUserFeed) -> APIRouter:
    router = APIRouter(prefix="/studio")
    attempts = _Attempts()

    def page(name: str) -> FileResponse:
        # No caching: a new deploy must reach OBS without anyone clearing its cache.
        return FileResponse(STATIC / name, headers={"Cache-Control": "no-store", "X-Frame-Options": "SAMEORIGIN"})

    @router.get("", include_in_schema=False)
    async def root_redirect() -> RedirectResponse:
        return RedirectResponse("studio/", status_code=307)

    @router.get("/")
    @router.get("/index.html")
    async def panel(request: Request) -> Response:
        if session_of(request) is None:
            return RedirectResponse("login", status_code=303)
        return page("index.html")

    @router.get("/login")
    async def login_page(request: Request) -> Response:
        if session_of(request) is not None:
            return RedirectResponse("./", status_code=303)
        return page("login.html")

    @router.get("/{name}.html")
    async def scene(name: str, request: Request) -> Response:
        filename = f"{name}.html"
        if filename not in SCENE_PAGES:
            raise HTTPException(status_code=404)
        if session_of(request) is None and not scene_key_ok(request):
            return Response("This scene link has expired or is invalid. Copy a fresh link from the control panel.", status_code=401, media_type="text/plain")
        return page(filename)

    @router.post("/auth/login")
    async def login(body: LoginBody, request: Request) -> JSONResponse:
        ip = request.client.host if request.client else "unknown"
        if not attempts.allow(ip):
            return JSONResponse({"error": "Too many attempts. Try again in a few minutes."}, status_code=429)
        result = await api.admin_login(body.phone.strip(), body.password)
        if result.outcome == "invalid":
            return JSONResponse({"error": "Wrong phone number or password."}, status_code=401)
        if result.outcome == "not_admin":
            log.warning("Studio login refused for a non-admin account (user %s).", result.user_id)
            return JSONResponse({"error": "This account is not an active GOLOW admin."}, status_code=403)
        if result.outcome == "throttled":
            return JSONResponse({"error": "Too many attempts. Try again in a few minutes."}, status_code=429)
        if result.outcome != "ok":
            return JSONResponse({"error": "Couldn't reach GOLOW. Try again in a moment."}, status_code=502)
        log.info("Studio sign-in by admin %s.", result.user_id)
        # The admin's GOLOW tokens stay on this server (memory only) for the new-user feed.
        await feed.use_admin(result.user_id, Tokens(result.access_token or "", result.refresh_token or ""))
        ttl = settings.studio_session_hours * 3600
        token = sign(_secret(settings), "session", {"uid": result.user_id, "name": result.name or "Admin"}, ttl)
        response = JSONResponse({"ok": True, "name": result.name})
        response.set_cookie(COOKIE, token, max_age=ttl, httponly=True, secure=settings.studio_cookie_secure, samesite="strict", path="/")
        return response

    @router.post("/auth/logout")
    async def logout(request: Request) -> JSONResponse:
        session = session_of(request)
        if session is not None:
            await feed.drop_admin(session.get("uid"))
        response = JSONResponse({"ok": True})
        response.delete_cookie(COOKIE, path="/", httponly=True, secure=settings.studio_cookie_secure, samesite="strict")
        return response

    @router.get("/auth/me")
    async def me(request: Request) -> JSONResponse:
        session = session_of(request)
        if session is None:
            return JSONResponse({"error": "Signed out."}, status_code=401)
        return JSONResponse({"id": session.get("uid"), "name": session.get("name"), "expiresAt": session["exp"]})

    @router.post("/auth/scene-key")
    async def scene_key(request: Request) -> JSONResponse:
        session = session_of(request)
        if session is None:
            return JSONResponse({"error": "Signed out."}, status_code=401)
        ttl = settings.studio_scene_key_days * 86400
        key = sign(_secret(settings), "scene", {"uid": session.get("uid")}, ttl)
        return JSONResponse({"key": key, "expiresAt": int(time.time()) + ttl})

    @router.get("/config.js")
    async def config_js(request: Request) -> Response:
        session = session_of(request)
        config = {
            "hubUrl": settings.golow_api_origin + "/hubs/auctions",
            "apiHost": settings.golow_api_origin.split("://", 1)[-1],
            "user": {"name": session.get("name")} if session else None,
        }
        body = "window.GOLOW_STUDIO = " + json.dumps(config).replace("<", "\\u003c") + ";\n"
        return Response(body, media_type="application/javascript", headers={"Cache-Control": "no-store"})

    @router.get("/feed/welcome")
    async def welcome_feed(request: Request, after: int = -1) -> JSONResponse:
        """New GOLOW users for the overlay's welcome popup: display names only."""
        if session_of(request) is None and not scene_key_ok(request):
            return JSONResponse({"error": "Signed out."}, status_code=401)
        await feed.maybe_poll()
        seq, events = feed.since(after)
        return JSONResponse(
            {"seq": seq, "status": feed.status, "events": [{"seq": e.seq, "name": e.name, "source": e.source} for e in events]},
            headers={"Cache-Control": "no-store"},
        )

    @router.get("/api/{path:path}")
    async def proxy(path: str, request: Request) -> Response:
        if session_of(request) is None and not scene_key_ok(request):
            return JSONResponse({"success": False, "message": "Signed out."}, status_code=401)
        if not any(p.match(path) for p in PROXY_PATHS):
            raise HTTPException(status_code=404)
        params = {k: v[:40] for k, v in request.query_params.items() if k in PROXY_PARAMS}
        upstream = await api.public_get("/" + path, params)
        if upstream is None:
            return JSONResponse({"success": False, "message": "GOLOW API unreachable."}, status_code=502)
        return Response(upstream.content, status_code=upstream.status_code, media_type="application/json", headers={"Cache-Control": "no-store"})

    return router


class StudioHostMiddleware:
    """On the studio's own host (live.golow.et), every path maps into /studio, so that host serves the studio
    at / and can never reach this service's webhook, /internal/notify or health check."""

    def __init__(self, app, host: str) -> None:
        self.app = app
        self.host = host

    async def __call__(self, scope, receive, send):
        if scope["type"] in ("http", "websocket"):
            host = ""
            for name, value in scope.get("headers") or []:
                if name == b"host":
                    host = value.decode("latin-1").split(":", 1)[0].lower()
                    break
            if host == self.host and not scope["path"].startswith("/studio/"):
                path = "/studio" + scope["path"] if scope["path"] != "/studio" else "/studio/"
                scope = dict(scope, path=path, raw_path=path.encode())
        await self.app(scope, receive, send)


def mount(app: FastAPI, settings: Settings, api: GolowApi, feed: NewUserFeed) -> None:
    app.include_router(build_router(settings, api, feed))
    for folder in ("js", "css", "sounds"):
        (STATIC / folder).mkdir(exist_ok=True)
        app.mount(f"/studio/{folder}", StaticFiles(directory=STATIC / folder), name=f"studio-{folder}")
    app.add_middleware(StudioHostMiddleware, host=settings.studio_host)
