// Bridge between real model runs and the existing UI: evidence → deterministic engine → Analysis / AlertItem.
// Nothing here invents a verdict: cues come from validated evidence, scores and levels from @rakshak/engine.

import { computeRisk, decideAlerts, guardianSummary, type RiskState, type TrackState } from '@rakshak/engine';
import type { AnalysisResult, EvidenceEvent } from '@rakshak/shared';
import type { AlertItem, Analysis, Backend, CueHit, Level, ParticipantView } from '../types';

export interface CaseInputs {
  childId: string;
  evidence: EvidenceEvent[];
  firstSeen: Record<string, number>;
  dismissals: { day: number; trackKey: string | null }[];
  blocks: { contactId: string; day: number }[];
  simDay: number;
  participants: ParticipantView[];
}

export function nameMap(participants: ParticipantView[]): Record<string, string> {
  return Object.fromEntries(participants.map((p) => [p.id, p.displayName]));
}

/** Evaluation day: the sim clock, but never earlier than the newest evidence. */
export function evalDay(c: CaseInputs) {
  return Math.max(c.simDay, ...c.evidence.map((e) => e.day), 1);
}

export function riskOf(c: CaseInputs): RiskState {
  return computeRisk({
    childId: c.childId,
    evidence: c.evidence,
    firstSeen: c.firstSeen,
    dismissals: c.dismissals,
    blocks: c.blocks,
    evalDay: evalDay(c),
    names: nameMap(c.participants),
  });
}

/** Per-message view of one run: the evidence attached to that message plus the case state after the run. */
export function analysisFor(messageId: string, run: AnalysisResult, evidence: EvidenceEvent[], risk: RiskState, backend: Backend): Analysis {
  const own = evidence.filter((e) => e.messageId === messageId && e.status !== 'superseded');
  const cues: CueHit[] = own.map((e) => ({ cue: e.cue, p: e.p, status: e.status, agreement: e.agreement, modifier: e.modifier, targetId: e.targetId }));
  // Fusion decisions that did not produce scored evidence (e.g. a suppressed RoBERTa flag) stay visible.
  for (const d of run.fusion.filter((f) => f.messageId === messageId)) {
    if (!cues.some((c) => c.cue === d.cue)) cues.push({ cue: d.cue, p: d.p, status: d.status, agreement: d.agreement });
  }
  const notes = run.fusion.filter((f) => f.messageId === messageId).map((f) => `fusion · ${f.cue}: ${f.agreement.replace('_', ' ')} — ${f.note}`);
  const rob = run.roberta.find((r) => r.messageId === messageId);
  const trace = [
    ...(rob ? [`RoBERTa  bullying=${rob.bullying.toFixed(2)}  (${rob.predicted.replace('_', '-')}, ${rob.latencyMs} ms)`] : []),
    ...(run.models.contextual ? [`${run.backend === 'local_hybrid' ? 'Qwen' : 'ChatGPT'}  ${run.assessment}${run.latency.contextualMs ? ` (${Math.round(run.latency.contextualMs)} ms)` : ''}`] : []),
    ...notes,
    ...(run.error ? [`error · ${run.error.code}: ${run.error.message}`] : []),
    ...risk.trace.slice(-6),
  ];
  return {
    cues,
    score: risk.score,
    level: risk.level,
    stage: risk.stage,
    category: risk.category,
    trace,
    latency: { [backend]: Math.round(run.latency.totalMs) },
    run,
  };
}

export function trackLabel(t: TrackState, names: Record<string, string>): string {
  if (t.kind === 'bullying') return `Bullying case · ${t.senders.length} sender${t.senders.length === 1 ? '' : 's'} · ${t.conversations.length} chat${t.conversations.length === 1 ? '' : 's'}`;
  return `Contact ${names[t.contactId ?? ''] ?? t.contactId}`;
}

/** Alerts the engine decided to fire for this risk state (de-duplicated against what was already alerted). */
export function alertsToFire(risk: RiskState, alerted: Record<string, number>, ctx: { day: number; time: string; childName: string; names: Record<string, string>; runId: string }) {
  const { fire, next } = decideAlerts(risk, alerted);
  const items: AlertItem[] = fire.map((t) => {
    const g = guardianSummary(t, ctx.childName, (id) => ctx.names[id] ?? id);
    return {
      id: `alert-${t.key}-L${t.level}-${ctx.runId}`,
      level: t.level as 1 | 2 | 3,
      day: ctx.day,
      time: ctx.time,
      stage: t.stage,
      score: t.score,
      contact: trackLabel(t, ctx.names),
      guardianTitle: g.title,
      guardianBody: g.body,
      cues: t.cues.map((c) => ({ cue: c.cue, day: c.day })),
      category: t.kind,
      trackKey: t.key,
    };
  });
  // Route the most severe last so it is the one left on screen.
  items.sort((a, b) => a.level - b.level);
  return { items, next };
}

export const levelOf = (n: number) => Math.max(0, Math.min(3, Math.round(n))) as Level;
