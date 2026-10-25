"""RAKSHAK local inference service (FastAPI). Binds to 127.0.0.1 by default.

Run:  python -m rakshak_server          (from apps/server, inside .venv)
"""

from __future__ import annotations

import asyncio
import hmac
import json
import logging
import socket
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

from urllib.parse import urlsplit

from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.requests import HTTPConnection

from .analyzers import AnalyzerError, ChatGPTAnalyzer, QwenAnalyzer
from .config import Settings, load_settings
from .contract import AlertIn, AlertWithdrawIn, AnalyzeRequest, BlockIn, DismissalIn, NewConversation, NewMessage, NewParticipant, Participant, SnapshotIn
from .db import DEFAULT_CHILD, Store, new_id
from .pipeline import AnalysisRejected, Pipeline
from .relay import Peer, Relay
from .roberta import RobertaClassifier
from .scenarios import list_scenarios, load_history, load_scenario

log = logging.getLogger("rakshak")

LOOPBACK = {"127.0.0.1", "::1", "localhost"}
# Set by tunnels and reverse proxies (cloudflared, ngrok, Tailscale serve). A loopback peer carrying one of these is
# relaying a remote client, so it is treated as remote.
PROXY_HEADERS = ("x-forwarded-for", "cf-connecting-ip", "forwarded", "x-real-ip")

# A temporary guardian's invite code only opens these: it is not the master access code.
TEMP_GUARDIAN_PATHS = ("/api/health", "/api/guardians/me")


class InviteIn(BaseModel):
    minutes: float = Field(default=240, gt=0, le=7 * 24 * 60)
    scope: str = Field(default="critical", pattern="^(all|critical)$")
    label: str = ""


def lan_addresses() -> list[str]:
    """IPv4 addresses phones can use to reach this machine (for the connect QR code)."""
    found: list[str] = []
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ip = info[4][0]
            if not ip.startswith("127.") and ip not in found:
                found.append(ip)
    except OSError:
        pass
    return found


def public_url(data_dir: Path) -> Optional[str]:
    """The tunnel's internet address, written by `npm run server:remote` while the tunnel is up."""
    try:
        url = (data_dir / "public-url").read_text(encoding="utf-8").strip()
    except OSError:
        return None
    return url if url.startswith("https://") else None


def is_local(request: HTTPConnection) -> bool:
    """True only for requests made on this machine (the laptop's browser, directly or through the Vite proxy)."""
    host = request.client.host if request.client else ""
    return host in LOOPBACK and not any(h in request.headers for h in PROXY_HEADERS)


def require_laptop(request: Request) -> None:
    if not is_local(request):
        raise HTTPException(403, {"code": "local_only", "message": "Only available on the server laptop."})


def require_local(request: Request) -> None:
    # The ChatGPT backend runs on the owner's plan; another person's device must never trigger it (SIWC Terms §2).
    if not is_local(request):
        raise HTTPException(403, {"code": "local_only", "message": "The ChatGPT backend can only be used from the server laptop."})


def create_app(settings: Optional[Settings] = None, *, roberta: Optional[RobertaClassifier] = None, qwen: Optional[QwenAnalyzer] = None, chatgpt: Optional[ChatGPTAnalyzer] = None, load_models: bool = True) -> FastAPI:
    s = settings or load_settings()
    store = Store(s.db_path)
    store.ensure_child()
    rob = roberta if roberta is not None else (RobertaClassifier(s.roberta_model, s.roberta_device) if s.roberta_enabled else None)
    qw = qwen or QwenAnalyzer(s)
    cg = chatgpt or ChatGPTAnalyzer(s, s.data_dir / "companion.secret")
    pipe = Pipeline(s, store, rob, qw, cg)
    started = time.time()
    relay = Relay()

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        loop = asyncio.get_running_loop()
        expiry = asyncio.create_task(relay.expire_loop())
        if load_models and rob is not None and not rob.ready:
            loop.run_in_executor(None, rob.load)  # load once, in the background
        if load_models and s.warmup:
            asyncio.create_task(qw.warmup())
        yield
        expiry.cancel()

    app = FastAPI(title="RAKSHAK inference service", version="0.2.0", lifespan=lifespan)
    app.state.store, app.state.pipeline, app.state.settings, app.state.relay = store, pipe, s, relay

    @app.middleware("http")
    async def access_guard(request: Request, call_next):
        if request.url.path.startswith("/api/") and not is_local(request):
            given = request.headers.get("x-rakshak-token", "")
            invite = relay.invite_for(given) if given.startswith("tg-") else None
            if invite and request.url.path in TEMP_GUARDIAN_PATHS:
                request.state.invite = invite
                return await call_next(request)
            if invite:
                return JSONResponse(status_code=403, content={"error": {"code": "temporary_guardian", "message": "A temporary guardian can only receive alerts."}})
            if not s.access_token or not hmac.compare_digest(given.encode(), s.access_token.encode()):
                msg = "Wrong or missing access code." if s.access_token else "Remote access is off. Start the server with `npm run server:lan`."
                return JSONResponse(status_code=401, content={"error": {"code": "unauthorized", "message": msg}})
        return await call_next(request)

    # Added after the guard so it wraps it: preflights are answered here, and 401s still carry CORS headers.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(s.cors_origins),
        # The web app run with `npm run dev` on someone's own laptop (any port), joining this server as a phone would.
        allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$",
        allow_methods=["GET", "POST"],
        allow_headers=["content-type", "x-rakshak-token"],
    )

    @app.exception_handler(AnalysisRejected)
    async def _rejected(_: Request, e: AnalysisRejected):
        return JSONResponse(status_code=e.status, content={"error": {"code": e.code, "message": e.message}})

    def child_of(child_id: Optional[str]) -> str:
        cid = child_id or DEFAULT_CHILD["id"]
        if store.generation(cid) < 0:
            raise HTTPException(404, "unknown protected child")
        return cid

    # ---------- health ----------

    @app.get("/api/health")
    async def health():
        q, c = await asyncio.gather(qw.status(), cg.status())
        return {
            "server": {"ok": True, "uptimeS": round(time.time() - started), "host": s.host, "port": s.port},
            "roberta": {
                "enabled": rob is not None,
                "ready": bool(rob and rob.ready),
                "model": s.roberta_model,
                "device": rob.device if rob else None,
                "loadMs": round(rob.load_ms) if rob and rob.load_ms else None,
                "error": rob.error if rob else "disabled",
            },
            "qwen": q,
            "chatgpt": {**c, "enabled": s.chatgpt_enabled, "consent": bool(pipe.chatgpt_consent)},
        }

    # ---------- state ----------

    @app.get("/api/state")
    def state(childId: Optional[str] = None, backend: str = "local_hybrid"):
        cid = child_of(childId)
        parts = store.participants(cid)
        child = next(p for p in parts if p.id == cid)
        return {
            "child": child.dump(),
            "participants": [p.dump() for p in parts],
            "conversations": [c.dump() for c in store.conversations(cid)],
            "messages": [m.dump() for m in store.messages(cid)],
            "evidence": [e.dump() for e in store.evidence(cid, backend)],
            "runs": [r for r in store.runs(cid) if r.get("backend") == backend],
            "snapshots": store.snapshots(cid, backend),
            "alerts": [a for a in store.alerts(cid) if a["backend"] == backend],
            "alerted": store.alerted(cid, backend),
            "dismissals": store.dismissals(cid),
            "blocks": store.blocks(cid),
            "firstSeen": store.first_seen(cid),
            "scenarioId": store.scenario_id(cid),
            "case": store.case_meta(cid),
        }

    @app.post("/api/participants")
    def add_participant(body: NewParticipant, childId: Optional[str] = None):
        cid = child_of(childId)
        p = Participant(id=body.id or new_id("p"), display_name=body.display_name, role=body.role)
        return store.upsert_participant(cid, p).dump()

    @app.post("/api/conversations")
    def add_conversation(body: NewConversation, childId: Optional[str] = None):
        cid = child_of(childId)
        known = {p.id for p in store.participants(cid)}
        missing = [p for p in body.participant_ids if p not in known]
        if missing:
            raise HTTPException(400, f"unknown participants: {missing}")
        if body.kind == "private" and len(set(body.participant_ids) - {cid}) != 1:
            raise HTTPException(400, "a private chat has exactly one other participant")
        if body.kind == "group" and len(set(body.participant_ids) - {cid}) < 2:
            raise HTTPException(400, "a group chat needs at least two other participants")
        return store.create_conversation(cid, body.id or new_id("c"), body.kind, body.title, body.participant_ids).dump()

    @app.post("/api/messages")
    def add_message(body: NewMessage):
        conv = store.conversation(body.conversation_id)
        if not conv:
            raise HTTPException(404, "unknown conversation")
        if body.sender_id not in conv.participant_ids:
            raise HTTPException(400, "sender is not a participant of this conversation")
        m = store.add_message(conv.child_id, body.id or new_id("m"), conv.id, body.sender_id, body.day, body.time, body.text.strip())
        return m.dump()

    # ---------- analysis ----------

    @app.post("/api/analyze")
    async def analyze(body: AnalyzeRequest, request: Request):
        if body.backend == "chatgpt_cloud":
            require_local(request)
        return await pipe.analyze(body)

    @app.get("/api/cases/{child_id}/evidence")
    def evidence(child_id: str, backend: str = "local_hybrid"):
        return [e.dump() for e in store.evidence(child_of(child_id), backend)]

    @app.get("/api/cases/{child_id}/risk-history")
    def risk_history(child_id: str, backend: str = "local_hybrid"):
        return store.snapshots(child_of(child_id), backend)

    @app.post("/api/cases/{child_id}/snapshots")
    def add_snapshot(child_id: str, body: SnapshotIn):
        store.add_snapshot(child_of(child_id), body.model_dump())
        return {"ok": True}

    @app.post("/api/cases/{child_id}/alerts")
    def add_alert(child_id: str, body: AlertIn):
        """Records an alert the engine decided to fire. Returns created=false if this level was already alerted."""
        return {"created": store.add_alert(child_of(child_id), body.model_dump())}

    @app.post("/api/cases/{child_id}/alerts/{alert_id}/withdraw")
    def withdraw_alert(child_id: str, alert_id: str, body: AlertWithdrawIn):
        """The evidence behind an alert was retracted on a fuller reading of the chat: mark it withdrawn."""
        return {"withdrawn": store.withdraw_alert(child_of(child_id), alert_id, body.backend, body.reason)}

    @app.post("/api/cases/{child_id}/dismissals")
    def add_dismissal(child_id: str, body: DismissalIn):
        store.add_dismissal(child_of(child_id), body.day, body.track_key)
        return {"ok": True}

    @app.post("/api/cases/{child_id}/blocks")
    def add_block(child_id: str, body: BlockIn):
        store.add_block(child_of(child_id), body.contact_id, body.day)
        return {"ok": True}

    # ---------- scenarios & reset ----------

    @app.get("/api/scenarios")
    def scenarios():
        return list_scenarios(s.scenarios_dir)

    @app.post("/api/scenarios/{scenario_id}/load")
    def scenario_load(scenario_id: str):
        try:
            pipe.latest_requested.clear()
            return load_scenario(store, s.scenarios_dir, scenario_id)
        except KeyError:
            raise HTTPException(404, "unknown scenario")

    @app.post("/api/scenarios/{scenario_id}/history")
    def scenario_history(scenario_id: str, checkpoint: Optional[str] = None, force: bool = False, upto: Optional[int] = None):
        """Mode B: save an earlier conversation up to a checkpoint (messages only, no analysis), idempotently."""
        try:
            out = load_history(store, s.scenarios_dir, scenario_id, checkpoint, force, upto)
        except KeyError:
            raise HTTPException(404, "unknown scenario or checkpoint")
        except ValueError as e:
            raise HTTPException(400, str(e))
        if not out["reused"]:
            pipe.latest_requested.clear()
        return out

    @app.post("/api/case/continue")
    def case_continue(childId: Optional[str] = None):
        """Turn a scripted playback case into a live one at its current point, keeping all memory.

        Only messages that playback already saved exist on the server, so nothing after this point can reach a model.
        """
        cid = child_of(childId)
        meta = store.case_meta(cid)
        if meta["origin"] not in ("scripted", "history"):
            raise HTTPException(409, "only a scripted or history case can be continued")
        n = len(store.messages(cid))
        if n == 0:
            raise HTTPException(400, "nothing has been played yet")
        store.set_origin(cid, "history", n)
        return store.case_meta(cid)

    @app.post("/api/reset")
    def reset(childId: Optional[str] = None, mode: str = "live"):
        """Clears the synthetic case and its memory. mode=live seeds the default Free Chat contact."""
        cid = childId or DEFAULT_CHILD["id"]
        store.reset_child(cid, origin="fresh" if mode == "live" else None)
        pipe.latest_requested.clear()
        if mode == "live":
            store.upsert_participant(cid, Participant(id="p-kabir", display_name="Kabir", role="contact"))
            store.create_conversation(cid, "c-live-kabir", "private", "Kabir", ["p-kabir"])
        return {"ok": True, "generation": store.generation(cid)}

    # ---------- device sync ----------
    # Carries the web app's store changes between devices (laptop, child, contact and guardian phones). The relay never
    # stores them, and never delivers conversation content to a guardian device (relay.py).

    def origin_ok(ws: WebSocket) -> bool:
        origin = ws.headers.get("origin")
        if not origin or origin in s.cors_origins:
            return True
        return urlsplit(origin).hostname in LOOPBACK  # the laptop's own dev server, on any port

    @app.websocket("/api/sync")
    async def sync(ws: WebSocket):
        if not origin_ok(ws):
            await ws.close(code=4403)
            return
        await ws.accept()
        # First frame: {"auth": "<access code or invite code>", "role": "chat" | "guardian", "name": "..."}.
        # Browsers cannot set headers on a WebSocket.
        try:
            hello = json.loads(await asyncio.wait_for(ws.receive_text(), 5))
            assert isinstance(hello, dict)
        except Exception:
            await ws.close(code=4400)
            return
        given = str(hello.get("auth", ""))
        name = str(hello.get("name", ""))[:40]
        addr = ws.client.host if ws.client else "?"
        invite = relay.invite_for(given) if given.startswith("tg-") else None
        if invite:
            role, scope = "temp", invite.scope
            invite.claimed_by = name or invite.claimed_by or "Temporary guardian"
        else:
            master = bool(s.access_token) and hmac.compare_digest(given.encode(), s.access_token.encode())
            expired = given.startswith("tg-")  # an invite code that is revoked or past its time, even on the laptop
            if expired or not (master or is_local(ws)):
                await ws.send_text(json.dumps({"error": "expired" if expired else "unauthorized"}))
                await ws.close(code=4410 if expired else 4401)
                return
            role, scope = ("guardian" if hello.get("role") == "guardian" else "chat"), "all"
        peer = Peer(ws=ws, role=role, name=name or role, addr=addr, scope=scope, invite=invite.id if invite else None)
        relay.peers.add(peer)
        await relay.announce()
        try:
            while True:
                await relay.route(peer, await ws.receive_text())
        except WebSocketDisconnect:
            pass
        finally:
            relay.peers.discard(peer)
            await relay.announce()

    @app.get("/api/sync/peers")
    def sync_peers(request: Request):
        """What each connected device is and what it has received (the laptop's device inspector)."""
        require_laptop(request)
        return relay.stats()

    @app.get("/api/connect-info")
    def connect_info(request: Request):
        """Addresses and access code for the connect QR code shown on the laptop."""
        require_laptop(request)
        return {
            "addresses": lan_addresses() if s.host in ("0.0.0.0", "::") else [],
            "port": s.port,
            "token": s.access_token,
            "lan": s.host in ("0.0.0.0", "::"),
            # Internet address of a tunnel to this server (`npm run server:remote` writes it), or None.
            "public": public_url(s.data_dir) if s.access_token else None,
        }

    # ---------- temporary guardians ----------

    @app.post("/api/guardians/invites")
    async def create_invite(body: InviteIn):
        inv = relay.create_invite(body.minutes, body.scope, body.label)
        await relay.announce()
        return {"id": inv.id, "code": inv.secret, "scope": inv.scope, "expiresAt": int(inv.expires_at * 1000)}

    @app.get("/api/guardians")
    def guardians():
        return {"guardians": relay.guardians()}

    @app.get("/api/guardians/me")
    def guardian_me(request: Request):
        inv = getattr(request.state, "invite", None)
        if not inv:
            raise HTTPException(404, "not a temporary guardian")
        return inv.view(True)

    @app.post("/api/guardians/{invite_id}/revoke")
    async def revoke_invite(invite_id: str):
        if not await relay.revoke(invite_id):
            raise HTTPException(404, "unknown invite")
        return {"ok": True}

    # ---------- ChatGPT (Sign in with ChatGPT companion) ----------

    async def companion(method: str, path: str, body: Optional[dict] = None, timeout: float = 10):
        try:
            return await cg.call(method, path, body, timeout)
        except AnalyzerError as e:
            status = {"chatgpt_unavailable": 503, "chatgpt_not_signed_in": 401, "chatgpt_permission_denied": 403, "chatgpt_usage_limit": 429}.get(e.code, 502)
            raise HTTPException(status, {"code": e.code, "message": e.message})

    @app.get("/api/chatgpt/status")
    async def chatgpt_status():
        return {**(await cg.status()), "enabled": s.chatgpt_enabled, "consent": bool(pipe.chatgpt_consent)}

    @app.post("/api/chatgpt/signin")
    async def chatgpt_signin(request: Request):
        require_local(request)
        return await companion("POST", "/signin", {})

    @app.post("/api/chatgpt/signout")
    async def chatgpt_signout(request: Request):
        require_local(request)
        return await companion("POST", "/signout", {})

    @app.get("/api/chatgpt/models")
    async def chatgpt_models(request: Request):
        require_local(request)
        return await companion("GET", "/models", timeout=20)

    @app.post("/api/chatgpt/consent")
    async def chatgpt_consent(request: Request):
        require_local(request)
        body = await request.json()
        pipe.chatgpt_consent = time.time() if body.get("accepted") else None
        return {"consent": bool(pipe.chatgpt_consent)}

    return app


def new_request_id() -> str:
    return uuid.uuid4().hex


def dumps(o) -> str:
    return json.dumps(o)
