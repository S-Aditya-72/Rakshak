"""Rules fallback: live chat still produces labelled evidence when Ollama is not running (laptops without a GPU)."""

from __future__ import annotations

from conftest import FakeContextual, analyze, post_msg

from rakshak_server.analyzers import AnalyzerError

NO_OLLAMA = AnalyzerError("ollama_unavailable", "Ollama is not reachable at http://127.0.0.1:11434")


def live(c):
    c.post("/api/reset?mode=live").raise_for_status()
    return "c-live-kabir"


def test_rules_stand_in_for_missing_qwen(make_client):
    c = make_client(qwen=FakeContextual("qwen", error=NO_OLLAMA))
    conv = live(c)
    mid = post_msg(c, conv, "p-kabir", "send me a pic, and don't tell your parents ok?")
    out = analyze(c, conv, mid).json()
    res = out["result"]
    assert res["models"]["contextual"] == "rules-fallback" and res["status"] == "ok"
    assert any("rules fallback" in w for w in res["warnings"])
    cues = {e["cue"]: e for e in out["evidence"]}
    assert {"image_request", "secrecy"} <= set(cues)
    assert all(e["sources"][0] == "rules" for e in out["evidence"])
    assert cues["image_request"]["targetId"] == "p-meera"


def test_rules_ignore_harmless_and_child_messages(make_client):
    c = make_client(qwen=FakeContextual("qwen", error=NO_OLLAMA))
    conv = live(c)
    post_msg(c, conv, "p-meera", "you're so stupid lol")  # the child's own words are never scored against her
    mid = post_msg(c, conv, "p-kabir", "did you finish the maths homework?")
    out = analyze(c, conv, mid).json()
    assert out["evidence"] == [] and out["result"]["assessment"] == "harmless"


def test_fallback_can_be_switched_off(make_client):
    c = make_client(qwen=FakeContextual("qwen", error=NO_OLLAMA), rules_fallback=False)
    conv = live(c)
    mid = post_msg(c, conv, "p-kabir", "send me a pic")
    res = analyze(c, conv, mid).json()["result"]
    assert res["error"]["code"] == "ollama_unavailable" and res["models"]["contextual"] != "rules-fallback"


def test_other_model_errors_are_not_masked(make_client):
    c = make_client(qwen=FakeContextual("qwen", error=AnalyzerError("timeout", "Qwen did not answer")))
    conv = live(c)
    mid = post_msg(c, conv, "p-kabir", "send me a pic")
    res = analyze(c, conv, mid).json()["result"]
    assert res["error"]["code"] == "timeout"


def test_rules_findings_pass_the_confirmation_gate(make_client):
    # Without RoBERTa or a second reading, only high-confidence findings (requests naming the child) are confirmed.
    # The rules fallback must still raise alerts on its own: its matches are confirmed ("active"), not left pending.
    c = make_client(qwen=FakeContextual("qwen", error=NO_OLLAMA))
    conv = live(c)
    mid = post_msg(c, conv, "p-kabir", "you're so mature for your age. where do you live? don't tell your parents")
    out = analyze(c, conv, mid).json()
    status = {e["cue"]: e["status"] for e in out["evidence"]}
    assert status == {"flattery_age": "active", "personal_info_request": "active", "secrecy": "active"}
    assert out["result"]["conversationReading"].startswith("Rules fallback")
    assert not any("requested_subject" in w or "conversation_reading" in w for w in out["result"]["warnings"])


def test_rules_banter_stays_unconfirmed(make_client):
    # A laughing insult is only possible banter: fusion rejects one-sided banter, and the medium-confidence finding
    # then waits for confirmation instead of scoring.
    c = make_client(qwen=FakeContextual("qwen", error=NO_OLLAMA))
    conv = live(c)
    mid = post_msg(c, conv, "p-kabir", "bro you're so dumb lol")
    out = analyze(c, conv, mid).json()
    assert [(e["cue"], e["status"]) for e in out["evidence"]] == [("insult_harassment", "needs_review")]
