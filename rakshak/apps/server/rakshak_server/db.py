"""SQLite case memory: protected children, participants, conversations, messages, evidence, runs, snapshots, alerts.

Everything is keyed by the protected child, so all of one child's chats, days and evidence form one case.
Synthetic demo data only.
"""

from __future__ import annotations

import json
import sqlite3
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Iterable, Optional

from .contract import CUE_CATEGORY, Conversation, EvidenceEvent, Message, Participant

SCHEMA = """
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS protected_children (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  generation INTEGER NOT NULL DEFAULT 0,
  scenario_id TEXT
);
CREATE TABLE IF NOT EXISTS participants (
  id TEXT NOT NULL,
  child_id TEXT NOT NULL REFERENCES protected_children(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL,
  PRIMARY KEY (child_id, id)
);
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  child_id TEXT NOT NULL REFERENCES protected_children(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  created_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS conversation_participants (
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  participant_id TEXT NOT NULL,
  PRIMARY KEY (conversation_id, participant_id)
);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  child_id TEXT NOT NULL REFERENCES protected_children(id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id TEXT NOT NULL,
  day INTEGER NOT NULL,
  time TEXT NOT NULL,
  seq INTEGER NOT NULL,
  text TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'text'
);
CREATE INDEX IF NOT EXISTS ix_messages_conv ON messages(conversation_id, seq);
CREATE TABLE IF NOT EXISTS cases (
  child_id TEXT NOT NULL REFERENCES protected_children(id) ON DELETE CASCADE,
  backend TEXT NOT NULL,
  alerted TEXT NOT NULL DEFAULT '{}',
  updated_at REAL NOT NULL,
  PRIMARY KEY (child_id, backend)
);
CREATE TABLE IF NOT EXISTS evidence_events (
  key TEXT PRIMARY KEY,
  child_id TEXT NOT NULL REFERENCES protected_children(id) ON DELETE CASCADE,
  backend TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  sender_id TEXT NOT NULL,
  target_id TEXT,
  target_basis TEXT NOT NULL,
  cue TEXT NOT NULL,
  category TEXT NOT NULL,
  day INTEGER NOT NULL,
  seq INTEGER NOT NULL,
  p REAL NOT NULL,
  modifier TEXT NOT NULL,
  status TEXT NOT NULL,
  agreement TEXT NOT NULL,
  sources TEXT NOT NULL,
  rationale TEXT NOT NULL,
  run_id TEXT NOT NULL,
  updated_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_evidence_child ON evidence_events(child_id, backend);
CREATE TABLE IF NOT EXISTS analysis_runs (
  id TEXT PRIMARY KEY,
  child_id TEXT NOT NULL REFERENCES protected_children(id) ON DELETE CASCADE,
  backend TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  upto_seq INTEGER NOT NULL,
  status TEXT NOT NULL,
  result TEXT NOT NULL,
  created_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_runs_conv ON analysis_runs(conversation_id, backend, upto_seq);
CREATE TABLE IF NOT EXISTS risk_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  child_id TEXT NOT NULL REFERENCES protected_children(id) ON DELETE CASCADE,
  backend TEXT NOT NULL,
  run_id TEXT,
  day INTEGER NOT NULL,
  score REAL NOT NULL,
  level INTEGER NOT NULL,
  stage TEXT NOT NULL,
  category TEXT NOT NULL,
  dominant_track TEXT,
  trace TEXT NOT NULL,
  evidence_keys TEXT NOT NULL,
  created_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS alerts (
  id TEXT PRIMARY KEY,
  child_id TEXT NOT NULL REFERENCES protected_children(id) ON DELETE CASCADE,
  backend TEXT NOT NULL,
  track_key TEXT NOT NULL,
  level INTEGER NOT NULL,
  day INTEGER NOT NULL,
  time TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS dismissals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  child_id TEXT NOT NULL REFERENCES protected_children(id) ON DELETE CASCADE,
  day INTEGER NOT NULL,
  track_key TEXT
);
CREATE TABLE IF NOT EXISTS blocks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  child_id TEXT NOT NULL REFERENCES protected_children(id) ON DELETE CASCADE,
  contact_id TEXT NOT NULL,
  day INTEGER NOT NULL
);
"""

DEFAULT_CHILD = {"id": "p-meera", "display_name": "Meera"}

# Columns added after the first release. Added in place when missing, so existing databases keep working.
MIGRATIONS = (
    ("protected_children", "origin", "TEXT"),
    ("protected_children", "checkpoint", "INTEGER"),
    ("alerts", "historical", "INTEGER NOT NULL DEFAULT 0"),
)


def new_id(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:10]}"


def evidence_key(backend: str, conversation_id: str, message_id: str, cue: str, target_id: Optional[str]) -> str:
    return f"{backend}|{conversation_id}|{message_id}|{cue}|{target_id or '-'}"


class Store:
    def __init__(self, path: Path | str):
        self._lock = threading.RLock()
        self.conn = sqlite3.connect(str(path), check_same_thread=False, isolation_level=None)
        self.conn.row_factory = sqlite3.Row
        self.conn.executescript(SCHEMA)
        for table, column, decl in MIGRATIONS:
            cols = {r["name"] for r in self.conn.execute(f"PRAGMA table_info({table})").fetchall()}
            if column not in cols:
                self.conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {decl}")

    # ---------- helpers ----------

    def _q(self, sql: str, args: Iterable[Any] = ()) -> list[sqlite3.Row]:
        with self._lock:
            return self.conn.execute(sql, tuple(args)).fetchall()

    def _x(self, sql: str, args: Iterable[Any] = ()) -> None:
        with self._lock:
            self.conn.execute(sql, tuple(args))

    def tx(self):
        return _Tx(self)

    # ---------- children & reset ----------

    def ensure_child(self, child_id: str = DEFAULT_CHILD["id"], display_name: str = DEFAULT_CHILD["display_name"]) -> None:
        with self._lock:
            if not self._q("SELECT 1 FROM protected_children WHERE id=?", [child_id]):
                self._x("INSERT INTO protected_children(id, display_name) VALUES (?,?)", [child_id, display_name])
            if not self._q("SELECT 1 FROM participants WHERE child_id=? AND id=?", [child_id, child_id]):
                self._x("INSERT INTO participants(id, child_id, display_name, role) VALUES (?,?,?,?)", [child_id, child_id, display_name, "protected_child"])

    def generation(self, child_id: str) -> int:
        rows = self._q("SELECT generation FROM protected_children WHERE id=?", [child_id])
        return int(rows[0]["generation"]) if rows else -1

    def reset_child(
        self,
        child_id: str,
        display_name: str = DEFAULT_CHILD["display_name"],
        scenario_id: Optional[str] = None,
        origin: Optional[str] = None,
        checkpoint: Optional[int] = None,
    ) -> None:
        """Clear one child's synthetic case and all associated memory. Bumps the generation so in-flight runs go stale.

        origin records how the case started: 'scripted' (scenario playback), 'history' (an earlier conversation was
        preloaded up to `checkpoint` messages, then continued live) or 'fresh' (a new conversation with no history).
        """
        with self.tx():
            gen = self.generation(child_id)
            self._x("DELETE FROM protected_children WHERE id=?", [child_id])  # cascades
            self._x("DELETE FROM conversation_participants WHERE conversation_id NOT IN (SELECT id FROM conversations)")
            self._x(
                "INSERT INTO protected_children(id, display_name, generation, scenario_id, origin, checkpoint) VALUES (?,?,?,?,?,?)",
                [child_id, display_name, gen + 1, scenario_id, origin, checkpoint],
            )
            self._x("INSERT INTO participants(id, child_id, display_name, role) VALUES (?,?,?,?)", [child_id, child_id, display_name, "protected_child"])

    def scenario_id(self, child_id: str) -> Optional[str]:
        rows = self._q("SELECT scenario_id FROM protected_children WHERE id=?", [child_id])
        return rows[0]["scenario_id"] if rows else None

    def case_meta(self, child_id: str) -> dict:
        rows = self._q("SELECT generation, scenario_id, origin, checkpoint FROM protected_children WHERE id=?", [child_id])
        if not rows:
            return {"generation": -1, "scenarioId": None, "origin": None, "checkpoint": None}
        r = rows[0]
        return {"generation": int(r["generation"]), "scenarioId": r["scenario_id"], "origin": r["origin"], "checkpoint": r["checkpoint"]}

    def set_origin(self, child_id: str, origin: str, checkpoint: Optional[int]) -> None:
        """Re-label an existing case without touching its memory (scripted playback continued live)."""
        self._x("UPDATE protected_children SET origin=?, checkpoint=? WHERE id=?", [origin, checkpoint, child_id])

    # ---------- participants & conversations ----------

    def upsert_participant(self, child_id: str, p: Participant) -> Participant:
        self._x(
            "INSERT INTO participants(id, child_id, display_name, role) VALUES (?,?,?,?) "
            "ON CONFLICT(child_id, id) DO UPDATE SET display_name=excluded.display_name, role=excluded.role",
            [p.id, child_id, p.display_name, p.role],
        )
        return p

    def participants(self, child_id: str) -> list[Participant]:
        return [Participant(id=r["id"], display_name=r["display_name"], role=r["role"]) for r in self._q("SELECT * FROM participants WHERE child_id=? ORDER BY rowid", [child_id])]

    def create_conversation(self, child_id: str, conv_id: str, kind: str, title: str, participant_ids: list[str]) -> Conversation:
        ids = list(dict.fromkeys([child_id, *participant_ids]))
        with self.tx():
            self._x("INSERT INTO conversations(id, child_id, kind, title, created_at) VALUES (?,?,?,?,?)", [conv_id, child_id, kind, title, time.time()])
            for pid in ids:
                self._x("INSERT OR IGNORE INTO conversation_participants(conversation_id, participant_id) VALUES (?,?)", [conv_id, pid])
        return Conversation(id=conv_id, child_id=child_id, kind=kind, title=title, participant_ids=ids)  # type: ignore[arg-type]

    def conversations(self, child_id: str) -> list[Conversation]:
        out = []
        for r in self._q("SELECT * FROM conversations WHERE child_id=? ORDER BY created_at, rowid", [child_id]):
            pids = [x["participant_id"] for x in self._q("SELECT participant_id FROM conversation_participants WHERE conversation_id=? ORDER BY rowid", [r["id"]])]
            out.append(Conversation(id=r["id"], child_id=child_id, kind=r["kind"], title=r["title"], participant_ids=pids))
        return out

    def conversation(self, conv_id: str) -> Optional[Conversation]:
        rows = self._q("SELECT child_id FROM conversations WHERE id=?", [conv_id])
        if not rows:
            return None
        return next((c for c in self.conversations(rows[0]["child_id"]) if c.id == conv_id), None)

    # ---------- messages ----------

    def add_message(self, child_id: str, msg_id: str, conversation_id: str, sender_id: str, day: int, time_s: str, text: str) -> Message:
        with self.tx():
            existing = self._q("SELECT * FROM messages WHERE id=?", [msg_id])
            if existing:  # idempotent re-post
                return _msg(existing[0])
            seq = (self._q("SELECT COALESCE(MAX(seq), 0) AS s FROM messages WHERE child_id=?", [child_id])[0]["s"]) + 1
            self._x(
                "INSERT INTO messages(id, child_id, conversation_id, sender_id, day, time, seq, text) VALUES (?,?,?,?,?,?,?,?)",
                [msg_id, child_id, conversation_id, sender_id, day, time_s, seq, text],
            )
        return Message(id=msg_id, conversation_id=conversation_id, sender_id=sender_id, day=day, time=time_s, seq=seq, text=text)

    def messages(self, child_id: str) -> list[Message]:
        return [_msg(r) for r in self._q("SELECT * FROM messages WHERE child_id=? ORDER BY seq", [child_id])]

    def conversation_messages(self, conv_id: str, upto_seq: Optional[int] = None) -> list[Message]:
        if upto_seq is None:
            return [_msg(r) for r in self._q("SELECT * FROM messages WHERE conversation_id=? ORDER BY seq", [conv_id])]
        return [_msg(r) for r in self._q("SELECT * FROM messages WHERE conversation_id=? AND seq<=? ORDER BY seq", [conv_id, upto_seq])]

    def message(self, msg_id: str) -> Optional[Message]:
        rows = self._q("SELECT * FROM messages WHERE id=?", [msg_id])
        return _msg(rows[0]) if rows else None

    def first_seen(self, child_id: str) -> dict[str, int]:
        """First simulated day each participant appears in any of the child's conversations."""
        rows = self._q(
            "SELECT cp.participant_id AS pid, MIN(m.day) AS d FROM conversation_participants cp "
            "JOIN messages m ON m.conversation_id = cp.conversation_id WHERE m.child_id=? GROUP BY cp.participant_id",
            [child_id],
        )
        return {r["pid"]: int(r["d"]) for r in rows}

    # ---------- evidence ----------

    def evidence(self, child_id: str, backend: Optional[str] = None, conversation_id: Optional[str] = None, statuses: Optional[Iterable[str]] = None) -> list[EvidenceEvent]:
        sql = "SELECT * FROM evidence_events WHERE child_id=?"
        args: list[Any] = [child_id]
        if backend:
            sql += " AND backend=?"
            args.append(backend)
        if conversation_id:
            sql += " AND conversation_id=?"
            args.append(conversation_id)
        if statuses:
            st = list(statuses)
            sql += f" AND status IN ({','.join('?' * len(st))})"
            args += st
        return [_ev(r) for r in self._q(sql + " ORDER BY seq, cue", args)]

    def upsert_evidence(self, ev: EvidenceEvent) -> None:
        self._x(
            "INSERT INTO evidence_events(key, child_id, backend, conversation_id, message_id, sender_id, target_id, target_basis, cue, category, day, seq, p, modifier, status, agreement, sources, rationale, run_id, updated_at) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) "
            "ON CONFLICT(key) DO UPDATE SET p=excluded.p, modifier=excluded.modifier, status=excluded.status, agreement=excluded.agreement, "
            "sources=excluded.sources, rationale=excluded.rationale, run_id=excluded.run_id, target_basis=excluded.target_basis, updated_at=excluded.updated_at",
            [
                ev.key, ev.child_id, ev.backend, ev.conversation_id, ev.message_id, ev.sender_id, ev.target_id, ev.target_basis, ev.cue,
                CUE_CATEGORY[ev.cue], ev.day, ev.seq, ev.p, ev.modifier, ev.status, ev.agreement, json.dumps(ev.sources), ev.rationale, ev.run_id, time.time(),
            ],
        )

    def set_evidence_status(self, key: str, status: str, rationale: str, run_id: str) -> None:
        self._x("UPDATE evidence_events SET status=?, rationale=?, run_id=?, updated_at=? WHERE key=?", [status, rationale, run_id, time.time(), key])

    # ---------- runs ----------

    def watermark(self, conv_id: str, backend: str) -> int:
        rows = self._q("SELECT COALESCE(MAX(upto_seq), 0) AS w FROM analysis_runs WHERE conversation_id=? AND backend=? AND status='ok'", [conv_id, backend])
        return int(rows[0]["w"])

    def save_run(self, run_id: str, child_id: str, backend: str, conv_id: str, request_id: str, upto_seq: int, status: str, result: dict) -> None:
        self._x(
            "INSERT OR REPLACE INTO analysis_runs(id, child_id, backend, conversation_id, request_id, upto_seq, status, result, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
            [run_id, child_id, backend, conv_id, request_id, upto_seq, status, json.dumps(result), time.time()],
        )

    def runs(self, child_id: str, limit: int = 200) -> list[dict]:
        rows = self._q("SELECT result FROM analysis_runs WHERE child_id=? ORDER BY created_at DESC LIMIT ?", [child_id, limit])
        return [json.loads(r["result"]) for r in reversed(rows)]

    # ---------- case outputs ----------

    def add_snapshot(self, child_id: str, s: dict) -> None:
        self._x(
            "INSERT INTO risk_snapshots(child_id, backend, run_id, day, score, level, stage, category, dominant_track, trace, evidence_keys, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            [child_id, s["backend"], s.get("run_id"), s["day"], s["score"], s["level"], s["stage"], s["category"], s.get("dominant_track"), json.dumps(s["trace"]), json.dumps(s["evidence_keys"]), time.time()],
        )

    def snapshots(self, child_id: str, backend: str) -> list[dict]:
        return [
            {"day": r["day"], "score": r["score"], "level": r["level"], "stage": r["stage"], "category": r["category"], "runId": r["run_id"]}
            for r in self._q("SELECT * FROM risk_snapshots WHERE child_id=? AND backend=? ORDER BY id", [child_id, backend])
        ]

    def add_alert(self, child_id: str, a: dict) -> bool:
        """Insert an alert and raise the case's alerted level for its track. Returns False if it was already recorded."""
        with self.tx():
            if self._q("SELECT 1 FROM alerts WHERE id=?", [a["id"]]):
                return False
            alerted = self.alerted(child_id, a["backend"])
            if alerted.get(a["track_key"], 0) >= a["level"]:
                return False
            self._x(
                "INSERT INTO alerts(id, child_id, backend, track_key, level, day, time, title, body, historical, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                [a["id"], child_id, a["backend"], a["track_key"], a["level"], a["day"], a["time"], a["title"], a["body"], 1 if a.get("historical") else 0, time.time()],
            )
            alerted[a["track_key"]] = a["level"]
            self._x(
                "INSERT INTO cases(child_id, backend, alerted, updated_at) VALUES (?,?,?,?) ON CONFLICT(child_id, backend) DO UPDATE SET alerted=excluded.alerted, updated_at=excluded.updated_at",
                [child_id, a["backend"], json.dumps(alerted), time.time()],
            )
            return True

    def alerted(self, child_id: str, backend: str) -> dict[str, int]:
        rows = self._q("SELECT alerted FROM cases WHERE child_id=? AND backend=?", [child_id, backend])
        return json.loads(rows[0]["alerted"]) if rows else {}

    def alerts(self, child_id: str) -> list[dict]:
        rows = self._q("SELECT id, backend, track_key AS trackKey, level, day, time, title, body, historical FROM alerts WHERE child_id=? ORDER BY created_at", [child_id])
        return [{**dict(r), "historical": bool(r["historical"])} for r in rows]

    def add_dismissal(self, child_id: str, day: int, track_key: Optional[str]) -> None:
        self._x("INSERT INTO dismissals(child_id, day, track_key) VALUES (?,?,?)", [child_id, day, track_key])

    def dismissals(self, child_id: str) -> list[dict]:
        return [{"day": r["day"], "trackKey": r["track_key"]} for r in self._q("SELECT * FROM dismissals WHERE child_id=? ORDER BY id", [child_id])]

    def add_block(self, child_id: str, contact_id: str, day: int) -> None:
        self._x("INSERT INTO blocks(child_id, contact_id, day) VALUES (?,?,?)", [child_id, contact_id, day])

    def blocks(self, child_id: str) -> list[dict]:
        return [{"contactId": r["contact_id"], "day": r["day"]} for r in self._q("SELECT * FROM blocks WHERE child_id=? ORDER BY id", [child_id])]


class _Tx:
    def __init__(self, store: Store):
        self.s = store

    def __enter__(self):
        self.s._lock.acquire()
        self.depth = self.s.conn.in_transaction
        if not self.depth:
            self.s.conn.execute("BEGIN")
        return self

    def __exit__(self, exc_type, exc, tb):
        try:
            if not self.depth:
                self.s.conn.execute("ROLLBACK" if exc_type else "COMMIT")
        finally:
            self.s._lock.release()


def _msg(r: sqlite3.Row) -> Message:
    return Message(id=r["id"], conversation_id=r["conversation_id"], sender_id=r["sender_id"], day=r["day"], time=r["time"], seq=r["seq"], text=r["text"])


def _ev(r: sqlite3.Row) -> EvidenceEvent:
    return EvidenceEvent(
        key=r["key"], child_id=r["child_id"], backend=r["backend"], conversation_id=r["conversation_id"], message_id=r["message_id"],
        sender_id=r["sender_id"], target_id=r["target_id"], target_basis=r["target_basis"], cue=r["cue"], category=r["category"],
        day=r["day"], seq=r["seq"], p=r["p"], modifier=r["modifier"], status=r["status"], agreement=r["agreement"],
        sources=json.loads(r["sources"]), rationale=r["rationale"], run_id=r["run_id"],
    )
