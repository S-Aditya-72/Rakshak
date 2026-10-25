"""History preload (Mode B), continuing playback live, case origin and historical alerts.

Deterministic tests with fake models: they check bookkeeping and isolation, not model accuracy.
"""

from __future__ import annotations

import json
import sqlite3

from conftest import FakeContextual, alias_of, analyze, empty, finding, post_msg
from rakshak_server.db import Store

M = "p-meera"


def history(c, sid, cp=None, force=False):
    q = []
    if cp:
        q.append(f"checkpoint={cp}")
    if force:
        q.append("force=true")
    r = c.post(f"/api/scenarios/{sid}/history" + ("?" + "&".join(q) if q else ""))
    return r


def test_history_loads_exact_prefix_with_stable_ids_and_no_future_messages(make_client):
    c = make_client()
    r = history(c, "s2-bullying", "asked-to-stop")
    r.raise_for_status()
    out = r.json()
    st = c.get("/api/state").json()
    ids = [m["id"] for m in st["messages"]]
    assert ids == [f"s2-bullying-m{i:02d}" for i in range(1, 9)]
    assert ids == out["historyMessageIds"] and len(out["messages"]) == 8
    # Ordering, sender identity and simulated days are preserved; nothing after the checkpoint exists.
    assert [m["seq"] for m in st["messages"]] == sorted(m["seq"] for m in st["messages"])
    assert st["messages"][-1]["text"] == "please stop" and st["messages"][-1]["senderId"] == M
    assert {m["day"] for m in st["messages"]} == {1, 2, 3}
    assert not any("loser" in m["text"] for m in st["messages"])
    assert st["case"]["origin"] == "history" and st["case"]["checkpoint"] == 8 and st["case"]["scenarioId"] == "s2-bullying"
    # Messages only: nothing has been analysed yet, so there is no evidence and no run.
    assert st["evidence"] == [] and st["runs"] == []


def test_history_reload_is_idempotent_and_keeps_analysis(make_client):
    qwen = FakeContextual("qwen", lambda ctx: {**empty("harmful"), "findings": [finding(alias_of(ctx, "embarrassing"), "humiliation")]})
    c = make_client(qwen=qwen)
    history(c, "s2-bullying", "asked-to-stop").raise_for_status()
    analyze(c, "s2-c-dev", "s2-bullying-m08").raise_for_status()
    c.post(f"/api/cases/{M}/alerts", json={"id": "a1", "backend": "local_hybrid", "trackKey": "bullying", "level": 1, "day": 1, "time": "t", "title": "x", "body": "y", "historical": True}).raise_for_status()
    before = c.get("/api/state").json()
    for _ in range(3):  # repeated clicks / retries
        r = history(c, "s2-bullying", "asked-to-stop").json()
        assert r["reused"] is True
    after = c.get("/api/state").json()
    assert [m["id"] for m in after["messages"]] == [m["id"] for m in before["messages"]]
    assert len(after["evidence"]) == len(before["evidence"]) == 1
    assert len(after["alerts"]) == 1 and after["alerts"][0]["historical"] is True
    assert after["case"]["generation"] == before["case"]["generation"]


def test_history_reuse_survives_live_messages_but_force_and_other_checkpoint_reset(make_client):
    c = make_client()
    history(c, "s2-bullying", "asked-to-stop").raise_for_status()
    post_msg(c, "s2-c-dev", "p-dev", "fine, sorry", day=3, mid="live-1")
    assert history(c, "s2-bullying", "asked-to-stop").json()["reused"] is True
    assert "live-1" in [m["id"] for m in c.get("/api/state").json()["messages"]]
    gen = c.get("/api/state").json()["case"]["generation"]
    assert history(c, "s2-bullying", "one-rude").json()["reused"] is False
    st = c.get("/api/state").json()
    assert len(st["messages"]) == 3 and st["case"]["generation"] == gen + 1 and st["case"]["checkpoint"] == 3
    assert history(c, "s2-bullying", "one-rude", force=True).json()["reused"] is False


def test_history_unknown_scenario_or_checkpoint(make_client):
    c = make_client()
    assert history(c, "nope").status_code == 404
    assert history(c, "s2-bullying", "nope").status_code == 404


def test_history_analysis_uses_earlier_messages_as_context(make_client):
    qwen = FakeContextual("qwen", lambda ctx: empty("concerning"))
    c = make_client(qwen=qwen)
    history(c, "s3-grooming", "secrecy").raise_for_status()
    analyze(c, "s3-c-kabir", "s3-grooming-m09").raise_for_status()
    mid = post_msg(c, "s3-c-kabir", "p-kabir", "it's just better if it stays between us ok?", day=2)
    analyze(c, "s3-c-kabir", mid).raise_for_status()
    sent = qwen.calls[-1].payload
    texts = [m["text"] for m in sent["messages"]]
    # The live message is the focus; the preloaded history is in the context the model actually received.
    assert texts[-1].startswith("it's just better") and any("don't tell your parents" in t for t in texts)
    assert sent["focus_message_ids"] == [sent["messages"][-1]["id"]]
    # Presenter suggestions, checkpoint labels and future script lines never reach the model.
    blob = json.dumps(sent)
    assert "send me a photo" not in blob and "Continue as" not in blob and "secrecy has been asked" not in blob


def test_child_message_is_analysed_and_attributed_to_the_child(make_client):
    qwen = FakeContextual("qwen", lambda ctx: {**empty("concerning"), "findings": [finding(alias_of(ctx, "stop calling"), "insult_harassment", modifier="counterspeech", target="p-dev")]})
    c = make_client(qwen=qwen)
    history(c, "s2-bullying", "one-rude").raise_for_status()
    mid = post_msg(c, "s2-c-dev", M, "stop calling me embarrassing", day=1)
    out = analyze(c, "s2-c-dev", mid).json()
    assert mid in out["result"]["focusMessageIds"]
    ev = [e for e in out["evidence"] if e["messageId"] == mid]
    assert ev and all(e["senderId"] == M and e["modifier"] == "counterspeech" for e in ev)


def test_cloud_history_requires_owner_action(make_client):
    c = make_client()
    history(c, "s2-bullying", "asked-to-stop").raise_for_status()
    r = analyze(c, "s2-c-dev", "s2-bullying-m08", backend="chatgpt_cloud", trigger="auto")
    assert r.status_code == 403 and r.json()["error"]["code"] == "owner_action_required"
    assert c.get("/api/state?backend=chatgpt_cloud").json()["runs"] == []


def test_continue_scripted_case_live_keeps_memory(make_client):
    c = make_client(qwen=FakeContextual("qwen", lambda ctx: {**empty("harmful"), "findings": [finding(alias_of(ctx, "embarrassing"), "humiliation")]}))
    c.post("/api/scenarios/s2-bullying/load").raise_for_status()
    assert c.get("/api/state").json()["case"]["origin"] == "scripted"
    assert c.post("/api/case/continue").status_code == 400  # nothing played yet
    post_msg(c, "s2-c-dev", "p-dev", "saw your speech in class lol. embarrassing", mid="s2-bullying-m01")
    analyze(c, "s2-c-dev", "s2-bullying-m01").raise_for_status()
    gen = c.get("/api/state").json()["case"]["generation"]
    meta = c.post("/api/case/continue").json()
    assert meta["origin"] == "history" and meta["checkpoint"] == 1 and meta["generation"] == gen
    st = c.get("/api/state").json()
    assert len(st["messages"]) == 1 and len(st["evidence"]) == 1


def test_fresh_case_origin_and_continue_rejected(make_client):
    c = make_client()
    c.post("/api/reset?mode=live").raise_for_status()
    st = c.get("/api/state").json()
    assert st["case"]["origin"] == "fresh" and st["messages"] == []
    assert c.post("/api/case/continue").status_code == 409


def test_reset_after_history_discards_inflight_run(make_client):
    import threading
    import time

    qwen = FakeContextual("qwen", lambda ctx: {**empty("harmful"), "findings": [finding(alias_of(ctx, "embarrassing"), "humiliation")]}, delay=0.6)
    c = make_client(qwen=qwen)
    history(c, "s2-bullying", "asked-to-stop").raise_for_status()
    box = {}
    t = threading.Thread(target=lambda: box.setdefault("r", analyze(c, "s2-c-dev", "s2-bullying-m08").json()))
    t.start()
    time.sleep(0.2)
    history(c, "s5-group", "pile-on").raise_for_status()  # scenario switch mid-run
    t.join()
    assert box["r"]["result"]["stale"] is True
    assert c.get("/api/state").json()["evidence"] == []


def test_case_study_history_and_listing(make_client):
    c = make_client()
    listed = {s["id"]: s for s in c.get("/api/scenarios").json()}
    cs = listed["cs-rapid-sextortion"]
    assert cs["kind"] == "case_study" and cs["caseStudy"] == "jordan-demay" and "expect" not in cs
    assert [s["id"] for s in listed.values()][:5] == ["s1-banter", "s2-bullying", "s3-grooming", "s4-crosschat", "s5-group"]
    # The UI shows the real case identity; the case is stored (and analysed) under neutral names.
    assert cs["child"]["name"] == "Jordan DeMay" and cs["participants"][0]["name"] == "dani.robertts"
    history(c, "cs-rapid-sextortion", "first-demand").raise_for_status()
    st = c.get("/api/state").json()
    assert st["child"]["displayName"] == "Child" and len(st["messages"]) == 7
    assert {p["displayName"] for p in st["participants"]} == {"Child", "Account 1"}
    assert [cv["title"] for cv in st["conversations"]] == ["Account 1"]
    assert not any("pay the rest" in m["text"] for m in st["messages"])


def test_case_study_model_input_has_no_real_names(make_client):
    qwen = FakeContextual("qwen")
    c = make_client(qwen=qwen)
    for sid, cp in (("cs-sustained-coercion", "after-block"), ("cs-rapid-sextortion", "first-demand")):
        history(c, sid, cp).raise_for_status()
        st = c.get("/api/state").json()
        analyze(c, st["conversations"][0]["id"]).raise_for_status()
    sent = json.dumps([ctx.payload for ctx in qwen.calls]).lower()
    assert len(qwen.calls) == 2
    for real in ("amanda", "todd", "coban", "jordan", "demay", "robertts", "ogoshi", "reconstructed alias"):
        assert real not in sent


def test_cross_chat_history_preserves_identities(make_client):
    c = make_client()
    history(c, "s4-crosschat", "after-group").raise_for_status()
    st = c.get("/api/state").json()
    convs = {cv["id"]: cv["participantIds"] for cv in st["conversations"]}
    assert set(convs) == {"s4-c-dev", "s4-c-riya", "s4-c-class", "s4-c-arjun"}
    assert {m["conversationId"] for m in st["messages"]} == {"s4-c-dev", "s4-c-riya", "s4-c-class"}
    for m in st["messages"]:
        assert m["senderId"] in convs[m["conversationId"]]
    assert len({p["id"] for p in st["participants"]}) == len(st["participants"])


def test_migration_adds_columns_to_an_old_database(tmp_path):
    db = tmp_path / "old.sqlite3"
    con = sqlite3.connect(db)
    con.executescript(
        "CREATE TABLE protected_children (id TEXT PRIMARY KEY, display_name TEXT NOT NULL, generation INTEGER NOT NULL DEFAULT 0, scenario_id TEXT);"
        "CREATE TABLE alerts (id TEXT PRIMARY KEY, child_id TEXT NOT NULL, backend TEXT NOT NULL, track_key TEXT NOT NULL, level INTEGER NOT NULL, day INTEGER NOT NULL, time TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, created_at REAL NOT NULL);"
        "INSERT INTO protected_children(id, display_name, generation) VALUES ('p-meera', 'Meera', 4);"
    )
    con.commit()
    con.close()
    s = Store(db)
    assert s.case_meta("p-meera") == {"generation": 4, "scenarioId": None, "origin": None, "checkpoint": None}
    s.add_alert("p-meera", {"id": "a", "backend": "local_hybrid", "track_key": "t", "level": 2, "day": 1, "time": "t", "title": "x", "body": "y", "historical": True})
    assert s.alerts("p-meera")[0]["historical"] is True
    Store(db)  # re-opening an already migrated database is a no-op


def test_history_upto_reproduces_an_arbitrary_continuation_point(make_client):
    c = make_client()
    r = c.post("/api/scenarios/s3-grooming/history?upto=11&force=true")
    r.raise_for_status()
    st = c.get("/api/state").json()
    assert len(st["messages"]) == 11 and st["case"]["checkpoint"] == 11
    assert c.post("/api/scenarios/s3-grooming/history?upto=99").status_code == 400
