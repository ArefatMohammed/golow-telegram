import httpx
import pytest
import respx
from pydantic import SecretStr
from fastapi.testclient import TestClient

from golow_telegram.api import GolowApi
from golow_telegram.app import create_app
from golow_telegram.studio import _Attempts
from golow_telegram.studio.tokens import sign, verify

from .conftest import KEY

SECRET = "s" * 40
API = "https://api.test/api/v1"


@pytest.fixture
def studio_settings(settings):
    return settings.model_copy(update={"studio_secret": SecretStr(SECRET), "studio_cookie_secure": False})


def make_client(studio_settings, bot, host="testserver"):
    app = create_app(studio_settings, bot=bot, api=GolowApi(studio_settings.golow_api_url, KEY))
    return TestClient(app, base_url=f"http://{host}")


def login_routes(role_ok=True):
    respx.post(f"{API}/auth/login").respond(200, json={"success": True, "data": {"accessToken": "acc", "refreshToken": "ref", "userId": 5, "fullName": "Hana", "role": "Admin"}})
    respx.get(f"{API}/admin/auctions").respond(200 if role_ok else 403, json={"success": role_ok})
    return respx.post(f"{API}/auth/logout").respond(200, json={"success": True})


def test_tokens_roundtrip_expiry_and_kind():
    s = SECRET.encode()
    t = sign(s, "session", {"uid": 1}, 60, now=1000)
    assert verify(s, t, "session", now=1030)["uid"] == 1
    assert verify(s, t, "session", now=1061) is None
    assert verify(s, t, "scene", now=1030) is None  # a session can't be used as a scene key
    assert verify(b"x" * 40, t, "session", now=1030) is None
    assert verify(s, t[:-2] + "AA", "session", now=1030) is None
    assert verify(s, "garbage", "session") is None


def test_studio_is_off_without_secret(settings, bot):
    app = create_app(settings, bot=bot, api=GolowApi(settings.golow_api_url, KEY))
    with TestClient(app) as c:
        assert c.get("/studio/login").status_code == 404


def test_pages_need_a_session(studio_settings, bot):
    with make_client(studio_settings, bot) as c:
        r = c.get("/studio/", follow_redirects=False)
        assert r.status_code == 303 and r.headers["location"] == "login"
        assert c.get("/studio/login").status_code == 200
        assert c.get("/studio/overlay.html").status_code == 401
        assert c.get("/studio/api/auctions").status_code == 401
        assert c.post("/studio/auth/scene-key").status_code == 401
        assert c.get("/studio/js/bus.js").status_code == 200  # static assets are public


@respx.mock
def test_admin_login_sets_session_and_revokes_backend_tokens(studio_settings, bot):
    logout = login_routes()
    with make_client(studio_settings, bot) as c:
        r = c.post("/studio/auth/login", json={"phone": "0911000000", "password": "pw"})
        assert r.status_code == 200 and r.json()["name"] == "Hana"
        cookie = r.headers["set-cookie"]
        assert "httponly" in cookie.lower() and "samesite=strict" in cookie.lower()
        assert "acc" not in cookie and "ref" not in cookie  # no GOLOW tokens leave the server
        assert c.get("/studio/").status_code == 200
        assert c.get("/studio/auth/me").json()["name"] == "Hana"
        assert "Hana" in c.get("/studio/config.js").text
    assert logout.called
    assert logout.calls[0].request.headers["authorization"] == "Bearer acc"
    sent = respx.calls[0].request
    assert sent.url.path == "/api/v1/auth/login" and "x-internal-key" not in sent.headers


@respx.mock
def test_non_admin_is_refused(studio_settings, bot):
    login_routes(role_ok=False)
    with make_client(studio_settings, bot) as c:
        r = c.post("/studio/auth/login", json={"phone": "0911000000", "password": "pw"})
        assert r.status_code == 403 and "set-cookie" not in r.headers


@respx.mock
def test_wrong_password_and_api_down(studio_settings, bot):
    route = respx.post(f"{API}/auth/login")
    with make_client(studio_settings, bot) as c:
        route.respond(401, json={"success": False})
        assert c.post("/studio/auth/login", json={"phone": "0911000000", "password": "x"}).status_code == 401
        route.side_effect = httpx.ConnectError("down")
        assert c.post("/studio/auth/login", json={"phone": "0911000000", "password": "x"}).status_code == 502


def test_login_attempts_are_limited_per_ip():
    a = _Attempts(limit=3, window=60)
    assert all(a.allow("1.1.1.1", now=t) for t in (0, 1, 2))
    assert not a.allow("1.1.1.1", now=3)
    assert a.allow("2.2.2.2", now=3)
    assert a.allow("1.1.1.1", now=70)


@respx.mock
def test_scene_key_opens_scenes_and_proxy_but_not_the_panel(studio_settings, bot):
    login_routes()
    respx.get(f"{API}/auctions").respond(200, json={"success": True, "data": {"items": [], "totalCount": 0}})
    with make_client(studio_settings, bot) as c:
        c.post("/studio/auth/login", json={"phone": "0911000000", "password": "pw"})
        key = c.post("/studio/auth/scene-key").json()["key"]
    with make_client(studio_settings, bot) as obs:  # a fresh client: no cookie, like an OBS Browser Source
        assert obs.get(f"/studio/overlay.html?key={key}").status_code == 200
        assert obs.get("/studio/api/auctions?status=live&pageSize=50", headers={"X-Studio-Key": key}).status_code == 200
        assert obs.get("/studio/", follow_redirects=False).status_code == 303
        assert obs.get("/studio/overlay.html?key=nope").status_code == 401


@respx.mock
def test_proxy_forwards_only_public_gets(studio_settings, bot):
    key = sign(SECRET.encode(), "scene", {"uid": 1}, 600)
    detail = respx.get(f"{API}/auctions/7").respond(200, json={"success": True, "data": {"id": 7}})
    bids = respx.get(f"{API}/auctions/7/bids").respond(403, json={"success": False, "message": "Not revealed"})
    with make_client(studio_settings, bot) as c:
        h = {"X-Studio-Key": key}
        assert c.get("/studio/api/auctions/7?evil=1", headers=h).json()["data"]["id"] == 7
        assert "evil" not in str(detail.calls[0].request.url)
        assert c.get("/studio/api/auctions/7/bids?page=1&pageSize=100", headers=h).status_code == 403
        assert bids.called
        for path in ("admin/auctions", "auctions/7/bids/mine", "auth/me", "internal/telegram/link", "auctions/../admin/users"):
            assert c.get(f"/studio/api/{path}", headers=h).status_code == 404


def test_studio_host_serves_only_the_studio(studio_settings, bot):
    with make_client(studio_settings, bot, host="live.golow.et") as c:
        r = c.get("/", follow_redirects=False)
        assert r.status_code == 303 and r.headers["location"] == "login"
        assert c.get("/login").status_code == 200
        assert c.get("/js/bus.js").status_code == 200
        # The bot's own endpoints are unreachable on the studio host.
        assert c.post("/internal/notify", json={}, headers={"X-Internal-Key": KEY}).status_code in (404, 405)
        assert c.post("/telegram/webhook", json={}).status_code in (404, 405)
        assert c.get("/health").status_code == 404
    with make_client(studio_settings, bot) as c:  # other hosts are unchanged
        assert c.get("/health").status_code == 200
