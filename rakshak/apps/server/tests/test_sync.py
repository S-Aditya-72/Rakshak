"""Device sync relay: roles, routing, no conversation content on guardian devices, temporary-guardian invites."""

from __future__ import annotations

import json
import time

import pytest
from conftest import PHONE
from starlette.websockets import WebSocketDisconnect

TOKEN = "abcd-efgh-jkmn"


def join(ws, auth="", role="chat", name=""):
    ws.send_text(json.dumps({"auth": auth, "role": role, "name": name}))
    return ws.receive_json()


def drain(ws, n):
    return [ws.receive_json() for _ in range(n)]


def test_chat_frames_reach_chat_devices_only(make_client):
    c = make_client()
    with c.websocket_connect("/api/sync") as laptop, c.websocket_connect("/api/sync") as child, c.websocket_connect("/api/sync") as amma:
        assert join(laptop)["peers"] == 1
        join(child)
        drain(laptop, 1)
        join(amma, role="guardian")
        drain(laptop, 1), drain(child, 1)
        laptop.send_text(json.dumps({"to": ["chat"], "action": {"type": "push", "message": {"text": "hi"}}}))
        assert child.receive_json()["action"]["type"] == "push"
        # A projection for guardians reaches Amma; the chat devices do not get it.
        laptop.send_text(json.dumps({"to": ["guardian"], "projection": {"level": 2}}))
        assert amma.receive_json() == {"to": ["guardian"], "projection": {"level": 2}}
        child.send_text(json.dumps({"to": ["chat"], "hello": True}))
        assert laptop.receive_json()["hello"] is True  # Amma got neither the push nor the hello


def test_relay_drops_conversation_content_bound_for_a_guardian(make_client):
    c = make_client()
    with c.websocket_connect("/api/sync") as laptop, c.websocket_connect("/api/sync") as amma:
        join(laptop)
        join(amma, role="guardian")
        drain(laptop, 1)
        laptop.send_text(json.dumps({"to": ["guardian"], "action": {"type": "push", "message": {"text": "secret"}}}))
        laptop.send_text(json.dumps({"to": ["guardian"], "projection": {"alerts": [], "level": 3}}))
        assert amma.receive_json()["projection"]["level"] == 3  # the push never arrived
        stats = c.get("/api/sync/peers").json()
        assert stats["blockedFrames"] == 1
        guardian = next(p for p in stats["peers"] if p["role"] == "guardian")
        assert guardian["recent"] == ["projection"]


def test_guardian_cannot_send_to_temporary_guardians_or_inject_content(make_client):
    c = make_client()
    inv = c.post("/api/guardians/invites", json={"minutes": 5, "scope": "critical"}).json()
    with c.websocket_connect("/api/sync") as laptop, c.websocket_connect("/api/sync") as amma, c.websocket_connect("/api/sync") as rao:
        join(laptop)
        join(amma, role="guardian")
        drain(laptop, 1)
        assert join(rao, auth=inv["code"], name="Ms. Rao")["access"]["scope"] == "critical"
        drain(laptop, 1), drain(amma, 1)
        amma.send_text(json.dumps({"to": ["chat", "guardian", "critical"], "action": {"type": "respond"}}))
        assert laptop.receive_json()["action"]["type"] == "respond"
        laptop.send_text(json.dumps({"to": ["critical"], "projection": {"level": 3}}))
        assert rao.receive_json()["projection"]["level"] == 3  # nothing from Amma reached the critical-only guardian


def test_temporary_guardian_invite_lifecycle(make_client):
    c = make_client(client=PHONE, access_token=TOKEN)
    h = {"x-rakshak-token": TOKEN}
    inv = c.post("/api/guardians/invites", json={"minutes": 60, "scope": "all", "label": "School trip"}, headers=h).json()
    assert inv["code"].startswith("tg-") and inv["code"] != TOKEN
    tg = {"x-rakshak-token": inv["code"]}
    # The invite code opens health and its own status, nothing else (not the case, not other invites).
    assert c.get("/api/health", headers=tg).status_code == 200
    assert c.get("/api/guardians/me", headers=tg).json()["scope"] == "all"
    assert c.get("/api/state", headers=tg).status_code == 403
    assert c.post("/api/guardians/invites", json={}, headers=tg).status_code == 403
    with c.websocket_connect("/api/sync") as rao:
        first = join(rao, auth=inv["code"], role="chat", name="Ms. Rao")  # asking for "chat" does not make it one
        assert first["access"]["claimedBy"] == "Ms. Rao" and "guardians" not in first
        listed = c.get("/api/guardians", headers=h).json()["guardians"][0]
        assert listed["claimedBy"] == "Ms. Rao" and listed["connected"] is True and listed["state"] == "active"
        c.post(f"/api/guardians/{inv['id']}/revoke", headers=h).raise_for_status()
        assert rao.receive_json() == {"error": "revoked"}
        with pytest.raises(WebSocketDisconnect):
            rao.receive_text()
    assert c.get("/api/health", headers=tg).status_code == 401  # revoked code is just a wrong code now
    with c.websocket_connect("/api/sync") as again:
        assert join(again, auth=inv["code"]) == {"error": "expired"}


def test_invite_expires_on_the_server(make_client):
    c = make_client()
    inv = c.post("/api/guardians/invites", json={"minutes": 0.001, "scope": "critical"}).json()
    time.sleep(0.15)
    with c.websocket_connect("/api/sync") as ws:
        assert join(ws, auth=inv["code"]) == {"error": "expired"}
    assert c.get("/api/guardians").json()["guardians"][0]["state"] == "expired"


def test_sync_needs_the_access_code_from_a_phone(make_client):
    c = make_client(client=PHONE, access_token=TOKEN)
    with c.websocket_connect("/api/sync") as ws:
        assert join(ws, auth="wrong") == {"error": "unauthorized"}
        with pytest.raises(WebSocketDisconnect):
            ws.receive_text()
    with c.websocket_connect("/api/sync") as ws:
        assert join(ws, auth=TOKEN, role="guardian") == {"peers": 1, "guardians": []}
    assert c.get("/api/sync/peers", headers={"x-rakshak-token": TOKEN}).status_code == 403  # inspector: laptop only


def test_sync_rejects_other_websites(make_client):
    c = make_client()
    with pytest.raises(WebSocketDisconnect):
        with c.websocket_connect("/api/sync", headers={"origin": "https://evil.example"}) as ws:
            ws.receive_text()
    with c.websocket_connect("/api/sync", headers={"origin": "http://127.0.0.1:5280"}) as ws:
        assert join(ws)["peers"] == 1


def test_connect_info_is_laptop_only(make_client):
    c = make_client(access_token=TOKEN, host="0.0.0.0")
    info = c.get("/api/connect-info").json()
    assert info["token"] == TOKEN and info["lan"] is True
    phone = make_client(client=PHONE, access_token=TOKEN)
    assert phone.get("/api/connect-info", headers={"x-rakshak-token": TOKEN}).status_code == 403


def test_connect_info_offers_the_tunnel_address(make_client, tmp_path):
    c = make_client(access_token=TOKEN)
    assert c.get("/api/connect-info").json()["public"] is None
    (tmp_path / "public-url").write_text("https://quiet-river-1234.trycloudflare.com\n", encoding="utf-8")
    info = c.get("/api/connect-info").json()
    assert info["public"] == "https://quiet-river-1234.trycloudflare.com" and info["lan"] is False


def test_tunnel_traffic_needs_the_access_code(make_client):
    # cloudflared connects from 127.0.0.1 but adds Cf-Connecting-Ip: that is a remote phone, not the laptop.
    c = make_client(access_token=TOKEN)
    via_tunnel = {"cf-connecting-ip": "203.0.113.7", "x-forwarded-for": "203.0.113.7"}
    assert c.get("/api/state", headers=via_tunnel).status_code == 401
    assert c.get("/api/state", headers={**via_tunnel, "x-rakshak-token": TOKEN}).status_code == 200
    assert c.get("/api/connect-info", headers={**via_tunnel, "x-rakshak-token": TOKEN}).status_code == 403
    with pytest.raises(WebSocketDisconnect):
        with c.websocket_connect("/api/sync", headers=via_tunnel) as ws:
            ws.send_text(json.dumps({"auth": "wrong", "role": "chat"}))
            ws.receive_text()
            ws.receive_text()


def test_the_served_phone_app_may_open_the_relay(make_client):
    # A join link opened in a phone browser: the page and the socket share the tunnel's origin.
    c = make_client(access_token=TOKEN)
    host = "quiet-river-1234.trycloudflare.com"
    tunnel = {"host": host, "origin": f"https://{host}", "cf-connecting-ip": "203.0.113.7"}
    with c.websocket_connect("/api/sync", headers=tunnel) as ws:
        assert join(ws, auth=TOKEN)["peers"] == 1
    with pytest.raises(WebSocketDisconnect):
        with c.websocket_connect("/api/sync", headers={**tunnel, "origin": "https://evil.example"}) as ws:
            join(ws, auth=TOKEN)
