"""Client for the GOLOW backend's internal Telegram endpoints."""

import logging
from dataclasses import dataclass
from typing import Literal

import httpx

log = logging.getLogger(__name__)

LinkOutcome = Literal["LinkedExisting", "CreatedAccount", "AlreadyLinked", "conflict", "invalid", "error"]


AdminLoginOutcome = Literal["ok", "invalid", "not_admin", "throttled", "error"]


@dataclass(frozen=True)
class AdminLogin:
    outcome: AdminLoginOutcome
    user_id: int | None = None
    name: str | None = None


@dataclass(frozen=True)
class LinkResult:
    outcome: LinkOutcome
    user_id: int | None = None


class GolowApi:
    """POST /internal/telegram/link and /unlink with the shared X-Internal-Key."""

    def __init__(self, base_url: str, internal_key: str, client: httpx.AsyncClient | None = None) -> None:
        self._client = client or httpx.AsyncClient(base_url=base_url, timeout=httpx.Timeout(15.0, connect=10.0))
        self._headers = {"X-Internal-Key": internal_key}

    async def aclose(self) -> None:
        await self._client.aclose()

    async def link(
        self,
        telegram_user_id: int,
        phone: str,
        first_name: str | None,
        last_name: str | None,
        username: str | None,
        language_code: str | None = None,
    ) -> LinkResult:
        body = {
            "telegramUserId": telegram_user_id,
            "phone": phone,
            "firstName": first_name,
            "lastName": last_name,
            "username": username,
            # Picks the language of the notifications the backend sends through the bot.
            "languageCode": language_code,
        }
        response = await self._post("/internal/telegram/link", body)
        if response is None:
            return LinkResult("error")
        if response.status_code == 200:
            data = response.json().get("data") or {}
            outcome = data.get("outcome")
            if outcome in ("LinkedExisting", "CreatedAccount", "AlreadyLinked"):
                return LinkResult(outcome, data.get("userId"))
        if response.status_code == 409:
            return LinkResult("conflict")
        if response.status_code == 400:
            return LinkResult("invalid")
        log.error("Link failed for Telegram user %s: HTTP %s", telegram_user_id, response.status_code)
        return LinkResult("error")

    async def unlink(self, telegram_user_id: int) -> bool:
        response = await self._post("/internal/telegram/unlink", {"telegramUserId": telegram_user_id})
        return response is not None and response.status_code == 200

    async def admin_login(self, phone: str, password: str) -> AdminLogin:
        """Signs in with the admin platform's credentials (POST /auth/login) and confirms the account is an active
        admin by calling an admin-only endpoint, which applies the backend's own Admin policy. The backend session
        is revoked right after: the studio keeps its own session and never stores GOLOW tokens."""
        try:
            response = await self._client.post("/auth/login", json={"phone": phone, "password": password})
        except httpx.TransportError as exc:
            log.warning("GOLOW API /auth/login failed: %s", exc)
            return AdminLogin("error")
        if response.status_code == 429:
            return AdminLogin("throttled")
        if response.status_code in (400, 401, 403, 404):
            return AdminLogin("invalid")
        if response.status_code != 200:
            log.error("Studio login failed: HTTP %s", response.status_code)
            return AdminLogin("error")
        data = response.json().get("data") or {}
        access, refresh = data.get("accessToken"), data.get("refreshToken")
        if not access:
            return AdminLogin("invalid")
        auth = {"Authorization": f"Bearer {access}"}
        try:
            check = await self._client.get("/admin/auctions", params={"pageSize": 1}, headers=auth)
        except httpx.TransportError as exc:
            log.warning("GOLOW API admin check failed: %s", exc)
            check = None
        finally:
            try:
                await self._client.post("/auth/logout", json={"refreshToken": refresh}, headers=auth)
            except httpx.TransportError:
                pass
        if check is None:
            return AdminLogin("error")
        if check.status_code in (401, 403):
            return AdminLogin("not_admin")
        if check.status_code != 200:
            log.error("Studio admin check failed: HTTP %s", check.status_code)
            return AdminLogin("error")
        return AdminLogin("ok", data.get("userId"), data.get("fullName"))

    async def public_get(self, path: str, params: dict[str, str]) -> httpx.Response | None:
        """An anonymous GET on the public API (the studio's read-only proxy). No internal key is sent."""
        try:
            return await self._client.get(path, params=params)
        except httpx.TransportError as exc:
            log.warning("GOLOW API GET %s failed: %s", path, exc)
            return None

    async def _post(self, path: str, body: dict) -> httpx.Response | None:
        # Linking is idempotent on the backend, so one retry on a network error is safe.
        for attempt in (1, 2):
            try:
                return await self._client.post(path, json=body, headers=self._headers)
            except httpx.TransportError as exc:
                log.warning("GOLOW API %s failed (attempt %s): %s", path, attempt, exc)
        return None
