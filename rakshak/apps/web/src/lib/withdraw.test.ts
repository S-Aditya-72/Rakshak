import { computeRisk } from '@rakshak/engine';
import type { EvidenceEvent } from '@rakshak/shared';
import { describe, expect, it } from 'vitest';
import type { AlertItem } from '../types';
import { alertsToFire, alertsToWithdraw } from './case';

const CHILD = 'p-meera';
const ev = (key: string, status: EvidenceEvent['status'], day = 1): EvidenceEvent => ({
  key, childId: CHILD, backend: 'local_hybrid', conversationId: 'c-kabir', messageId: `m-${key}`, senderId: 'p-kabir', targetId: CHILD,
  targetBasis: 'model', cue: 'image_request', category: 'grooming', day, seq: 1, p: 0.9, modifier: 'none', status, agreement: 'contextual_only',
  sources: ['qwen'], rationale: '', runId: 'r',
} as EvidenceEvent);
const risk = (evidence: EvidenceEvent[], evalDay = 1) => computeRisk({ childId: CHILD, evidence, firstSeen: { 'p-kabir': 1 }, evalDay });
const ctx = { day: 1, time: 't', childName: 'Meera', names: {}, runId: 'r1' };

function firedAlert(): AlertItem {
  const r = risk([ev('k1', 'active')]);
  const { items } = alertsToFire(r, {}, ctx);
  expect(items).toHaveLength(1);
  return { ...items[0], evidenceKeys: r.tracks[0].cues.map((c) => c.evidenceKey) };
}

describe('confirmation and withdrawal', () => {
  it('pending evidence never fires an alert', () => {
    expect(alertsToFire(risk([ev('k1', 'needs_review')]), {}, ctx).items).toHaveLength(0);
  });

  it('withdraws an alert once its evidence is retracted', () => {
    const a = firedAlert();
    const after = [ev('k1', 'superseded')];
    expect(alertsToWithdraw([a], after, risk(after)).map((x) => x.id)).toEqual([a.id]);
  });

  it('does not withdraw while the evidence is still confirmed', () => {
    const a = firedAlert();
    const same = [ev('k1', 'active')];
    expect(alertsToWithdraw([a], same, risk(same))).toHaveLength(0);
  });

  it('does not withdraw on decay or a demotion alone (nothing was retracted)', () => {
    const a = firedAlert();
    const pendingOnly = [ev('k1', 'needs_review')];
    expect(alertsToWithdraw([a], pendingOnly, risk(pendingOnly))).toHaveLength(0);
    const old = [ev('k1', 'active', 1)];
    expect(alertsToWithdraw([a], old, risk(old, 60))).toHaveLength(0);
  });

  it('never withdraws twice or touches previews', () => {
    const a = firedAlert();
    const after = [ev('k1', 'superseded')];
    expect(alertsToWithdraw([{ ...a, withdrawn: true }, { ...a, id: 'p', preview: true }], after, risk(after))).toHaveLength(0);
  });

  it('restored alerts without stored evidence keys fall back to the track', () => {
    const a = { ...firedAlert(), evidenceKeys: [] };
    const after = [ev('k1', 'superseded')];
    expect(alertsToWithdraw([a], after, risk(after))).toHaveLength(1);
  });
});
