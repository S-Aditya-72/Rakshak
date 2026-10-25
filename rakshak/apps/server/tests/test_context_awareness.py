"""Context-awareness guarantees: the whole chat is read, the reading comes before any verdict, the verifier sees the
whole chat, and a finding the model's own whole-chat reading contradicts can never raise an alert on its own."""

from __future__ import annotations

from conftest import FakeContextual, FakeRoberta, alias_of, analyze, empty, finding, post_msg
from rakshak_server.config import Settings
from rakshak_server.context import build_context
from rakshak_server.contract import Conversation, Message, Participant
from rakshak_server.prompting import PROMPT_VERSION, VERIFY_VERSION, output_schema
from rakshak_server.validation import validate

M = "p-meera"
K = "p-kabir"


def load(c, sid):
    r = c.post(f"/api/scenarios/{sid}/load")
    r.raise_for_status()


def homework_chat(c):
    load(c, "e6-homework")
    post_msg(c, "e6-c", K, "hey")
    post_msg(c, "e6-c", K, "did you write todays homework")
    post_msg(c, "e6-c", M, "yes")
    return post_msg(c, "e6-c", K, "can u send pics")


def test_prompt_versions_are_context_first():
    assert PROMPT_VERSION == "analysis_system.v2" and VERIFY_VERSION == "verify_findings.v2"


def test_schema_writes_whole_chat_reading_before_any_verdict():
    s = output_schema(["m01"], [M])
    assert list(s["properties"])[0] == "conversation_reading"
    assert "conversation_reading" in s["required"]
    item = s["properties"]["findings"]["items"]
    order = list(item["properties"])
    assert order.index("context_basis") < order.index("cue") and "context_basis" in item["required"]


def test_default_settings_send_the_entire_chat():
    s = Settings()
    conv = Conversation(id="c1", child_id=M, kind="private", title="Dev", participant_ids=[M, "p-dev"])
    parts = {M: Participant(id=M, display_name="Meera", role="protected_child"), "p-dev": Participant(id="p-dev", display_name="Dev", role="peer")}
    msgs = [Message(id=f"x{i}", conversation_id="c1", sender_id="p-dev" if i % 2 else M, day=1 + i // 50, time="t", seq=i, text="a normal chat line about school and plans " * 2) for i in range(1, 301)]
    ctx = build_context(parts[M], conv, parts, msgs, ["x300"], [], [], {}, {}, s.context_token_budget, s.related_evidence_limit)
    assert not ctx.truncated and len(ctx.messages) == 300
    assert s.qwen_num_ctx >= s.context_token_budget + s.qwen_num_predict + 2200


def test_reading_and_context_basis_reach_the_result(make_client):
    qwen = FakeContextual("qwen", lambda ctx: {**empty("harmless"), "conversation_reading": "Classmates discussing homework; m04 asks for photos of it."})
    c = make_client(qwen=qwen, roberta=FakeRoberta({}))
    mid = homework_chat(c)
    out = analyze(c, "e6-c", mid).json()["result"]
    assert out["conversationReading"].startswith("Classmates discussing homework")
    assert len(out["analyzedMessageIds"]) == 4  # every message of the chat, not just the new one


def test_whole_chat_harmless_reading_overrides_out_of_context_flag(make_client):
    # The exact failure seen live: model reads the chat as harmless but still flags the photo request.
    qwen = FakeContextual("qwen", lambda ctx: {**empty("harmless"), "findings": [finding(alias_of(ctx, "pics"), "image_request", target=M, confidence="high")]})
    c = make_client(qwen=qwen, roberta=FakeRoberta({}))
    mid = homework_chat(c)
    out = analyze(c, "e6-c", mid).json()
    assert out["evidence"] == []  # the harmless whole-chat reading wins: nothing is recorded, nothing is acted on
    assert out["result"]["fusion"][0]["status"] == "suppressed"
    assert any("contradicts serious findings" in w for w in out["result"]["warnings"])


def test_uncertain_reading_sends_non_high_critical_cue_to_review(make_client):
    qwen = FakeContextual("qwen", lambda ctx: {**empty("uncertain"), "findings": [finding(alias_of(ctx, "pics"), "image_request", target=M, confidence="medium")]})
    c = make_client(qwen=qwen, roberta=FakeRoberta({}))
    mid = homework_chat(c)
    ev = analyze(c, "e6-c", mid).json()["evidence"][0]
    assert ev["status"] == "needs_review"


def test_context_that_makes_a_request_concerning_still_alerts(make_client):
    # Context works both ways: after secrecy, a high-confidence request in a "harmful" chat stays active.
    def resp(ctx):
        return {**empty("harmful"), "findings": [finding(alias_of(ctx, "parents"), "secrecy"), finding(alias_of(ctx, "picture"), "image_request")]}

    c = make_client(qwen=FakeContextual("qwen", resp), roberta=FakeRoberta({}))
    load(c, "s3-grooming")
    post_msg(c, "s3-c-kabir", K, "don't tell your parents about our chats")
    mid = post_msg(c, "s3-c-kabir", K, "send me a picture of you")
    ev = {e["cue"]: e for e in analyze(c, "s3-c-kabir", mid).json()["evidence"]}
    assert ev["image_request"]["status"] == "active" and ev["secrecy"]["status"] == "active"


def test_verifier_receives_the_whole_transcript(make_client):
    qwen = FakeContextual("qwen", lambda ctx: {**empty("concerning"), "findings": [finding(alias_of(ctx, "pics"), "image_request", target=M, confidence="medium")]}, verdict="not_supported")
    c = make_client(qwen=qwen, roberta=FakeRoberta({}))
    mid = homework_chat(c)
    out = analyze(c, "e6-c", mid).json()
    assert [t["text"] for t in qwen.transcripts[0]] == ["hey", "did you write todays homework", "yes", "can u send pics"]
    claim = qwen.verified[0]
    assert claim["message_id"] == "m04" and claim["analyser_context_basis"] == "test basis" and "preceding" not in claim
    assert "not a photo of homework" in claim["definition"]
    assert out["evidence"] == [] or all(e["status"] == "superseded" for e in out["evidence"])


def test_missing_reading_is_reported():
    conv = Conversation(id="c1", child_id=M, kind="private", title="Dev", participant_ids=[M, "p-dev"])
    parts = {M: Participant(id=M, display_name="Meera", role="protected_child"), "p-dev": Participant(id="p-dev", display_name="Dev", role="peer")}
    msgs = [Message(id="r1", conversation_id="c1", sender_id="p-dev", day=1, time="t", seq=1, text="hi")]
    ctx = build_context(parts[M], conv, parts, msgs, ["r1"], [], [], {}, {}, 4000, 10)
    raw = {**empty("harmless")}
    del raw["conversation_reading"]
    v = validate(raw, ctx)
    assert v.reading == "" and any("no conversation_reading" in w for w in v.warnings)
