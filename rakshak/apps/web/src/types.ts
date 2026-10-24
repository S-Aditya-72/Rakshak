// Shared UI types. These mirror packages/shared from Plan.md so the engine can plug in later.

export type Side = 'predator' | 'victim';
export type Mode = 'A' | 'B';
export type Backend = 'gpt' | 'inhouse';
export type Level = 0 | 1 | 2 | 3;

export type Cue =
  | 'flattery_age'
  | 'secrecy'
  | 'isolation'
  | 'platform_move'
  | 'image_request'
  | 'meeting_request'
  | 'disable_protection'
  | 'threat_payment'
  | 'insult_harassment';

export type Stage = 'rapport' | 'secrecy_isolation' | 'request' | 'coercion';

export interface CueHit {
  cue: Cue;
  p: number;
}

export interface Analysis {
  cues: CueHit[];
  score: number;
  level: Level;
  stage: Stage;
  trace: string[];
  latency: Record<Backend, number>;
  alert?: { guardianTitle: string; guardianBody: string };
}

export interface ChatMessage {
  id: string;
  kind: 'msg' | 'day';
  from?: Side;
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
}
