"""Client for the GOLOW backend's internal Telegram endpoints."""

import logging
from dataclasses import dataclass
from typing import Literal

import httpx

log = logging.getLogger(__name__)

LinkOutcome = Literal["LinkedExisting", "CreatedAccount", "AlreadyLinked", "conflict", "invalid", "error"]


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
    ) -> LinkResult:
        body = {
            "telegramUserId": telegram_user_id,
            "phone": phone,
            "firstName": first_name,
            "lastName": last_name,
            "username": username,
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

    async def _post(self, path: str, body: dict) -> httpx.Response | None:
        # Linking is idempotent on the backend, so one retry on a network error is safe.
        for attempt in (1, 2):
            try:
                return await self._client.post(path, json=body, headers=self._headers)
            except httpx.TransportError as exc:
                log.warning("GOLOW API %s failed (attempt %s): %s", path, attempt, exc)
        return None
