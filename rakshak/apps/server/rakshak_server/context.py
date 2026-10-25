"""Context retrieval: what the contextual model sees for one analysis.

1. The active conversation's history (oldest first), always including the focus messages and every message
   that already carries evidence, then filling newest-first until the token budget is spent.
2. Prior findings for this conversation (confirmed or pending), so the model can confirm or retract them, and the
   model's previous whole-chat reading, so its interpretation of earlier messages stays consistent.
3. Evidence from the child's other conversations (cross-chat memory), most recent first.

Message ids are aliased (m01, m02, ...) for small-model reliability and mapped back after validation.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

from .contract import Conversation, EvidenceEvent, Message, Participant


def approx_tokens(text: str) -> int:
    return len(text) // 3 + 8


@dataclass
class Context:
    payload: dict
    alias_to_id: dict[str, str]
    id_to_alias: dict[str, str]
    messages: list[Message]
    focus_ids: list[str]
    participant_ids: list[str]
    related: list[EvidenceEvent]
    truncated: bool
    approx_tokens: int
    omitted: int = 0
    notes: list[str] = field(default_factory=list)


def build_context(
    child: Participant,
    conv: Conversation,
    participants: dict[str, Participant],
    history: list[Message],
    focus_ids: list[str],
    conv_evidence: list[EvidenceEvent],
    other_evidence: list[EvidenceEvent],
    other_messages: dict[str, Message],
    conv_titles: dict[str, str],
    token_budget: int,
    related_limit: int,
    previous_reading: Optional[str] = None,
) -> Context:
    focus = set(focus_ids)
    evidence_msgs = {e.message_id for e in conv_evidence if e.status in ("active", "needs_review")}
    must = [m for m in history if m.id in focus or m.id in evidence_msgs]
    used = sum(approx_tokens(m.text) for m in must)
    chosen = {m.id for m in must}
    # Fill with the newest remaining messages until the budget is spent. Critical messages were taken first,
    # so evidence is never silently dropped; only plain older chatter is omitted, and that is reported.
    for m in reversed(history):
        if m.id in chosen:
            continue
        cost = approx_tokens(m.text)
        if used + cost > token_budget:
            continue
        chosen.add(m.id)
        used += cost
    selected = [m for m in history if m.id in chosen]
    omitted = len(history) - len(selected)

    alias_to_id: dict[str, str] = {}
    id_to_alias: dict[str, str] = {}
    width = max(2, len(str(len(selected))))
    for i, m in enumerate(selected, 1):
        a = f"m{i:0{width}d}"
        alias_to_id[a] = m.id
        id_to_alias[m.id] = a

    def pname(pid: str) -> str:
        p = participants.get(pid)
        return p.display_name if p else pid

    related = [e for e in other_evidence if e.status in ("active", "needs_review")]
    related.sort(key=lambda e: (-e.day, -e.seq))
    related = related[:related_limit]
    related_payload = []
    for i, e in enumerate(related, 1):
        m = other_messages.get(e.message_id)
        excerpt = (m.text[:160] + ("…" if len(m.text) > 160 else "")) if m else ""
        related_payload.append(
            {
                "ref": f"x{i}",
                "conversation": conv_titles.get(e.conversation_id, e.conversation_id),
                "day": e.day,
                "sender_id": e.sender_id,
                "sender_name": pname(e.sender_id),
                "target_id": e.target_id,
                "cue": e.cue,
                "text": excerpt,
            }
        )
        used += approx_tokens(excerpt) + 20

    payload = {
        "protected_child": {"id": child.id, "name": child.display_name},
        "conversation": {
            "id": conv.id,
            "kind": conv.kind,
            "title": conv.title,
            "participants": [{"id": pid, "name": pname(pid), "role": participants[pid].role if pid in participants else "peer"} for pid in conv.participant_ids],
        },
        "messages": [
            {"id": id_to_alias[m.id], "sender_id": m.sender_id, "sender_name": pname(m.sender_id), "day": m.day, "time": m.time, "text": m.text}
            for m in selected
        ],
        "omitted_older_messages": omitted,
        "focus_message_ids": [id_to_alias[i] for i in focus_ids if i in id_to_alias],
        "previous_reading": previous_reading,
        "prior_findings": [
            {"message_id": id_to_alias[e.message_id], "cue": e.cue, "target_id": e.target_id, "modifier": e.modifier, "status": "confirmed" if e.status == "active" else "pending"}
            for e in conv_evidence
            if e.status in ("active", "needs_review") and e.message_id in id_to_alias
        ],
        "related_evidence": related_payload,
    }
    return Context(
        payload=payload,
        alias_to_id=alias_to_id,
        id_to_alias=id_to_alias,
        messages=selected,
        focus_ids=[i for i in focus_ids if i in id_to_alias],
        participant_ids=list(conv.participant_ids),
        related=related,
        truncated=omitted > 0,
        approx_tokens=used,
        omitted=omitted,
    )
