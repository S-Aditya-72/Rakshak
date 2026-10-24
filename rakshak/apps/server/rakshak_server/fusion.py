"""Hybrid fusion: RoBERTa (per-message, binary) + contextual model (Qwen or ChatGPT, whole conversation).

Rules (see README "Fusion"):
- The contextual model is never gated on RoBERTa: it can raise evidence RoBERTa missed (contextual_only).
- RoBERTa can corroborate overt verbal abuse the contextual model also found (agree; strength = max).
- If RoBERTa flags a message that context explains as banter/quote/counterspeech or a harmless exchange,
  the RoBERTa signal is kept but suppressed (context_override) and does not score.
- If RoBERTa flags a message and the contextual model is silent, that is an explicit disagreement:
  needs_review evidence, which the engine counts at reduced weight and which cannot trigger floors.
- One evidence event per (backend, conversation, message, cue, target): both models feed the same row,
  so the same harm is never counted twice.
- RoBERTa never produces grooming cues.
- The whole-chat reading is authoritative: a finding the model's own conversation-level assessment contradicts
  ("harmless", or "uncertain" without high confidence) is kept but goes to needs_review, for every cue. It cannot
  trigger floors on its own, so one word read out of context never raises an alert.
"""

from __future__ import annotations

from typing import Optional

from .contract import CONFIDENCE_P, CUE_CATEGORY, Conversation, EvidenceEvent, FusionDecision, Message, RobertaScore
from .db import evidence_key
from .validation import Validated


def objectors(validated: Optional[Validated], messages: dict[str, Message]) -> set[str]:
    """Participants who pushed back in this window (their own message read as counterspeech)."""
    out: set[str] = set()
    if not validated:
        return out
    ids = {f.message_id for f in validated.findings if f.modifier == "counterspeech"}
    ids |= {m for p in validated.patterns if p.type == "counterspeech" for m in p.message_ids}
    for mid in ids:
        if mid in messages:
            out.add(messages[mid].sender_id)
    return out


def _target(conv: Conversation, child_id: str, sender_id: str, model_target: Optional[str], fallback_target: Optional[str], bullying: bool) -> tuple[Optional[str], str]:
    if model_target:
        return model_target, "model"
    if bullying and fallback_target and fallback_target != sender_id:
        return fallback_target, "model"
    if conv.kind == "private":
        other = next((p for p in conv.participant_ids if p != sender_id), None)
        return other, "private_chat"
    return None, "unknown"


def fuse(
    *,
    backend: str,
    child_id: str,
    conv: Conversation,
    messages: dict[str, Message],
    focus_ids: list[str],
    roberta: dict[str, RobertaScore],
    validated: Optional[Validated],
    contextual_source: Optional[str],
    roberta_threshold: float,
    run_id: str,
    prior_objectors: frozenset[str] = frozenset(),
) -> tuple[list[EvidenceEvent], list[FusionDecision]]:
    events: dict[str, EvidenceEvent] = {}
    decisions: list[FusionDecision] = []

    def put(ev: EvidenceEvent, note: str) -> None:
        prev = events.get(ev.key)
        if prev and prev.p >= ev.p:
            return
        events[ev.key] = ev
        decisions.append(FusionDecision(message_id=ev.message_id, cue=ev.cue, agreement=ev.agreement, status=ev.status, p=ev.p, sources=ev.sources, note=note))

    benign_msgs: set[str] = set()
    explained_msgs: set[str] = set()
    if validated:
        for p in validated.patterns:
            if p.type in ("mutual_banter", "counterspeech", "harmless_secrecy"):
                benign_msgs.update(p.message_ids)
        for f in validated.findings:
            if f.modifier != "none":
                benign_msgs.add(f.message_id)
            else:
                explained_msgs.add(f.message_id)

        authors = {m.sender_id for m in messages.values()}
        objected = objectors(validated, messages) | set(prior_objectors)
        for f in validated.findings:
            m = messages.get(f.message_id)
            if not m:
                continue
            bullying = CUE_CATEGORY[f.cue] == "bullying"
            target, basis = _target(conv, child_id, m.sender_id, f.target_id, validated.target_id, bullying)
            modifier = f.modifier
            mutual_note = ""
            if modifier == "banter" and target:
                # Banter needs mutuality. RAKSHAK checks it deterministically instead of trusting the label.
                if target in objected:
                    modifier, mutual_note = "none", "; banter reading rejected: the target objected"
                elif target not in authors:
                    modifier, mutual_note = "none", "; banter reading unconfirmed: the target never joined in"
            p = CONFIDENCE_P[f.confidence]
            sources = [contextual_source or "qwen"]
            r = roberta.get(m.id)
            if r is None:
                agreement = "single_model" if backend == "chatgpt_cloud" else "contextual_only"
                note = f"{sources[0]} contextual finding"
            elif bullying and r.bullying >= roberta_threshold and modifier == "none":
                agreement, p = "agree", max(p, r.bullying)
                sources.append("roberta")
                note = f"both models flag harm (RoBERTa bullying={r.bullying:.2f})"
            elif bullying and r.bullying >= roberta_threshold:
                agreement = "context_override"
                sources.append("roberta")
                note = f"RoBERTa bullying={r.bullying:.2f}; context reads it as {modifier}"
            else:
                agreement = "contextual_only"
                note = f"contextual harm; RoBERTa bullying={r.bullying:.2f}" + ("" if bullying else " (cue outside RoBERTa's scope)")
            status = "active"
            note += mutual_note
            if mutual_note.endswith("never joined in"):
                status, agreement = "needs_review", "needs_review"
            if f.verification == "unclear":
                status, agreement = "needs_review", "needs_review"
                note += "; verification pass unclear"
            elif (
                modifier == "none"
                and agreement != "agree"
                and "target objected" not in mutual_note  # the objection is concrete evidence; it outweighs "harmless"
                and (validated.assessment == "harmless" or (validated.assessment == "uncertain" and f.confidence != "high"))
            ):
                # The model's own reading of the whole conversation does not support this finding: keep it, flag it.
                status, agreement = "needs_review", "needs_review"
                note += f"; contradicts the model's whole-chat assessment ({validated.assessment})"
            put(
                EvidenceEvent(
                    key=evidence_key(backend, conv.id, m.id, f.cue, target),
                    child_id=child_id, backend=backend, conversation_id=conv.id, message_id=m.id, sender_id=m.sender_id,
                    target_id=target, target_basis=basis, cue=f.cue, category=CUE_CATEGORY[f.cue], day=m.day, seq=m.seq,
                    p=round(p, 4), modifier=modifier, status=status, agreement=agreement, sources=sources,
                    rationale=f.rationale, run_id=run_id,
                ),
                note,
            )

    # RoBERTa-positive focus messages the contextual model did not explain.
    for mid in focus_ids:
        r = roberta.get(mid)
        m = messages.get(mid)
        if not r or not m or r.bullying < roberta_threshold:
            continue
        if any(e.message_id == mid and e.category == "bullying" for e in events.values()) or mid in explained_msgs:
            continue
        if m.sender_id == child_id:
            decisions.append(FusionDecision(message_id=mid, cue="insult_harassment", agreement="needs_review" if validated is None else "context_override", status="suppressed", p=r.bullying, sources=["roberta"], note="child's own message; not scored against the child"))
            continue
        target, basis = _target(conv, child_id, m.sender_id, None, validated.target_id if validated else None, True)
        if validated is None:
            status, agreement, modifier, note = "needs_review", "single_model", "none", "contextual model unavailable; RoBERTa only"
        elif mid in benign_msgs or validated.assessment == "harmless":
            status, agreement, modifier, note = "suppressed", "context_override", "banter" if mid in benign_msgs else "none", "RoBERTa flag overridden by conversation context"
        else:
            status, agreement, modifier, note = "needs_review", "needs_review", "none", "models disagree: RoBERTa flags abuse, contextual model found none"
        put(
            EvidenceEvent(
                key=evidence_key(backend, conv.id, mid, "insult_harassment", target),
                child_id=child_id, backend=backend, conversation_id=conv.id, message_id=mid, sender_id=m.sender_id,
                target_id=target, target_basis=basis, cue="insult_harassment", category="bullying", day=m.day, seq=m.seq,
                p=round(r.bullying, 4), modifier=modifier, status=status, agreement=agreement, sources=["roberta"],
                rationale=note, run_id=run_id,
            ),
            note,
        )

    return list(events.values()), decisions
