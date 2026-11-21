import pytest
from pydantic import ValidationError

from golow_telegram.config import Settings

BASE = {"bot_token": "1:x", "internal_key": "k" * 40, "_env_file": None}


def test_dev_is_the_default_preset():
    s = Settings(**BASE)
    assert s.environment == "dev"
    assert (s.golow_api_url, s.miniapp_url, s.bot_username, s.studio_host) == (
        "https://api-dev.golow.et/api/v1", "https://dev.golow.et/tg", "GolowBidDevBot", "live-dev.golow.et")
    assert s.golow_api_origin == "https://api-dev.golow.et"


def test_prod_preset_and_aliases():
    s = Settings(**BASE, environment="Production")
    assert s.environment == "prod"
    assert (s.golow_api_url, s.miniapp_url, s.website_url, s.bot_username, s.studio_host) == (
        "https://api.golow.et/api/v1", "https://golow.et/tg", "https://golow.et", "GolowBidBot", "live.golow.et")


def test_explicit_values_win_over_the_preset():
    s = Settings(**BASE, environment="prod", studio_host="Studio.Example.ET", bot_username="@OtherBot", miniapp_url="https://x.test/tg/")
    assert (s.studio_host, s.bot_username, s.miniapp_url) == ("studio.example.et", "OtherBot", "https://x.test/tg")


def test_prod_refuses_the_dev_api_and_dev_refuses_the_prod_api():
    with pytest.raises(ValidationError, match="dev API"):
        Settings(**BASE, environment="prod", golow_api_url="https://api-dev.golow.et/api/v1/")
    with pytest.raises(ValidationError, match="prod API"):
        Settings(**BASE, environment="dev", golow_api_url="https://api.golow.et/api/v1")


def test_unknown_environment_is_rejected():
    with pytest.raises(ValidationError):
        Settings(**BASE, environment="staging")


def test_internal_api_address_keeps_the_public_one_for_browsers():
    s = Settings(**BASE, environment="prod", golow_api_url="http://wagago-prod-backend:8080/api/v1")
    assert s.golow_api_url == "http://wagago-prod-backend:8080/api/v1"
    assert s.golow_api_origin == "https://api.golow.et"  # the studio's hub and CSP use this
    with pytest.raises(ValidationError, match="PUBLIC_API_URL"):
        Settings(**BASE, environment="prod", public_api_url="https://api-dev.golow.et")
