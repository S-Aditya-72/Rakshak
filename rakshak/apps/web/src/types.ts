// UI types. Engine/contract types live in packages/shared and packages/engine; these are the shapes the UI renders.

import type { AnalysisResult, CueId } from '@rakshak/shared';

export type Side = 'predator' | 'victim';
/** A = Guided Demo (scripted playback), B = Continue the Conversation (preloaded history), C = Free Chat (fresh). */
export type Mode = 'A' | 'B' | 'C';
/** How the current case started. Distinct from the selected mode: switching modes never changes the case. */
export type Origin = 'scripted' | 'history' | 'fresh' | 'preview';
/** UI backend keys: 'inhouse' = RAKSHAK Hybrid (local), 'gpt' = ChatGPT (cloud, Sign in with ChatGPT). */
export type Backend = 'gpt' | 'inhouse';
export type Level = 0 | 1 | 2 | 3;

export type Cue = CueId;

export type Stage = 'rapport' | 'secrecy_isolation' | 'request' | 'coercion';
export type Category = 'grooming' | 'bullying' | 'none';

export interface CueHit {
  cue: Cue;
  p: number;
  /** Fusion/evidence status, when this came from a real run. */
  status?: 'active' | 'needs_review' | 'superseded' | 'suppressed';
  agreement?: string;
  modifier?: string;
  targetId?: string | null;
}

export interface Analysis {
  cues: CueHit[];
  score: number;
  level: Level;
  stage: Stage;
  trace: string[];
  /** Measured latency of the backend that produced this analysis. */
  latency: Partial<Record<Backend, number>>;
  alert?: { guardianTitle: string; guardianBody: string };
  category?: Category;
  /** The real model run behind this analysis. Absent for presentation previews. */
  run?: AnalysisResult;
  /** True for the precomputed presentation preview (not live AI output). */
  preview?: boolean;
}

export interface ChatMessage {
  id: string;
  kind: 'msg' | 'day';
  from?: Side;
  /** Conversation this row belongs to. */
  conversationId?: string;
  /** Participant id of the sender (msg rows). */
  senderId?: string;
  text: string;
  day: number;
  time: string;
  analysis?: Analysis;
}

export interface AlertItem {
  id: string;
  level: 1 | 2 | 3;
  day: number;
  time: string;
  stage: Stage;
  score: number;
  contact: string;
  guardianTitle: string;
  guardianBody: string;
  cues: { cue: Cue; day: number }[];
  preview?: boolean;
  category?: Category;
  trackKey?: string;
  /** Case this alert was raised in (child id + case generation). Guardian views never fall back to another case. */
  caseKey?: string;
  /** Protected child's display name when the alert was raised. */
  childName?: string;
  /** Raised while earlier history was being analysed: listed, not pushed as a pop-up. */
  historical?: boolean;
  /** Evidence rows behind the alert's track at the time it fired. */
  evidenceKeys?: string[];
  /** The evidence behind this alert was retracted on a fuller reading of the chat. Shown as withdrawn, never deleted. */
  withdrawn?: boolean;
  withdrawnReason?: string;
}

export interface ParticipantView {
  id: string;
  displayName: string;
  role: 'protected_child' | 'contact' | 'peer';
}

export interface ConversationView {
  id: string;
  kind: 'private' | 'group';
  title: string;
  participantIds: string[];
}
