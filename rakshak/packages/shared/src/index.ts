// RAKSHAK shared contract (schema rakshak.analysis.v1).
// One shape for every backend: the Python inference service emits it, the TS engine consumes it,
// and the web UI renders it. Mirrored in apps/server/rakshak_server/contract.py; keep both in sync.

export const SCHEMA_VERSION = 'rakshak.analysis.v1' as const;

// ---------- taxonomy ----------

/** Evidence cue types. A cue is attached to one message; patterns across messages are derived by the engine. */
export const CUES = [
  // grooming / child-safeguarding cues (Plan.md §2.1)
  'flattery_age',
  'secrecy',
  'isolation',
  'platform_move',
  'manipulation',
  'personal_info_request',
  'image_request',
  'meeting_request',
  'disable_protection',
  'threat_payment',
  // bullying cues
  'insult_harassment',
  'humiliation',
  'exclusion',
  'intimidation',
] as const;
export type CueId = (typeof CUES)[number];

export type CueCategory = 'grooming' | 'bullying';

export const CUE_CATEGORY: Record<CueId, CueCategory> = {
  flattery_age: 'grooming',
  secrecy: 'grooming',
  isolation: 'grooming',
  platform_move: 'grooming',
  manipulation: 'grooming',
  personal_info_request: 'grooming',
  image_request: 'grooming',
  meeting_request: 'grooming',
  disable_protection: 'grooming',
  threat_payment: 'grooming',
  insult_harassment: 'bullying',
  humiliation: 'bullying',
  exclusion: 'bullying',
  intimidation: 'bullying',
};

/** How the message relates to the harm it contains. Reductions apply per the engine config. */
export const MODIFIERS = ['none', 'banter', 'quoted', 'counterspeech'] as const;
export type Modifier = (typeof MODIFIERS)[number];

export const ASSESSMENTS = ['harmless', 'concerning', 'harmful', 'uncertain'] as const;
export type Assessment = (typeof ASSESSMENTS)[number];

export const CONFIDENCES = ['low', 'medium', 'high'] as const;
export type Confidence = (typeof CONFIDENCES)[number];

export const PATTERN_TYPES = [
  'repeated_harassment',
  'group_targeting',
  'cross_chat_targeting',
  'grooming_progression',
  'mutual_banter',
  'harmless_secrecy',
  'counterspeech',
  'prompt_injection_attempt',
] as const;
export type PatternType = (typeof PATTERN_TYPES)[number];

/** Analysis backends. `local_hybrid` = RoBERTa + Qwen3.5 4B + fusion; `chatgpt_cloud` = Sign in with ChatGPT. */
export type BackendId = 'local_hybrid' | 'chatgpt_cloud';

/**
 * Agreement between the per-message classifier (RoBERTa) and the contextual model (Qwen/ChatGPT):
 * - agree: both flag bullying on this message
 * - contextual_only: only the contextual model flags harm (RoBERTa negative, or cue outside RoBERTa's scope)
 * - context_override: RoBERTa flags bullying, context explains it as banter/quote/counterspeech
 * - needs_review: RoBERTa flags bullying, contextual model is silent; kept at reduced weight
 * - single_model: only one model was available (e.g. Qwen offline, or the ChatGPT backend)
 */
export type Agreement = 'agree' | 'contextual_only' | 'context_override' | 'needs_review' | 'single_model';

export type EvidenceStatus = 'active' | 'needs_review' | 'superseded' | 'suppressed';

export type ModelSource = 'roberta' | 'qwen' | 'chatgpt';

// ---------- entities ----------

export type ParticipantRole = 'protected_child' | 'contact' | 'peer';

export interface Participant {
  id: string;
  displayName: string;
  role: ParticipantRole;
}

export interface Conversation {
  id: string;
  childId: string;
  kind: 'private' | 'group';
  title: string;
  participantIds: string[];
}

export interface Message {
  id: string;
  conversationId: string;
  senderId: string;
  /** Simulated day (1-based). Decay and first-contact rules use this, never wall time. */
  day: number;
  time: string;
  /** Monotonic order within the child's whole history. Assigned by the server. */
  seq: number;
  text: string;
  type: 'text';
}

/**
 * A verified evidence reference. Identity is stable: (backend, conversation, message, cue, target),
 * so re-analysing unchanged evidence updates the same row instead of adding a new one.
 */
export interface EvidenceEvent {
  key: string;
  childId: string;
  backend: BackendId;
  conversationId: string;
  messageId: string;
  senderId: string;
  targetId: string | null;
  /** Why the target is believed: the model named a participant, or it is a 1:1 chat with the child. */
  targetBasis: 'model' | 'private_chat' | 'unknown';
  cue: CueId;
  category: CueCategory;
  day: number;
  seq: number;
  /** Evidence strength from the models (not a calibrated incident probability). */
  p: number;
  modifier: Modifier;
  status: EvidenceStatus;
  agreement: Agreement;
  sources: ModelSource[];
  rationale: string;
  runId: string;
}

// ---------- analysis contract ----------

export interface RobertaScore {
  messageId: string;
  model: string;
  /** Raw softmax outputs. LABEL_0 = not_cyberbullying, LABEL_1 = cyberbullying (model card). */
  notBullying: number;
  bullying: number;
  predicted: 'bullying' | 'not_bullying';
  latencyMs: number;
}

export interface ModelFinding {
  messageId: string;
  cue: CueId;
  targetId: string | null;
  modifier: Modifier;
  confidence: Confidence;
  rationale: string;
  /** Earlier messages that shaped this reading, as the model stated them ("no earlier context" if none). */
  contextBasis?: string | null;
  /** Verification pass result: supported | unclear | corroborated | known; absent when not run. */
  verification?: string | null;
}

export interface PatternNote {
  type: PatternType;
  messageIds: string[];
  summary: string;
}

export interface FusionDecision {
  messageId: string;
  cue: CueId;
  agreement: Agreement;
  status: EvidenceStatus;
  p: number;
  sources: ModelSource[];
  note: string;
}

export interface AnalysisError {
  code:
    | 'ollama_unavailable'
    | 'model_missing'
    | 'invalid_model_output'
    | 'timeout'
    | 'roberta_unavailable'
    | 'chatgpt_unavailable'
    | 'chatgpt_not_signed_in'
    | 'chatgpt_permission_denied'
    | 'chatgpt_usage_limit'
    | 'chatgpt_error'
    | 'consent_required'
    | 'stale'
    | 'internal';
  message: string;
}

export interface AnalysisResult {
  schemaVersion: typeof SCHEMA_VERSION;
  analysisId: string;
  requestId: string;
  backend: BackendId;
  models: { contextual: string | null; classifier: string | null };
  childId: string;
  conversationId: string;
  /** Every message supplied to the contextual model. */
  analyzedMessageIds: string[];
  /** Messages that were new for this run (the ones being judged now). */
  focusMessageIds: string[];
  targetParticipantId: string | null;
  categories: string[];
  assessment: Assessment;
  /** Validated contextual findings. Raw model output that failed validation is listed in `warnings`. */
  findings: ModelFinding[];
  patterns: PatternNote[];
  explanation: string;
  /** The model's reading of the whole conversation, written before any finding. */
  conversationReading?: string;
  uncertainReason: string | null;
  roberta: RobertaScore[];
  fusion: FusionDecision[];
  /** Evidence keys newly written or updated / marked superseded by this run. */
  touchedEvidence: string[];
  supersededEvidence: string[];
  latency: { totalMs: number; robertaMs: number | null; contextualMs: number | null };
  contextStats: { messages: number; relatedEvidence: number; approxTokens: number; truncated: boolean };
  error: AnalysisError | null;
  warnings: string[];
  stale: boolean;
  createdAt: string;
}

/** Full persisted state for one protected child, as returned by GET /api/state. */
export interface CaseStateDTO {
  child: Participant;
  participants: Participant[];
  conversations: Conversation[];
  messages: Message[];
  evidence: EvidenceEvent[];
  runs: AnalysisResult[];
  dismissals: { day: number; trackKey: string | null }[];
  blocks: { contactId: string; day: number }[];
  alerted: Record<string, Record<string, number>>;
  scenarioId: string | null;
}
