"""Scenario loading. A scenario file defines people, conversations and synthetic messages.

The `expect` block is for the evaluation harness only and is never sent to the UI or to any model:
scenario verdicts are produced by the same live pipeline as unscripted chat.

`checkpoints`, `presenter` notes and captions are UI-only. Models only ever see messages that were saved to the
case (playback saves them one by one; a history preload saves the prefix up to a checkpoint), so future script
lines, presenter suggestions and expected outcomes never enter model input.

Fictional case-study recreations live in `case-studies/`. They are demonstrations, not evaluation fixtures.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Optional

from .contract import Participant
from .db import Store

CASE_STUDY_DIR = "case-studies"


def _files(d: Path) -> list[Path]:
    return sorted(p for p in d.glob("*.json") if p.is_file()) if d.is_dir() else []


def read_scenario(d: Path, scenario_id: str) -> dict:
    for p in _files(d) + _files(d / "eval") + _files(d / CASE_STUDY_DIR):
        data = json.loads(p.read_text(encoding="utf-8"))
        if data.get("id") == scenario_id:
            return data
    raise KeyError(scenario_id)


def message_id(scenario_id: str, index: int) -> str:
    """Deterministic message id for the index-th scripted message (0-based). Playback and history use the same ids."""
    return f"{scenario_id}-m{index + 1:02d}"


def public_view(sc: dict) -> dict:
    """Scenario as the UI sees it: no expectations. Message ids are deterministic per scenario."""
    msgs = [
        {"id": message_id(sc["id"], i), "conversationId": m["conv"], "senderId": m["from"], "day": m["day"], "time": m["time"], "text": m["text"], "caption": m.get("caption")}
        for i, m in enumerate(sc["messages"])
    ]
    return {
        "id": sc["id"],
        "number": sc.get("number"),
        "kind": sc.get("kind", "core"),
        "caseStudy": sc.get("caseStudy"),
        "title": sc["title"],
        "subtitle": sc.get("subtitle", ""),
        "tests": sc.get("tests", ""),
        "intro": sc.get("intro", ""),
        "child": sc["child"],
        "participants": sc["participants"],
        "conversations": sc["conversations"],
        "messages": msgs,
        "checkpoints": sc.get("checkpoints", []),
        "presenter": sc.get("presenter", []),
    }


def list_scenarios(d: Path) -> list[dict]:
    out = [public_view(json.loads(p.read_text(encoding="utf-8"))) for p in _files(d) + _files(d / CASE_STUDY_DIR)]
    out.sort(key=lambda v: (v["kind"] != "core", v.get("number") or 99, v["id"]))
    return out


def _create_cast(store: Store, sc: dict) -> None:
    child = sc["child"]
    for p in sc["participants"]:
        store.upsert_participant(child["id"], Participant(id=p["id"], display_name=p["name"], role=p.get("role", "peer")))
    for c in sc["conversations"]:
        store.create_conversation(child["id"], c["id"], c["kind"], c["title"], c["participants"])


def load_scenario(store: Store, d: Path, scenario_id: str) -> dict:
    """Reset the child's case and create the scenario's participants and conversations (no messages yet)."""
    sc = read_scenario(d, scenario_id)
    child = sc["child"]
    with store.tx():
        store.reset_child(child["id"], child["name"], scenario_id=scenario_id, origin="scripted")
        _create_cast(store, sc)
    return public_view(sc)


def checkpoint_of(sc: dict, checkpoint_id: Optional[str]) -> dict:
    cps = sc.get("checkpoints", [])
    if not cps:
        raise KeyError("no checkpoints")
    if checkpoint_id is None:
        return cps[0]
    cp = next((c for c in cps if c["id"] == checkpoint_id), None)
    if cp is None:
        raise KeyError(checkpoint_id)
    return cp


def load_history(store: Store, d: Path, scenario_id: str, checkpoint_id: Optional[str], force: bool = False, upto: Optional[int] = None) -> dict:
    """Preload an earlier conversation: the scenario's cast plus its messages up to a checkpoint, nothing after it.

    Idempotent: if the case already holds exactly this history (same scenario, checkpoint and message ids, possibly
    followed by live messages), it is returned untouched with reused=true, so retries never duplicate messages,
    evidence, risk or alerts. force=true always starts again from a clean case. The insert is one transaction: a
    failure leaves the previous case's reset rolled back rather than half a history.
    """
    sc = read_scenario(d, scenario_id)
    # `upto` reproduces an arbitrary continuation point (playback continued live from message n), e.g. on reset.
    cp = {"id": f"upto-{upto}", "after": upto, "label": f"After message {upto}", "intro": "", "suggestions": []} if upto is not None else checkpoint_of(sc, checkpoint_id)
    n = int(cp["after"])
    if not 0 < n <= len(sc["messages"]):
        raise ValueError(f"checkpoint {cp['id']} is outside the script")
    child = sc["child"]
    prefix = [(message_id(scenario_id, i), m) for i, m in enumerate(sc["messages"][:n])]
    meta = store.case_meta(child["id"])
    saved = [m.id for m in store.messages(child["id"])]
    expected = [mid for mid, _ in prefix]
    reused = not force and meta["scenarioId"] == scenario_id and meta["origin"] == "history" and meta["checkpoint"] == n and saved[:n] == expected
    if not reused:
        with store.tx():
            store.reset_child(child["id"], child["name"], scenario_id=scenario_id, origin="history", checkpoint=n)
            _create_cast(store, sc)
            for mid, m in prefix:
                store.add_message(child["id"], mid, m["conv"], m["from"], m["day"], m["time"], m["text"].strip())
    view = public_view(sc)
    return {**view, "messages": view["messages"][:n], "checkpoint": cp, "historyMessageIds": expected, "reused": reused}
