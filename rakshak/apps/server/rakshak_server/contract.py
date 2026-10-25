"""Shared analysis contract (rakshak.analysis.v1). Mirrors packages/shared/src/index.ts.

JSON on the wire is camelCase; Python attributes are snake_case.
"""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

SCHEMA_VERSION = "rakshak.analysis.v1"

CUES: tuple[str, ...] = (
    "flattery_age",
    "secrecy",
    "isolation",
    "platform_move",
    "manipulation",
    "personal_info_request",
    "image_request",
    "meeting_request",
    "disable_protection",
    "threat_payment",
    "insult_harassment",
    "humiliation",
    "exclusion",
    "intimidation",
)
BULLYING_CUES = frozenset({"insult_harassment", "humiliation", "exclusion", "intimidation"})
CUE_CATEGORY = {c: ("bullying" if c in BULLYING_CUES else "grooming") for c in CUES}

MODIFIERS = ("none", "banter", "quoted", "counterspeech")
ASSESSMENTS = ("harmless", "concerning", "harmful", "uncertain")
CONFIDENCES = ("low", "medium", "high")
PATTERN_TYPES = (
    "repeated_harassment",
    "group_targeting",
    "cross_chat_targeting",
    "grooming_progression",
    "mutual_banter",
    "harmless_secrecy",
    "counterspeech",
    "prompt_injection_attempt",
)
# Categorical model confidence -> evidence strength. Models are never asked for numeric scores.
CONFIDENCE_P = {"low": 0.4, "medium": 0.7, "high": 0.9}
# Request cues are harmful only when what is requested is the child (their photo, their company, their whereabouts).
REQUEST_CUES = frozenset({"image_request", "meeting_request", "personal_info_request"})
REQUEST_SUBJECTS = ("child", "everyday_thing", "unclear", "not_applicable")

Backend = Literal["local_hybrid", "chatgpt_cloud"]


class Camel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    def dump(self) -> dict:
        return self.model_dump(by_alias=True)


class Participant(Camel):
    id: str
    display_name: str
    role: Literal["protected_child", "contact", "peer"]


class Conversation(Camel):
    id: str
    child_id: str
    kind: Literal["private", "group"]
    title: str
    participant_ids: list[str]


class Message(Camel):
    id: str
    conversation_id: str
    sender_id: str
    day: int
    time: str
    seq: int
    text: str
    type: Literal["text"] = "text"


class EvidenceEvent(Camel):
    key: str
    child_id: str
    backend: Backend
    conversation_id: str
    message_id: str
    sender_id: str
    target_id: Optional[str]
    target_basis: Literal["model", "private_chat", "unknown"]
    cue: str
    category: Literal["grooming", "bullying"]
    day: int
    seq: int
    p: float
    modifier: str
    status: Literal["active", "needs_review", "superseded", "suppressed"]
    agreement: Literal["agree", "contextual_only", "context_override", "needs_review", "single_model"]
    sources: list[str]
    rationale: str
    run_id: str


class RobertaScore(Camel):
    message_id: str
    model: str
    not_bullying: float
    bullying: float
    predicted: Literal["bullying", "not_bullying"]
    latency_ms: float


class ModelFinding(Camel):
    message_id: str
    cue: str
    target_id: Optional[str]
    modifier: str
    confidence: str
    rationale: str
    # Which earlier messages shaped this reading (from the model), or "no earlier context".
    context_basis: Optional[str] = None
    # Request cues only: what is being asked for, as the model resolved it from the conversation.
    requested_subject: Optional[str] = None
    # Result of the verification pass: supported | unclear | corroborated (RoBERTa agrees) | known (already evidence) | None (not run)
    verification: Optional[str] = None


class PatternNote(Camel):
    type: str
    message_ids: list[str]
    summary: str


class FusionDecision(Camel):
    message_id: str
    cue: str
    agreement: str
    status: str
    p: float
    sources: list[str]
    note: str


class AnalysisError(Camel):
    code: str
    message: str


class Latency(Camel):
    total_ms: float
    roberta_ms: Optional[float] = None
    contextual_ms: Optional[float] = None


class ContextStats(Camel):
    messages: int
    related_evidence: int
    approx_tokens: int
    truncated: bool


class AnalysisResult(Camel):
    schema_version: str = SCHEMA_VERSION
    analysis_id: str
    request_id: str
    backend: Backend
    models: dict[str, Optional[str]]
    child_id: str
    conversation_id: str
    analyzed_message_ids: list[str]
    focus_message_ids: list[str]
    target_participant_id: Optional[str] = None
    categories: list[str] = Field(default_factory=list)
    assessment: str = "uncertain"
    findings: list[ModelFinding] = Field(default_factory=list)
    patterns: list[PatternNote] = Field(default_factory=list)
    explanation: str = ""
    # The model's reading of the whole conversation, written before any finding.
    conversation_reading: str = ""
    uncertain_reason: Optional[str] = None
    roberta: list[RobertaScore] = Field(default_factory=list)
    fusion: list[FusionDecision] = Field(default_factory=list)
    touched_evidence: list[str] = Field(default_factory=list)
    superseded_evidence: list[str] = Field(default_factory=list)
    latency: Latency
    context_stats: ContextStats
    error: Optional[AnalysisError] = None
    warnings: list[str] = Field(default_factory=list)
    stale: bool = False
    created_at: str


# ---------- request bodies ----------


class NewMessage(Camel):
    id: Optional[str] = None
    conversation_id: str
    sender_id: str
    day: int
    time: str
    text: str = Field(min_length=1, max_length=2000)


class NewConversation(Camel):
    id: Optional[str] = None
    kind: Literal["private", "group"]
    title: str = Field(min_length=1, max_length=80)
    participant_ids: list[str]


class NewParticipant(Camel):
    id: Optional[str] = None
    display_name: str = Field(min_length=1, max_length=40)
    role: Literal["contact", "peer"] = "peer"


class AnalyzeRequest(Camel):
    backend: Backend
    conversation_id: str
    upto_message_id: Optional[str] = None
    request_id: str
    # ChatGPT only: must come from the owner's explicit "Analyze with ChatGPT" action.
    trigger: Literal["auto", "owner_button", "eval"] = "auto"
    model: Optional[str] = None


class SnapshotIn(Camel):
    backend: Backend
    run_id: Optional[str] = None
    day: int
    score: float
    level: int
    stage: str
    category: str
    dominant_track: Optional[str] = None
    trace: list[str] = Field(default_factory=list)
    evidence_keys: list[str] = Field(default_factory=list)


class AlertIn(Camel):
    id: str
    backend: Backend
    track_key: str
    level: int
    day: int
    time: str
    title: str
    body: str
    # Raised while an earlier conversation was being analysed (history preload): recorded, not pushed as a pop-up.
    historical: bool = False


class AlertWithdrawIn(Camel):
    backend: Backend
    reason: str = Field(default="", max_length=300)


class DismissalIn(Camel):
    day: int
    track_key: Optional[str] = None


class BlockIn(Camel):
    contact_id: str
    day: int
