"""Scenario loading. A scenario file defines people, conversations and synthetic messages.

The `expect` block is for the evaluation harness only and is never sent to the UI or to any model:
scenario verdicts are produced by the same live pipeline as unscripted chat.
"""

from __future__ import annotations

import json
from pathlib import Path

from .contract import Participant
from .db import Store


def _files(d: Path) -> list[Path]:
    return sorted(p for p in d.glob("*.json") if p.is_file())


def read_scenario(d: Path, scenario_id: str) -> dict:
    for p in _files(d) + _files(d / "eval"):
        data = json.loads(p.read_text(encoding="utf-8"))
        if data.get("id") == scenario_id:
            return data
    raise KeyError(scenario_id)


def public_view(sc: dict) -> dict:
    """Scenario as the UI sees it: no expectations. Message ids are deterministic per scenario."""
    msgs = [
        {"id": f"{sc['id']}-m{i + 1:02d}", "conversationId": m["conv"], "senderId": m["from"], "day": m["day"], "time": m["time"], "text": m["text"], "caption": m.get("caption")}
        for i, m in enumerate(sc["messages"])
    ]
    return {
        "id": sc["id"],
        "number": sc.get("number"),
        "title": sc["title"],
        "subtitle": sc.get("subtitle", ""),
        "tests": sc.get("tests", ""),
        "child": sc["child"],
        "participants": sc["participants"],
        "conversations": sc["conversations"],
        "messages": msgs,
    }


def list_scenarios(d: Path) -> list[dict]:
    out = []
    for p in _files(d):
        sc = json.loads(p.read_text(encoding="utf-8"))
        v = public_view(sc)
        out.append(v)
    out.sort(key=lambda v: (v.get("number") or 99, v["id"]))
    return out


def load_scenario(store: Store, d: Path, scenario_id: str) -> dict:
    """Reset the child's case and create the scenario's participants and conversations (no messages yet)."""
    sc = read_scenario(d, scenario_id)
    child = sc["child"]
    store.reset_child(child["id"], child["name"], scenario_id=scenario_id)
    for p in sc["participants"]:
        store.upsert_participant(child["id"], Participant(id=p["id"], display_name=p["name"], role=p.get("role", "peer")))
    for c in sc["conversations"]:
        store.create_conversation(child["id"], c["id"], c["kind"], c["title"], c["participants"])
    return public_view(sc)
