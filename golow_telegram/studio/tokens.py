"""Small signed tokens (HMAC-SHA256) for studio sessions and OBS scene links. Not encrypted: they carry only an
admin's user id and display name, never GOLOW credentials or tokens."""

import base64
import hashlib
import hmac
import json
import time


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def _mac(secret: bytes, kind: str, body: str) -> str:
    # The kind is part of what is signed, so a scene key can never be used as a session cookie (or the reverse).
    return _b64(hmac.new(secret, f"{kind}.{body}".encode(), hashlib.sha256).digest())


def sign(secret: bytes, kind: str, claims: dict, ttl_seconds: int, now: float | None = None) -> str:
    payload = dict(claims, exp=int((time.time() if now is None else now) + ttl_seconds))
    body = _b64(json.dumps(payload, separators=(",", ":")).encode())
    return f"{body}.{_mac(secret, kind, body)}"


def verify(secret: bytes, token: str, kind: str, now: float | None = None) -> dict | None:
    try:
        body, mac = token.split(".", 1)
        if not hmac.compare_digest(mac, _mac(secret, kind, body)):
            return None
        payload = json.loads(_unb64(body))
    except (ValueError, TypeError):
        return None
    if not isinstance(payload, dict) or not isinstance(payload.get("exp"), int):
        return None
    if payload["exp"] < (time.time() if now is None else now):
        return None
    return payload
