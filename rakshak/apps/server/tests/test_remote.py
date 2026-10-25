"""Remote access for the Android app: access code, CORS, device sync, and the ChatGPT backend staying local-only."""

from __future__ import annotations

import json

import pytest
from conftest import PHONE, analyze, post_msg
from starlette.websockets import WebSocketDisconnect

TOKEN = "abcd-efgh-jkmn"


def test_laptop_needs_no_access_code(make_client):
    c = make_client(access_token=TOKEN)
    assert c.get("/api/health").status_code == 200


def test_phone_needs_the_access_code(make_client):
    c = make_client(client=PHONE, access_token=TOKEN)
    assert c.get("/api/health").status_code == 401
    assert c.get("/api/health", headers={"x-rakshak-token": "wrong"}).json()["error"]["code"] == "unauthorized"
    assert c.get("/api/health", headers={"x-rakshak-token": TOKEN}).status_code == 200


def test_phone_is_refused_when_no_code_is_configured(make_client):
    c = make_client(client=PHONE)
    r = c.get("/api/health", headers={"x-rakshak-token": ""})
    assert r.status_code == 401
    assert "server:lan" in r.json()["error"]["message"]


def test_tunnelled_request_counts_as_remote(make_client):
    # cloudflared connects from 127.0.0.1 but adds the visitor's address.
    c = make_client(access_token=TOKEN)
    assert c.get("/api/health", headers={"cf-connecting-ip": "203.0.113.9"}).status_code == 401
    assert c.get("/api/health", headers={"x-forwarded-for": "203.0.113.9", "x-rakshak-token": TOKEN}).status_code == 200


def test_cors_allows_the_android_app_only(make_client):
    c = make_client(client=PHONE, access_token=TOKEN)
    pre = {"access-control-request-method": "POST", "access-control-request-headers": "content-type,x-rakshak-token"}
    ok = c.options("/api/analyze", headers={"origin": "http://localhost", **pre})
    assert ok.status_code == 200
    assert ok.headers["access-control-allow-origin"] == "http://localhost"
    bad = c.options("/api/analyze", headers={"origin": "https://evil.example", **pre})
    assert "access-control-allow-origin" not in bad.headers
    # A refused request still carries CORS headers, so the app can show "wrong access code" instead of a network error.
    denied = c.get("/api/health", headers={"origin": "http://localhost"})
    assert denied.status_code == 401
    assert denied.headers["access-control-allow-origin"] == "http://localhost"


def test_phone_can_use_the_local_backend(make_client):
    c = make_client(client=PHONE, access_token=TOKEN)
    c.headers["x-rakshak-token"] = TOKEN
    c.post("/api/scenarios/s2-bullying/load").raise_for_status()
    post_msg(c, "s2-c-dev", "p-dev", "loser")
    assert analyze(c, "s2-c-dev").status_code == 200


def test_chatgpt_backend_is_local_only(make_client):
    c = make_client(client=PHONE, access_token=TOKEN)
    c.headers["x-rakshak-token"] = TOKEN
    assert c.get("/api/chatgpt/status").status_code == 200  # read-only status is fine
    for path in ("/api/chatgpt/signin", "/api/chatgpt/signout", "/api/chatgpt/consent"):
        r = c.post(path, json={"accepted": True})
        assert r.status_code == 403, path
        assert r.json()["detail"]["code"] == "local_only"
    assert c.get("/api/chatgpt/models").status_code == 403
    c.post("/api/scenarios/s2-bullying/load").raise_for_status()
    post_msg(c, "s2-c-dev", "p-dev", "loser")
    assert analyze(c, "s2-c-dev", backend="chatgpt_cloud", trigger="owner_button", model="gpt-test").status_code == 403


# Device sync relay: tests/test_sync.py


def test_cors_allows_the_web_app_on_another_laptop(make_client):
    # `npm run dev` on a teammate's own laptop joins a remote server from http://localhost:<port>.
    c = make_client(client=PHONE, access_token="abcd-efgh-jkmn")
    pre = {"access-control-request-method": "GET", "access-control-request-headers": "x-rakshak-token"}
    assert c.options("/api/health", headers={"origin": "http://localhost:5280", **pre}).headers.get("access-control-allow-origin") == "http://localhost:5280"
    assert c.options("/api/health", headers={"origin": "https://localhost", **pre}).headers.get("access-control-allow-origin") == "https://localhost"
    assert "access-control-allow-origin" not in c.options("/api/health", headers={"origin": "https://evil.example", **pre}).headers
