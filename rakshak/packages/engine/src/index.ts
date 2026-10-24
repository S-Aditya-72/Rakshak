// RAKSHAK deterministic risk engine.
// Models label evidence; this code decides. Same evidence + same config + same day => same score, every time.
// The engine is a pure function of the whole evidence set, so re-running analysis on unchanged evidence can
// never inflate the score: there is nothing to accumulate, only a set to recompute from.

import defaultConfig from '../config.json';
import { CUE_CATEGORY, type CueCategory, type CueId, type EvidenceEvent } from '@rakshak/shared';

export type Level = 0 | 1 | 2 | 3;
export type Stage = 'rapport' | 'secrecy_isolation' | 'request' | 'coercion';
export type EngineConfig = typeof defaultConfig;
export const DEFAULT_CONFIG: EngineConfig = defaultConfig;

export const STAGE_OF: Record<CueId, Stage | null> = {
  flattery_age: 'rapport',
  manipulation: 'secrecy_isolation',
  secrecy: 'secrecy_isolation',
  isolation: 'secrecy_isolation',
  platform_move: 'secrecy_isolation',
  disable_protection: 'secrecy_isolation',
  personal_info_request: 'request',
  image_request: 'request',
  meeting_request: 'request',
  threat_payment: 'coercion',
  insult_harassment: null,
  humiliation: null,
  exclusion: null,
  intimidation: null,
};
const STAGE_RANK: Record<Stage, number> = { rapport: 0, secrecy_isolation: 1, request: 2, coercion: 3 };

export interface EngineInput {
  childId: string;
  /** Evidence for one backend. Any status; superseded/suppressed rows are ignored. */
  evidence: EvidenceEvent[];
  /** First simulated day each participant interacted with the child (any conversation). */
  firstSeen: Record<string, number>;
  dismissals?: { day: number; trackKey: string | null }[];
  blocks?: { contactId: string; day: number }[];
  /** Day the score is evaluated at (the sim clock). */
  evalDay: number;
  names?: Record<string, string>;
  config?: EngineConfig;
}

export interface TrackCue {
  cue: CueId;
  day: number;
  conversationId: string;
  messageId: string;
  senderId: string;
  evidenceKey: string;
}

export interface TrackState {
  key: string;
  kind: CueCategory;
  /** Grooming tracks are per contact. The bullying track is child-level, across all senders and chats. */
  contactId: string | null;
  score: number;
  scoreLevel: Level;
  floorLevel: Level;
  level: Level;
  stage: Stage;
  floors: string[];
  cues: TrackCue[];
  senders: string[];
  conversations: string[];
  dismissals: number;
  linkCandidate: { fromContactId: string; reason: string } | null;
  trace: string[];
  /** Score right after each scoring event, for the timeline chart. */
  points: { day: number; score: number }[];
}

export interface RiskState {
  evalDay: number;
  score: number;
  level: Level;
  stage: Stage;
  category: CueCategory | 'none';
  dominantTrack: string | null;
  tracks: TrackState[];
  /** Evidence aimed at other participants: recorded, not counted towards this child's case. */
  otherTargets: { evidenceKey: string; targetId: string | null; cue: CueId }[];
  trace: string[];
}

const fmt = (n: number) => n.toFixed(1);
const fmtP = (p: number) => p.toFixed(2);

export function levelForScore(score: number, cfg: EngineConfig = DEFAULT_CONFIG): Level {
  // Round to one decimal first so the displayed score and the level always agree (8.96 shows as 9.0 => L3).
  const s = Math.round(score * 10) / 10;
  return s >= cfg.thresholds.l3 ? 3 : s >= cfg.thresholds.l2 ? 2 : s >= cfg.thresholds.l1 ? 1 : 0;
}

export const decay = (score: number, days: number, halfLife = DEFAULT_CONFIG.halfLifeDays) =>
  days <= 0 ? score : score * Math.pow(0.5, days / halfLife);

type TimelineItem =
  | { t: 'ev'; day: number; seq: number; ev: EvidenceEvent }
  | { t: 'dismiss'; day: number; seq: number; trackKey: string | null };

function byTime(a: { day: number; seq: number }, b: { day: number; seq: number }) {
  return a.day - b.day || a.seq - b.seq;
}

/** Score one track (one contact's grooming case, or the child-level bullying case). */
function scoreTrack(key: string, kind: CueCategory, contactId: string | null, events: EvidenceEvent[], input: EngineInput, cfg: EngineConfig): TrackState {
  const name = (id: string) => input.names?.[id] ?? id;
  const H = cfg.halfLifeDays;
  const trace: string[] = [];
  const points: { day: number; score: number }[] = [];
  const floors: { level: Level; why: string }[] = [];
  const cues: TrackCue[] = [];
  const senders = new Set<string>();
  const conversations = new Set<string>();
  let stage: Stage = 'rapport';
  let primed = false; // a secrecy/isolation cue has been seen on this track
  let s = 0;
  let last: number | null = null;
  let dismissals = 0;
  let dismissalFloor = false;
  const awarded = { pileOn: false, crossChat: false, repeat: new Set<string>() };
  const window: EvidenceEvent[] = [];

  if (kind === 'grooming' && contactId !== null) {
    const first = input.firstSeen[contactId];
    if (first !== undefined) trace.push(`contact ${name(contactId)} · first seen Day ${first}`);
  }

  const timeline: TimelineItem[] = [
    ...events.map((ev) => ({ t: 'ev' as const, day: ev.day, seq: ev.seq, ev })),
    ...(input.dismissals ?? [])
      .filter((d) => d.trackKey === null || d.trackKey === key)
      .map((d) => ({ t: 'dismiss' as const, day: d.day, seq: Number.MAX_SAFE_INTEGER, trackKey: d.trackKey })),
  ].sort(byTime);

  const advance = (day: number) => {
    if (last !== null && day > last && s > 0) {
      const before = s;
      s = decay(s, day - last, H);
      trace.push(`decay ${fmt(before)} → ${fmt(s)}  (Δ${day - last}d · t½ ${H}d)`);
    }
    if (last === null || day > last) last = day;
  };

  for (const item of timeline) {
    if (item.t === 'dismiss') {
      if (s <= 0) continue;
      advance(item.day);
      const lvl = levelForScore(s, cfg);
      if (STAGE_RANK[stage] >= STAGE_RANK.request) {
        trace.push(`dismissal on Day ${item.day} ignored at ${stage} stage`);
        dismissals++;
        continue;
      }
      if (lvl >= 1) dismissalFloor = true;
      const before = s;
      s *= cfg.reductions.dismissal;
      dismissals++;
      trace.push(`child dismissed nudge · ${fmt(before)} → ${fmt(s)} (×${cfg.reductions.dismissal}, never below L1)`);
      points.push({ day: item.day, score: s });
      continue;
    }

    const ev = item.ev;
    const w = cfg.weights[ev.cue as keyof EngineConfig['weights']];
    if (ev.p < cfg.cueThreshold) {
      trace.push(`${ev.cue}  p=${fmtP(ev.p)}  below threshold`);
      continue;
    }
    // Pending (unconfirmed) evidence is recorded and shown, but takes no step: no score, no stage, no floor,
    // no attribution. It counts only once the analysis confirms it (status "active").
    if (ev.status === 'needs_review') {
      trace.push(`${ev.cue}  p=${fmtP(ev.p)}  pending confirmation · not scored`);
      continue;
    }
    advance(ev.day);

    let factor = 1;
    const notes: string[] = [];
    if (ev.modifier === 'quoted' || ev.modifier === 'counterspeech') {
      factor *= cfg.reductions[ev.modifier];
      notes.push(`×${cfg.reductions[ev.modifier]} ${ev.modifier}`);
    } else if (ev.modifier === 'banter') {
      if (kind === 'bullying' && cfg.bullying.banterReducibleCues.includes(ev.cue)) {
        factor *= cfg.reductions.banter;
        notes.push(`×${cfg.reductions.banter} mutual banter`);
      } else {
        notes.push('banter reading ignored for this cue');
      }
    }
    if (kind === 'grooming' && primed && cfg.grooming.sequenceRequests.includes(ev.cue)) {
      factor *= cfg.grooming.sequenceMultiplier;
      notes.unshift(`×${cfg.grooming.sequenceMultiplier}  (secrecy → request)`);
    }

    const add = w * factor;
    s += add;
    trace.push(`${ev.cue}  p=${fmtP(ev.p)}  +${fmt(w)}${notes.length ? ' ' + notes.join(' ') : ''}${factor !== 1 ? ` = +${fmt(add)}` : ''}`);
    points.push({ day: ev.day, score: s });
    const clean = ev.modifier === 'none' && ev.status === 'active';
    // Attribution: only unmodified evidence names someone as a sender of harm or a chat as a place it happened.
    // Banter, quotes and counterspeech still add their (reduced) weight but never make someone an "offender".
    if (ev.modifier === 'none') {
      cues.push({ cue: ev.cue, day: ev.day, conversationId: ev.conversationId, messageId: ev.messageId, senderId: ev.senderId, evidenceKey: ev.key });
      senders.add(ev.senderId);
      conversations.add(ev.conversationId);
    }
    if (kind === 'grooming') {
      const st = STAGE_OF[ev.cue];
      if (st && ev.modifier === 'none' && STAGE_RANK[st] > STAGE_RANK[stage]) {
        stage = st;
        trace.push(`stage → ${stage.replace('_', ' / ')}`);
      }
      if (cfg.grooming.sequencePrimers.includes(ev.cue) && ev.modifier === 'none') primed = true;
      if (clean) {
        const floor = cfg.grooming.floors[ev.cue as keyof EngineConfig['grooming']['floors']];
        if (floor) floors.push({ level: floor as Level, why: `${ev.cue.replace('_', ' / ')} → ≥ L${floor}` });
        if (contactId !== null && cfg.grooming.newContactRequestCues.includes(ev.cue)) {
          const first = input.firstSeen[contactId] ?? ev.day;
          if (ev.day - first < cfg.grooming.newContactDays) {
            floors.push({ level: cfg.grooming.newContactRequestFloor as Level, why: `request from contact < ${cfg.grooming.newContactDays}d → ≥ L${cfg.grooming.newContactRequestFloor}` });
          }
        }
      }
    } else {
      if (clean) {
        const floor = cfg.bullying.floors[ev.cue as keyof EngineConfig['bullying']['floors']];
        if (floor) floors.push({ level: floor as Level, why: `${ev.cue} → ≥ L${floor}` });
        // Aggregation bonuses: only clean, active events within the window count.
        window.push(ev);
        const inWin = window.filter((e) => e.day > ev.day - cfg.bullying.windowDays);
        const winSenders = new Set(inWin.map((e) => e.senderId));
        const winConvs = new Set(inWin.map((e) => e.conversationId));
        const sameSender = inWin.filter((e) => e.senderId === ev.senderId).length;
        if (!awarded.pileOn && winSenders.size >= cfg.bullying.pileOnSenders) {
          awarded.pileOn = true;
          s += cfg.bullying.pileOnBonus;
          trace.push(`pile-on: ${winSenders.size} senders within ${cfg.bullying.windowDays}d  +${fmt(cfg.bullying.pileOnBonus)}`);
        }
        if (!awarded.crossChat && winConvs.size >= cfg.bullying.crossChatConversations) {
          awarded.crossChat = true;
          s += cfg.bullying.crossChatBonus;
          trace.push(`cross-chat: targeted in ${winConvs.size} conversations within ${cfg.bullying.windowDays}d  +${fmt(cfg.bullying.crossChatBonus)}`);
        }
        if (!awarded.repeat.has(ev.senderId) && sameSender >= cfg.bullying.repeatSameSender) {
          awarded.repeat.add(ev.senderId);
          s += cfg.bullying.repeatBonus;
          trace.push(`repeated: ${sameSender} cues from ${name(ev.senderId)} within ${cfg.bullying.windowDays}d  +${fmt(cfg.bullying.repeatBonus)}`);
        }
        points[points.length - 1] = { day: ev.day, score: s };
      }
    }
  }

  // Bring the score to the evaluation day.
  if (last !== null && input.evalDay > last && s > 0) {
    const before = s;
    s = decay(s, input.evalDay - last, H);
    trace.push(`decay ${fmt(before)} → ${fmt(s)}  (to Day ${input.evalDay})`);
  }

  if (dismissalFloor) floors.push({ level: 1, why: 'dismissed nudge · never below L1' });
  const scoreLevel = levelForScore(s, cfg);
  const floorLevel = floors.reduce<Level>((m, f) => (f.level > m ? f.level : m), 0);
  for (const f of floors) trace.push(`floor: ${f.why}`);
  let level = (Math.max(scoreLevel, floorLevel) as Level);
  // Plan.md §2.2: bullying goes to parent + counsellor; it only escalates to critical when a threat is involved.
  if (kind === 'bullying' && level > cfg.bullying.maxLevelWithoutThreat && !events.some((e) => e.cue === 'intimidation' && e.modifier === 'none' && e.status === 'active' && e.p >= cfg.cueThreshold)) {
    level = cfg.bullying.maxLevelWithoutThreat as Level;
    trace.push(`bullying without threats capped at L${level} (parent + counsellor route)`);
  }
  const label = ['logged', 'L1 child nudge', 'L2 guardian alert', 'L3 critical'][level];
  trace.push(`score ${fmt(s)}${scoreLevel < level ? ` (floor raises to L${level})` : ''} → ${label}`);

  // Linked contacts: flagged for review only. Different accounts are never merged on similarity alone.
  let linkCandidate: TrackState['linkCandidate'] = null;
  if (kind === 'grooming' && contactId !== null) {
    const first = input.firstSeen[contactId];
    const block = (input.blocks ?? []).find((b) => b.contactId !== contactId && first !== undefined && first >= b.day && first - b.day <= cfg.linkedContacts.windowDays);
    if (block) {
      linkCandidate = { fromContactId: block.contactId, reason: `first seen within ${cfg.linkedContacts.windowDays}d of blocking ${name(block.contactId)}` };
      trace.push(`possible linked contact (${linkCandidate.reason}) · pending review, not merged`);
    }
  }

  return {
    key,
    kind,
    contactId,
    score: s,
    scoreLevel,
    floorLevel,
    level,
    stage,
    floors: floors.map((f) => f.why),
    cues,
    senders: [...senders],
    conversations: [...conversations],
    dismissals,
    linkCandidate,
    trace,
    points,
  };
}

/** Compute the child's risk state from the evidence set. Pure and deterministic. */
export function computeRisk(input: EngineInput): RiskState {
  const cfg = input.config ?? DEFAULT_CONFIG;
  const live = input.evidence.filter(
    (e) => (e.status === 'active' || e.status === 'needs_review') && input.evalDay - e.day <= cfg.retentionDays && e.day <= input.evalDay,
  );

  const otherTargets: RiskState['otherTargets'] = [];
  const grooming = new Map<string, EvidenceEvent[]>();
  const bullying: EvidenceEvent[] = [];

  for (const e of live) {
    if (e.senderId === input.childId) continue; // the child's own messages never raise the child's case
    const category = CUE_CATEGORY[e.cue] ?? e.category;
    if (category === 'bullying') {
      if (e.targetId === input.childId) bullying.push(e);
      else otherTargets.push({ evidenceKey: e.key, targetId: e.targetId, cue: e.cue });
    } else {
      if (e.targetId !== null && e.targetId !== input.childId) {
        otherTargets.push({ evidenceKey: e.key, targetId: e.targetId, cue: e.cue });
        continue;
      }
      const list = grooming.get(e.senderId) ?? [];
      list.push(e);
      grooming.set(e.senderId, list);
    }
  }

  const tracks: TrackState[] = [];
  for (const [contactId, evs] of grooming) tracks.push(scoreTrack(`grooming:${contactId}`, 'grooming', contactId, evs, input, cfg));
  if (bullying.length) tracks.push(scoreTrack('bullying', 'bullying', null, bullying, input, cfg));

  tracks.sort((a, b) => b.level - a.level || b.score - a.score || a.key.localeCompare(b.key));
  const top = tracks[0];
  return {
    evalDay: input.evalDay,
    score: top?.score ?? 0,
    level: top?.level ?? 0,
    stage: top?.kind === 'grooming' ? top.stage : 'rapport',
    category: top ? top.kind : 'none',
    dominantTrack: top?.key ?? null,
    tracks,
    otherTargets,
    trace: top ? top.trace : ['no active evidence · monitoring'],
  };
}

/**
 * Alert de-duplication. A track alerts only when its level rises above the highest level already alerted
 * for it, so re-analysis of unchanged evidence (or decay and re-growth to the same level) never re-fires.
 */
export function decideAlerts(risk: RiskState, alerted: Record<string, number>): { fire: TrackState[]; next: Record<string, number> } {
  const next = { ...alerted };
  const fire: TrackState[] = [];
  for (const t of risk.tracks) {
    if (t.level >= 1 && t.level > (alerted[t.key] ?? 0)) {
      fire.push(t);
      next[t.key] = t.level;
    }
  }
  fire.sort((a, b) => b.level - a.level);
  return { fire, next };
}

const CUE_LABEL: Record<CueId, string> = {
  flattery_age: 'flattery / age',
  secrecy: 'secrecy',
  isolation: 'isolation',
  platform_move: 'platform move',
  manipulation: 'manipulation',
  personal_info_request: 'personal-info request',
  image_request: 'image request',
  meeting_request: 'meeting request',
  disable_protection: 'disable protection',
  threat_payment: 'threat / coercion',
  insult_harassment: 'insult / harassment',
  humiliation: 'humiliation',
  exclusion: 'exclusion',
  intimidation: 'intimidation',
};

/**
 * Response policy: the only text that reaches the guardian. Cue types, counts and days; never message text.
 * Wording describes a potential safeguarding concern, never a proven offence.
 */
export function guardianSummary(t: TrackState, childName: string, contactLabel: (id: string) => string): { title: string; body: string } {
  const span = t.cues.length ? Math.max(...t.cues.map((c) => c.day)) - Math.min(...t.cues.map((c) => c.day)) + 1 : 0;
  const days = `${span} day${span === 1 ? '' : 's'}`;
  const n = t.cues.length;
  if (t.kind === 'bullying') {
    const people = t.senders.length;
    const chats = t.conversations.length;
    const hasThreat = t.cues.some((c) => c.cue === 'intimidation');
    if (t.level === 1) return { title: 'Unkind messages noticed', body: `${childName} was gently nudged. No guardian alert is sent at Level 1.` };
    return {
      title: hasThreat ? 'Intimidation towards ' + childName : people > 1 ? `${childName} targeted by ${people} people` : `Repeated bullying of ${childName}`,
      body: `${n} bullying cue${n === 1 ? '' : 's'} from ${people} ${people === 1 ? 'person' : 'people'} across ${chats} chat${chats === 1 ? '' : 's'} over ${days}. Suggested: talk with ${childName}; consider looping in the school counsellor.`,
    };
  }
  const who = t.contactId ? contactLabel(t.contactId) : 'a contact';
  const kinds = [...new Set(t.cues.map((c) => CUE_LABEL[c.cue]))].slice(0, 3).join(', ');
  if (t.level === 1) return { title: `${CUE_LABEL[t.cues[t.cues.length - 1]?.cue ?? 'secrecy']} cue · ${who}`, body: `${childName} was gently nudged. No guardian alert is sent at Level 1.` };
  if (t.level === 3)
    return {
      title: t.stage === 'coercion' ? 'Threat / coercion detected' : 'Critical safeguarding concern',
      body: `Potential grooming pattern from ${who}: ${n} cues over ${days} (${kinds}). Model-detected, needs your review. A guided report is ready.`,
    };
  return {
    title: 'Potential grooming pattern',
    body: `${n} warning cue${n === 1 ? '' : 's'} over ${days} from ${who} (${kinds}). Stage: ${t.stage.replace('_', ' / ')}. Tap to review.`,
  };
}

export { CUE_LABEL };
