"""Device sync relay for the phones (WebSocket /api/sync) and temporary-guardian invites.

Every device says what it is when it connects:
  chat      the child's and the contact's phones, and the laptop (they hold the conversation)
  guardian  the parent's phone (master access code)
  temp      a temporary guardian (invite code from a QR; never the master code), scope "all" or "critical"

Frames carry `to`: a list of audiences. The relay delivers a frame only to devices in those audiences, and it never
delivers conversation content to a guardian device: a guardian-bound frame that contains message text or evidence is
dropped and counted. Invites expire on the server; a revoked or expired guardian is disconnected.
"""

from __future__ import annotations

import asyncio
import hmac
import json
import logging
import secrets
import time
import uuid
from collections import deque
from dataclasses import dataclass, field
from typing import Optional

from fastapi import WebSocket

log = logging.getLogger("rakshak.relay")

MAX_FRAME = 4_000_000  # a full state snapshot is well under this
AUDIENCES = ("chat", "guardian", "critical")
# Keys that only appear in conversation content (chat messages, typing drafts, model output). None of them may reach a
# guardian device.
CONTENT_KEYS = frozenset({"messages", "message", "text", "draft", "evidence", "lastRun", "analysis", "analyses", "run", "snapshot"})


def content_keys(o, found: Optional[set] = None) -> set:
    found = set() if found is None else found
    if isinstance(o, dict):
        for k, v in o.items():
            if k in CONTENT_KEYS:
                found.add(k)
            content_keys(v, found)
    elif isinstance(o, list):
        for v in o:
            content_keys(v, found)
    return found


@dataclass
class Invite:
    id: str
    secret: str
    scope: str  # all | critical
    created_at: float
    expires_at: float
    label: str = ""
    claimed_by: Optional[str] = None
    revoked: bool = False

    def active(self, now: Optional[float] = None) -> bool:
        return not self.revoked and (now or time.time()) < self.expires_at

    def view(self, connected: bool) -> dict:
        now = time.time()
        state = "revoked" if self.revoked else "expired" if now >= self.expires_at else "active"
        return {
            "id": self.id, "scope": self.scope, "label": self.label, "claimedBy": self.claimed_by, "state": state,
            "createdAt": int(self.created_at * 1000), "expiresAt": int(self.expires_at * 1000), "connected": connected,
        }


@dataclass(eq=False)  # identity equality, so peers can live in a set
class Peer:
    ws: WebSocket
    role: str  # chat | guardian | temp
    name: str
    addr: str
    scope: str = "all"
    invite: Optional[str] = None
    id: str = field(default_factory=lambda: uuid.uuid4().hex[:8])
    connected_at: float = field(default_factory=time.time)
    frames: int = 0
    bytes: int = 0
    recent: deque = field(default_factory=lambda: deque(maxlen=12))

    @property
    def audience(self) -> str:
        return "chat" if self.role == "chat" else "critical" if (self.role == "temp" and self.scope == "critical") else "guardian"

    def view(self) -> dict:
        return {
            "id": self.id, "role": self.role, "name": self.name, "addr": self.addr, "scope": self.scope, "audience": self.audience,
            "connectedAt": int(self.connected_at * 1000), "frames": self.frames, "bytes": self.bytes, "recent": list(self.recent),
        }


def summarize(frame: dict) -> str:
    """Short label for the inspector: what kind of thing a device received (never its content)."""
    if isinstance(frame.get("action"), dict):
        return f"action:{frame['action'].get('type', '?')}"
    for k in ("projection", "snapshot", "hello", "guardians"):
        if k in frame:
            return k
    return "frame"


class Relay:
    def __init__(self) -> None:
        self.peers: set[Peer] = set()
        self.invites: dict[str, Invite] = {}
        self.blocked = 0  # guardian-bound frames dropped because they carried conversation content

    # ---------- invites ----------

    def create_invite(self, minutes: float, scope: str, label: str = "") -> Invite:
        now = time.time()
        inv = Invite(id=f"g-{uuid.uuid4().hex[:6]}", secret=f"tg-{secrets.token_urlsafe(12)}", scope=scope, created_at=now, expires_at=now + minutes * 60, label=label[:40])
        self.invites[inv.id] = inv
        return inv

    def invite_for(self, secret: str) -> Optional[Invite]:
        for inv in self.invites.values():
            if hmac.compare_digest(inv.secret.encode(), secret.encode()):
                return inv if inv.active() else None
        return None

    def guardians(self) -> list[dict]:
        live = {p.invite for p in self.peers if p.invite}
        return [inv.view(inv.id in live) for inv in sorted(self.invites.values(), key=lambda i: i.created_at)]

    async def revoke(self, invite_id: str) -> bool:
        inv = self.invites.get(invite_id)
        if not inv:
            return False
        inv.revoked = True
        await self.drop_invite_peers(invite_id, "revoked")
        await self.announce()
        return True

    async def drop_invite_peers(self, invite_id: str, why: str) -> None:
        for p in [p for p in self.peers if p.invite == invite_id]:
            try:
                await p.ws.send_text(json.dumps({"error": why}))
                await p.ws.close(code=4410)
            except Exception:
                pass
            self.peers.discard(p)

    async def expire_loop(self) -> None:
        while True:
            await asyncio.sleep(5)
            now = time.time()
            for inv in self.invites.values():
                if not inv.revoked and now >= inv.expires_at and any(p.invite == inv.id for p in self.peers):
                    await self.drop_invite_peers(inv.id, "expired")
                    await self.announce()

    # ---------- delivery ----------

    async def send(self, p: Peer, frame: dict, text: Optional[str] = None) -> None:
        text = text if text is not None else json.dumps(frame)
        try:
            await p.ws.send_text(text)
        except Exception:
            self.peers.discard(p)
            return
        p.frames += 1
        p.bytes += len(text)
        p.recent.append(summarize(frame))

    async def announce(self) -> None:
        """Every device learns how many devices are connected; chat and guardian devices also get the guardian list."""
        guardians = self.guardians()
        for p in list(self.peers):
            msg: dict = {"peers": len(self.peers)}
            if p.role != "temp":
                msg["guardians"] = guardians
            else:
                inv = self.invites.get(p.invite or "")
                msg["access"] = inv.view(True) if inv else None
            try:
                await p.ws.send_text(json.dumps(msg))
            except Exception:
                self.peers.discard(p)

    async def route(self, sender: Peer, text: str) -> None:
        if len(text) > MAX_FRAME:
            return
        try:
            frame = json.loads(text)
        except json.JSONDecodeError:
            return
        if not isinstance(frame, dict):
            return
        to = frame.get("to")
        audiences = {a for a in (to if isinstance(to, list) else [to]) if a in AUDIENCES}
        if sender.role != "chat":
            # Guardian devices never hold conversation content, so they can only send to chat and guardian devices.
            audiences &= {"chat", "guardian"}
        leak: Optional[set] = None
        for p in list(self.peers):
            if p is sender or p.audience not in audiences:
                continue
            if p.audience != "chat":
                if leak is None:
                    leak = content_keys(frame)
                if leak:
                    self.blocked += 1
                    log.warning("relay: dropped a frame with %s bound for a guardian device", sorted(leak))
                    continue
            await self.send(p, frame, text)

    def stats(self) -> dict:
        return {"peers": [p.view() for p in sorted(self.peers, key=lambda p: p.connected_at)], "blockedFrames": self.blocked, "guardians": self.guardians()}
