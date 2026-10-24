"""Validation of raw model output. Anything a model says is checked against the supplied context.

- message ids must be ones we supplied (aliases are mapped back to real ids)
- target ids must be participants of the conversation, or null
- enums must match; unknown values are rejected with a warning, never silently accepted
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Any, Optional

from .contract import ASSESSMENTS, CONFIDENCES, CUES, MODIFIERS, PATTERN_TYPES, REQUEST_CUES, REQUEST_SUBJECTS, ModelFinding, PatternNote
from .context import Context


class InvalidModelOutput(ValueError):
    pass


@dataclass
class Validated:
    assessment: str
    categories: list[str]
    target_id: Optional[str]
    findings: list[ModelFinding]
    retractions: list[tuple[str, str, str]]
    patterns: list[PatternNote]
    explanation: str
    uncertain_reason: Optional[str]
    warnings: list[str] = field(default_factory=list)
    reading: str = ""


def parse_json(text: str) -> dict:
    """Parse a model's JSON reply. Tolerates markdown fences and leading/trailing prose around one object."""
    t = text.strip()
    t = re.sub(r"^```(?:json)?\s*|\s*```$", "", t)
    try:
        obj = json.loads(t)
    except json.JSONDecodeError:
        start, end = t.find("{"), t.rfind("}")
        if start < 0 or end <= start:
            raise InvalidModelOutput("no JSON object in model output")
        try:
            obj = json.loads(t[start : end + 1])
        except json.JSONDecodeError as e:
            raise InvalidModelOutput(f"malformed JSON: {e.msg}") from e
    if not isinstance(obj, dict):
        raise InvalidModelOutput("model output is not a JSON object")
    return obj


def _s(v: Any, limit: int) -> str:
    return (v if isinstance(v, str) else "").strip()[:limit]


def validate(raw: dict, ctx: Context) -> Validated:
    w: list[str] = []
    participants = set(ctx.participant_ids)

    def mid(v: Any, where: str) -> Optional[str]:
        if isinstance(v, str):
            if v in ctx.alias_to_id:
                return ctx.alias_to_id[v]
            if v in ctx.id_to_alias:  # model echoed a real id
                return v
        w.append(f"{where}: rejected message id {v!r} (not in supplied context)")
        return None

    def tid(v: Any, where: str) -> tuple[Optional[str], bool]:
        if v is None or v == "" or v == "null":
            return None, True
        if isinstance(v, str) and v in participants:
            return v, True
        w.append(f"{where}: rejected target {v!r} (not a participant)")
        return None, False

    assessment = raw.get("assessment")
    if assessment not in ASSESSMENTS:
        raise InvalidModelOutput(f"invalid assessment {assessment!r}")

    target, _ = tid(raw.get("target_participant_id"), "target_participant_id")

    findings: list[ModelFinding] = []
    seen: set[tuple[str, str, Optional[str]]] = set()
    raw_findings = raw.get("findings")
    if not isinstance(raw_findings, list):
        raise InvalidModelOutput("findings must be a list")
    for i, f in enumerate(raw_findings):
        if not isinstance(f, dict):
            w.append(f"findings[{i}]: not an object")
            continue
        m = mid(f.get("message_id"), f"findings[{i}]")
        cue = f.get("cue")
        if cue not in CUES:
            w.append(f"findings[{i}]: rejected cue {cue!r}")
            continue
        if m is None:
            continue
        t, ok = tid(f.get("target_id"), f"findings[{i}]")
        sender = next((x.sender_id for x in ctx.messages if x.id == m), None)
        if t is not None and t == sender:
            w.append(f"findings[{i}]: rejected self-target {t!r} (a sender cannot target themselves)")
            t = None
        modifier = f.get("modifier") if f.get("modifier") in MODIFIERS else "none"
        confidence = f.get("confidence") if f.get("confidence") in CONFIDENCES else "low"
        if f.get("confidence") not in CONFIDENCES:
            w.append(f"findings[{i}]: confidence {f.get('confidence')!r} defaulted to low")
        subject = f.get("requested_subject")
        if cue in REQUEST_CUES:
            if subject not in REQUEST_SUBJECTS or subject == "not_applicable":
                w.append(f"findings[{i}]: {cue} without a resolved requested_subject; treated as unclear")
                subject = "unclear"
            if subject == "everyday_thing" and modifier == "none":
                # The model itself resolved the request to something ordinary (homework, notes, an object): not a cue.
                w.append(f"findings[{i}]: dropped {cue}: the model resolved the request to an everyday thing")
                continue
        else:
            subject = None
        k = (m, cue, t)
        if k in seen:
            continue
        seen.add(k)
        basis = _s(f.get("context_basis"), 240) or None
        findings.append(ModelFinding(message_id=m, cue=cue, target_id=t, modifier=modifier, confidence=confidence, rationale=_s(f.get("rationale"), 200), context_basis=basis, requested_subject=subject))

    retractions: list[tuple[str, str, str]] = []
    for i, r in enumerate(raw.get("retractions") or []):
        if isinstance(r, dict) and r.get("cue") in CUES:
            m = mid(r.get("message_id"), f"retractions[{i}]")
            if m:
                retractions.append((m, r["cue"], _s(r.get("reason"), 200)))

    patterns: list[PatternNote] = []
    for i, p in enumerate(raw.get("patterns") or []):
        if not isinstance(p, dict) or p.get("type") not in PATTERN_TYPES:
            w.append(f"patterns[{i}]: rejected type {p.get('type') if isinstance(p, dict) else p!r}")
            continue
        ids = [x for x in (mid(v, f"patterns[{i}]") for v in (p.get("message_ids") or [])) if x]
        patterns.append(PatternNote(type=p["type"], message_ids=ids, summary=_s(p.get("summary"), 240)))

    reading = _s(raw.get("conversation_reading"), 600)
    if not reading:
        w.append("model gave no conversation_reading; findings were not anchored to a whole-chat reading")
    if assessment == "harmless" and any(f.modifier == "none" for f in findings):
        w.append("assessment 'harmless' contradicts serious findings; those findings go to review")

    categories = [c for c in (raw.get("categories") or []) if c in ("bullying", "grooming", "banter", "none")]
    ur = raw.get("uncertain_reason")
    return Validated(
        assessment=assessment,
        categories=categories,
        target_id=target,
        findings=findings,
        retractions=retractions,
        patterns=patterns,
        explanation=_s(raw.get("explanation"), 400),
        uncertain_reason=_s(ur, 300) if isinstance(ur, str) and ur.strip() else None,
        warnings=w,
        reading=reading,
    )
