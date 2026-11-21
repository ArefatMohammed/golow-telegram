"""New-user feed for the overlay's welcome popup.

Two sources, merged and de-duplicated by GOLOW user id:
* The bot itself: a Telegram user whose phone share created a GOLOW account (instant).
* GET /admin/users, polled at most every POLL_SECONDS while a scene is asking, with the token of the admin who
  last signed in to the studio (kept in memory only; a restart or a sign-out ends it until someone signs in).

Only a display name leaves this module: first name + last initial ("Abebe K."). Never a phone number.
"""

import asyncio
import logging
import time
from collections import deque
from dataclasses import dataclass
from datetime import datetime

import httpx

from ..api import GolowApi, Tokens

log = logging.getLogger(__name__)

POLL_SECONDS = 5.0
PAGE_SIZE = 50


def display_name(first: str | None, last: str | None = None) -> str | None:
    """'Abebe Kebede' → 'Abebe K.'; a single name stays as it is. None when there is nothing usable."""
    parts = " ".join(p for p in (first, last) if p).split()
    if not parts:
        return None
    name = parts[0][:24]
    return f"{name} {parts[1][0]}." if len(parts) > 1 else name


def _parse_time(value: str | None) -> float | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None


@dataclass(frozen=True)
class Welcome:
    seq: int
    name: str | None
    source: str


class NewUserFeed:
    def __init__(self, api: GolowApi) -> None:
        self.api = api
        self.tokens: Tokens | None = None
        self.admin_id: int | None = None
        self.status = "signed_out"  # ok | signed_out | error
        self._events: deque[Welcome] = deque(maxlen=100)
        self._seq = 0
        self._welcomed: set[int] = set()
        self._seen: set[int] | None = None  # user ids already registered when polling started
        self._last_poll = 0.0
        self._lock = asyncio.Lock()

    # ---------- admin token ----------
    async def use_admin(self, admin_id: int | None, tokens: Tokens) -> None:
        """The latest admin sign-in provides the token; the one it replaces is revoked."""
        old, self.tokens, self.admin_id = self.tokens, tokens, admin_id
        self.status = "ok"
        if old is not None:
            await self.api.revoke(old)

    async def drop_admin(self, admin_id: int | None) -> None:
        """An admin signed out: if their token is the one in use, revoke it and stop polling."""
        if self.tokens is not None and admin_id == self.admin_id:
            old, self.tokens = self.tokens, None
            self.status = "signed_out"
            await self.api.revoke(old)

    # ---------- events ----------
    def push(self, user_id: int | None, name: str | None, source: str) -> None:
        if user_id is not None:
            if user_id in self._welcomed:
                return
            self._welcomed.add(user_id)
            if self._seen is not None:
                self._seen.add(user_id)
        self._seq += 1
        self._events.append(Welcome(self._seq, name, source))

    def since(self, after: int) -> tuple[int, list[Welcome]]:
        """Events after `after`. A negative `after` (a scene that just loaded) gets only the current position."""
        if after < 0:
            return self._seq, []
        return self._seq, [e for e in self._events if e.seq > after]

    # ---------- polling /admin/users ----------
    async def maybe_poll(self) -> None:
        if self.tokens is None or time.monotonic() - self._last_poll < POLL_SECONDS:
            return
        async with self._lock:
            if self.tokens is None or time.monotonic() - self._last_poll < POLL_SECONDS:
                return
            self._last_poll = time.monotonic()
            try:
                users = await self._newest_users()
            except httpx.TransportError as exc:
                log.warning("New-user feed: GOLOW API unreachable: %s", exc)
                self.status = "error"
                return
            if users is None:
                return
            self.status = "ok"
            ids = {u["id"] for u in users if isinstance(u.get("id"), int)}
            if self._seen is None:  # first look: these are already registered, welcome nobody
                self._seen = ids | self._welcomed
                return
            fresh = [u for u in users if u.get("id") in ids - self._seen and str(u.get("role") or "").lower() != "admin"]
            fresh.sort(key=lambda u: _parse_time(u.get("createdAt")) or 0)
            for u in fresh:
                self.push(u["id"], display_name(u.get("fullName")), str(u.get("signupSource") or "website").lower())
            self._seen |= ids

    async def _get_users(self, page: int) -> dict | None:
        assert self.tokens is not None
        response = await self.api.admin_get("/admin/users", {"page": page, "pageSize": PAGE_SIZE}, self.tokens)
        if response.status_code == 401:
            renewed = await self.api.refresh(self.tokens)
            if renewed is None:
                log.warning("New-user feed: the admin session expired; an admin needs to sign in to the studio again.")
                self.tokens, self.status = None, "signed_out"
                return None
            self.tokens = renewed
            response = await self.api.admin_get("/admin/users", {"page": page, "pageSize": PAGE_SIZE}, self.tokens)
        if response.status_code != 200:
            log.error("New-user feed: /admin/users answered HTTP %s", response.status_code)
            self.status = "error" if response.status_code != 403 else "signed_out"
            if response.status_code == 403:
                self.tokens = None
            return None
        return response.json().get("data") or {}

    async def _newest_users(self) -> list[dict] | None:
        """The newest registrations, whichever way the API orders the list."""
        data = await self._get_users(1)
        if data is None:
            return None
        items = data.get("items") or []
        total = data.get("totalCount") or len(items)
        if len(items) >= 2 and total > len(items):
            first, last = _parse_time(items[0].get("createdAt")), _parse_time(items[-1].get("createdAt"))
            if first is not None and last is not None and first < last:  # oldest first: the newest are on the last page
                last_page = -(-total // PAGE_SIZE)
                tail = await self._get_users(last_page)
                if tail is None:
                    return None
                items = (tail.get("items") or []) + items
        return items
