import httpx
import pytest
import respx

from golow_telegram.api import GolowApi

BASE = "https://api.test/api/v1"


@pytest.mark.asyncio
@respx.mock
async def test_link_sends_key_and_reads_outcome():
    route = respx.post(f"{BASE}/internal/telegram/link").respond(200, json={"success": True, "data": {"outcome": "CreatedAccount", "userId": 5}})
    api = GolowApi(BASE, "secret-key")
    result = await api.link(7, "0911999888", "Sara", None, "sara_t")
    assert result.outcome == "CreatedAccount" and result.user_id == 5
    sent = route.calls.last.request
    assert sent.headers["X-Internal-Key"] == "secret-key"
    assert b'"telegramUserId":7' in sent.content.replace(b" ", b"")
    await api.aclose()


@pytest.mark.parametrize(("status", "outcome"), [(409, "conflict"), (400, "invalid"), (500, "error"), (401, "error")])
@pytest.mark.asyncio
@respx.mock
async def test_link_errors_map_to_outcomes(status, outcome):
    respx.post(f"{BASE}/internal/telegram/link").respond(status, json={"success": False})
    api = GolowApi(BASE, "k")
    assert (await api.link(7, "0911", None, None, None)).outcome == outcome
    await api.aclose()


@pytest.mark.asyncio
@respx.mock
async def test_link_retries_once_on_network_error():
    route = respx.post(f"{BASE}/internal/telegram/link")
    route.side_effect = [httpx.ConnectError("down"), httpx.Response(200, json={"data": {"outcome": "AlreadyLinked", "userId": 1}})]
    api = GolowApi(BASE, "k")
    assert (await api.link(7, "0911", None, None, None)).outcome == "AlreadyLinked"
    assert route.call_count == 2
    await api.aclose()
