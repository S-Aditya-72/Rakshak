"""Confirmation gate: nothing uncertain is treated as harmful, and nothing is acted on until it is confirmed.
Only "active" evidence is confirmed; "needs_review" is pending (recorded, never scored or alerted on)."""

from __future__ import annotations

from conftest import FakeContextual, FakeRoberta, alias_of, analyze, empty, finding, post_msg

M = "p-meera"
K = "p-kabir"


def load(c, sid):
    c.post(f"/api/scenarios/{sid}/load").raise_for_status()


def by_cue(out):
    return {(e["messageId"], e["cue"]): e for e in out["evidence"]}


def test_uncertain_assessment_is_never_confirmed_even_at_high_confidence(make_client):
    c = make_client(qwen=FakeContextual("qwen", lambda ctx: {**empty("uncertain"), "findings": [finding(alias_of(ctx, "parents"), "secrecy", confidence="high")]}), roberta=FakeRoberta({}))
    load(c, "s3-grooming")
    mid = post_msg(c, "s3-c-kabir", K, "don't tell your parents about our chats")
    out = analyze(c, "s3-c-kabir", mid).json()
    assert out["evidence"][0]["status"] == "needs_review"
    assert "pending confirmation: whole-chat assessment is uncertain" in out["result"]["fusion"][0]["note"]


def test_medium_finding_waits_then_confirms_when_later_messages_still_support_it(make_client):
    turn = {"n": 0}

    def resp(ctx):
        turn["n"] += 1
        return {**empty("concerning"), "findings": [finding(alias_of(ctx, "parents"), "secrecy", confidence="medium")]}

    c = make_client(qwen=FakeContextual("qwen", resp), roberta=FakeRoberta({}))
    load(c, "s3-grooming")
    m1 = post_msg(c, "s3-c-kabir", K, "don't tell your parents about our chats")
    first = analyze(c, "s3-c-kabir", m1).json()
    assert first["evidence"][0]["status"] == "needs_review"
    assert "waiting for later messages" in first["result"]["fusion"][0]["note"]
    m2 = post_msg(c, "s3-c-kabir", K, "they wouldn't understand us")
    second = analyze(c, "s3-c-kabir", m2).json()
    ev = by_cue(second)[(m1, "secrecy")]
    assert ev["status"] == "active"
    assert "confirmed: still supported after reading later messages" in second["result"]["fusion"][0]["note"]


def test_high_confidence_concerning_finding_is_confirmed_immediately(make_client):
    c = make_client(qwen=FakeContextual("qwen", lambda ctx: {**empty("harmful"), "findings": [finding(alias_of(ctx, "picture"), "image_request", confidence="high", subject="child")]}), roberta=FakeRoberta({}))
    load(c, "s3-grooming")
    mid = post_msg(c, "s3-c-kabir", K, "send me a picture of you")
    assert analyze(c, "s3-c-kabir", mid).json()["evidence"][0]["status"] == "active"


def test_request_with_unclear_subject_stays_pending(make_client):
    c = make_client(qwen=FakeContextual("qwen", lambda ctx: {**empty("concerning"), "findings": [finding(alias_of(ctx, "pics"), "image_request", confidence="high", subject="unclear")]}), roberta=FakeRoberta({}))
    load(c, "e6-homework")
    mid = post_msg(c, "e6-c", K, "can u send pics")
    out = analyze(c, "e6-c", mid).json()
    assert out["evidence"][0]["status"] == "needs_review"
    assert "not established that the child is what is being requested" in out["result"]["fusion"][0]["note"]


def test_request_resolved_to_everyday_thing_is_dropped(make_client):
    c = make_client(qwen=FakeContextual("qwen", lambda ctx: {**empty("concerning"), "findings": [finding(alias_of(ctx, "pics"), "image_request", confidence="high", subject="everyday_thing")]}), roberta=FakeRoberta({}))
    load(c, "e6-homework")
    mid = post_msg(c, "e6-c", K, "can u send pics")
    out = analyze(c, "e6-c", mid).json()
    assert out["evidence"] == [] and any("everyday thing" in w for w in out["result"]["warnings"])


def test_missing_subject_on_request_is_treated_as_unclear(make_client):
    def resp(ctx):
        f = finding(alias_of(ctx, "pics"), "image_request", confidence="high")
        del f["requested_subject"]
        return {**empty("harmful"), "findings": [f]}

    c = make_client(qwen=FakeContextual("qwen", resp), roberta=FakeRoberta({}))
    load(c, "e6-homework")
    mid = post_msg(c, "e6-c", K, "can u send pics")
    assert analyze(c, "e6-c", mid).json()["evidence"][0]["status"] == "needs_review"


def test_live_failure_replay_never_confirms_and_clears_on_harmless_reading(make_client):
    """The exact chat from the demo: hey / homework? / yes / can u send pics / wait i will / not just that / yesterday's homework too."""
    script = {
        "not just that": lambda ctx: {**empty("concerning"), "findings": [
            finding(alias_of(ctx, "pics"), "image_request", confidence="medium", subject="unclear"),
            finding(alias_of(ctx, "not just"), "image_request", confidence="medium", subject="unclear"),
        ]},
        "yesterday": lambda ctx: {**empty("harmless"), "conversation_reading": "Photos of homework, including yesterday's."},
    }

    def resp(ctx):
        last = ctx.messages[-1].text
        for k, f in script.items():
            if k in last:
                return f(ctx)
        return empty("harmless")

    c = make_client(qwen=FakeContextual("qwen", resp), roberta=FakeRoberta({}))
    load(c, "e6-homework")
    for sender, text in [(K, "hey"), (K, "did u complete todays homework"), (M, "yes"), (K, "can u send pics"), (M, "wait i will")]:
        mid = post_msg(c, "e6-c", sender, text)
        assert analyze(c, "e6-c", mid).json()["evidence"] == []
    mid = post_msg(c, "e6-c", K, "not just that")
    six = analyze(c, "e6-c", mid).json()["evidence"]
    assert six and all(e["status"] == "needs_review" for e in six)  # recorded, but nothing confirmed => no alert
    mid = post_msg(c, "e6-c", K, "yesterday's homework too")
    seven = analyze(c, "e6-c", mid).json()["evidence"]
    assert all(e["status"] == "superseded" for e in seven)
    assert all("whole-chat reading is now harmless" in e["rationale"] for e in seven)


def test_harmless_reading_retracts_a_confirmed_finding_it_re_flags(make_client):
    turn = {"n": 0}

    def resp(ctx):
        turn["n"] += 1
        if turn["n"] == 1:
            return {**empty("harmful"), "findings": [finding(alias_of(ctx, "parents"), "secrecy")]}
        return {**empty("harmless"), "findings": [finding(alias_of(ctx, "parents"), "secrecy", confidence="low")]}

    c = make_client(qwen=FakeContextual("qwen", resp), roberta=FakeRoberta({}))
    load(c, "s3-grooming")
    m1 = post_msg(c, "s3-c-kabir", K, "don't tell your parents about our chats, it's a surprise party for them")
    assert analyze(c, "s3-c-kabir", m1).json()["evidence"][0]["status"] == "active"
    m2 = post_msg(c, "s3-c-kabir", K, "your mum's birthday is saturday!")
    ev = by_cue(analyze(c, "s3-c-kabir", m2).json())[(m1, "secrecy")]
    assert ev["status"] == "superseded"


def test_model_gets_previous_reading_and_pending_status(make_client):
    turn = {"n": 0}

    def resp(ctx):
        turn["n"] += 1
        if turn["n"] == 1:
            return {**empty("concerning"), "conversation_reading": "first reading", "findings": [finding(alias_of(ctx, "parents"), "secrecy", confidence="medium")]}
        return {**empty("concerning"), "conversation_reading": "second reading"}

    qwen = FakeContextual("qwen", resp)
    c = make_client(qwen=qwen, roberta=FakeRoberta({}))
    load(c, "s3-grooming")
    analyze(c, "s3-c-kabir", post_msg(c, "s3-c-kabir", K, "don't tell your parents about our chats"))
    analyze(c, "s3-c-kabir", post_msg(c, "s3-c-kabir", K, "ok"))
    first, second = qwen.calls[0].payload, qwen.calls[1].payload
    assert first["previous_reading"] is None
    assert second["previous_reading"] == "first reading"
    assert second["prior_findings"][0]["status"] == "pending"


def test_verifier_is_told_what_the_analyser_thinks_is_requested(make_client):
    qwen = FakeContextual("qwen", lambda ctx: {**empty("concerning"), "findings": [finding(alias_of(ctx, "picture"), "image_request", confidence="high", subject="child")]})
    c = make_client(qwen=qwen, roberta=FakeRoberta({}))
    load(c, "s3-grooming")
    analyze(c, "s3-c-kabir", post_msg(c, "s3-c-kabir", K, "send me a picture of you"))
    assert qwen.verified[0]["analyser_requested_subject"] == "child"


def test_alert_withdrawal_is_persisted_and_rearms_the_track(make_client):
    c = make_client()
    load(c, "s3-grooming")
    body = {"id": "a1", "backend": "local_hybrid", "trackKey": "grooming:p-kabir", "level": 2, "day": 1, "time": "t", "title": "x", "body": "y"}
    assert c.post(f"/api/cases/{M}/alerts", json=body).json()["created"] is True
    r = c.post(f"/api/cases/{M}/alerts/a1/withdraw", json={"backend": "local_hybrid", "reason": "retracted"}).json()
    assert r["withdrawn"] is True
    assert c.post(f"/api/cases/{M}/alerts/a1/withdraw", json={"backend": "local_hybrid", "reason": "again"}).json()["withdrawn"] is False
    alerts = c.get(f"/api/state?childId={M}&backend=local_hybrid").json()["alerts"]
    assert alerts[0]["withdrawn"] is True and alerts[0]["withdrawnReason"] == "retracted"
    # A new alert for the same track at the same level is accepted again (the track was re-armed).
    body2 = {**body, "id": "a2"}
    assert c.post(f"/api/cases/{M}/alerts", json=body2).json()["created"] is True


def test_new_eval_fixtures_load(make_client):
    c = make_client()
    for sid in ("e6-homework", "e7-unfinished", "e8-unfinished-concerning"):
        c.post(f"/api/scenarios/{sid}/load").raise_for_status()
