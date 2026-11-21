import asyncio

import pytest
import respx
from fastapi.testclient import TestClient
from pydantic import SecretStr

from golow_telegram.api import GolowApi, LinkResult, Tokens
from golow_telegram.app import create_app
from golow_telegram.handlers import on_contact
from golow_telegram.studio import feed as feed_mod
from golow_telegram.studio.feed import NewUserFeed, display_name
from golow_telegram.studio.tokens import sign

from .conftest import KEY, make_message

API = "https://api.test/api/v1"
SECRET = "s" * 40


def users(*rows, total=None):
    items = [{"id": i, "fullName": n, "role": r, "signupSource": "Website", "createdAt": f"2026-11-21T10:00:{i:02d}Z"} for i, n, r in rows]
    return {"success": True, "data": {"items": items, "page": 1, "pageSize": 50, "totalCount": total or len(items)}}


def test_display_name_never_more_than_first_name_and_initial():
    assert display_name("Abebe Kebede Tesfaye") == "Abebe K."
    assert display_name("Abebe", "Kebede") == "Abebe K."
    assert display_name("ሙሉጌታ") == "ሙሉጌታ"
    assert display_name("  ", None) is None


@respx.mock
def test_feed_welcomes_only_users_registered_after_it_started(monkeypatch):
    monkeypatch.setattr(feed_mod, "POLL_SECONDS", 0)
    route = respx.get(f"{API}/admin/users")
    feed = NewUserFeed(GolowApi(API, KEY))

    async def run():
        await feed.use_admin(1, Tokens("acc", "ref"))
        route.respond(200, json=users((3, "Old User", "User")))
        await feed.maybe_poll()  # baseline: nobody welcomed
        assert feed.since(0) == (0, [])
        route.respond(200, json=users((5, "Sara Alemu", "User"), (4, "Admin Person", "Admin"), (3, "Old User", "User")))
        await feed.maybe_poll()
        seq, events = feed.since(0)
        assert [e.name for e in events] == ["Sara A."]
        feed.push(5, "Sara A.", "telegram")  # the same user from the bot is not welcomed twice
        assert feed.since(0)[0] == seq
        assert feed.since(-1) == (seq, [])  # a scene that just loaded doesn't replay old welcomes

    asyncio.run(run())
    assert route.calls[0].request.headers["authorization"] == "Bearer acc"


@respx.mock
def test_feed_refreshes_an_expired_token_and_stops_when_refresh_fails(monkeypatch):
    monkeypatch.setattr(feed_mod, "POLL_SECONDS", 0)
    route = respx.get(f"{API}/admin/users")
    refresh = respx.post(f"{API}/auth/refresh")
    feed = NewUserFeed(GolowApi(API, KEY))

    async def run():
        await feed.use_admin(1, Tokens("old", "ref"))
        route.side_effect = [respx.MockResponse(401), respx.MockResponse(200, json=users((1, "A B", "User")))]
        refresh.respond(200, json={"success": True, "data": {"accessToken": "new", "refreshToken": "ref2"}})
        await feed.maybe_poll()
        assert feed.tokens == Tokens("new", "ref2") and feed.status == "ok"
        route.side_effect = None
        route.respond(401)
        refresh.respond(401)
        await feed.maybe_poll()
        assert feed.tokens is None and feed.status == "signed_out"

    asyncio.run(run())


def test_telegram_signup_is_welcomed_with_first_name_and_initial(settings):
    feed = NewUserFeed(GolowApi(API, KEY))
    api = type("A", (), {})()

    async def link(*a, **k):
        return LinkResult("CreatedAccount", 77)

    api.link = link
    msg = make_message(contact={"user_id": 42, "phone_number": "+251911000000"})
    asyncio.run(on_contact(msg, api, settings, welcome_feed=feed))
    assert [(e.name, e.source) for e in feed.since(0)[1]] == [("Abebe K.", "telegram")]


@pytest.fixture
def studio_settings(settings):
    return settings.model_copy(update={"studio_secret": SecretStr(SECRET), "studio_cookie_secure": False})


def test_welcome_endpoint_needs_a_key_and_returns_names_only(studio_settings, bot):
    app = create_app(studio_settings, bot=bot, api=GolowApi(API, KEY))
    with TestClient(app) as c:
        assert c.get("/studio/feed/welcome").status_code == 401
        key = sign(SECRET.encode(), "scene", {"uid": 1}, 600)
        first = c.get(f"/studio/feed/welcome?key={key}").json()
        assert first == {"seq": 0, "status": "signed_out", "events": []}
        app.state.dp["welcome_feed"].push(9, "Sara A.", "telegram")
        body = c.get(f"/studio/feed/welcome?key={key}&after=0").json()
        assert body["events"] == [{"seq": 1, "name": "Sara A.", "source": "telegram"}]
