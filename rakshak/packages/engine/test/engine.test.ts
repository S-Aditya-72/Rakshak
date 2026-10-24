import { describe, expect, it } from 'vitest';
import type { CueId, EvidenceEvent, Modifier } from '@rakshak/shared';
import { CUE_CATEGORY } from '@rakshak/shared';
import { computeRisk, decideAlerts, guardianSummary, levelForScore } from '../src/index';

const CHILD = 'p-meera';
let seq = 0;

function ev(
  cue: CueId,
  day: number,
  opts: Partial<Pick<EvidenceEvent, 'p' | 'senderId' | 'targetId' | 'conversationId' | 'modifier' | 'status' | 'messageId'>> & { modifier?: Modifier } = {},
): EvidenceEvent {
  seq++;
  const senderId = opts.senderId ?? 'p-kabir';
  const conversationId = opts.conversationId ?? 'c-kabir';
  const messageId = opts.messageId ?? `m${seq}`;
  return {
    key: `local_hybrid|${conversationId}|${messageId}|${cue}|${opts.targetId ?? CHILD}`,
    childId: CHILD,
    backend: 'local_hybrid',
    conversationId,
    messageId,
    senderId,
    targetId: opts.targetId === undefined ? CHILD : opts.targetId,
    targetBasis: 'private_chat',
    cue,
    category: CUE_CATEGORY[cue],
    day,
    seq,
    p: opts.p ?? 0.9,
    modifier: opts.modifier ?? 'none',
    status: opts.status ?? 'active',
    agreement: 'agree',
    sources: ['qwen'],
    rationale: '',
    runId: 'r',
  };
}

const round = (n: number) => Math.round(n * 10) / 10;

describe('golden six-day scenario (fixed cue fixtures, Plan.md §2.5)', () => {
  // These are the proposal's hand-computed numbers. Fixtures, not model output.
  const day1 = ev('flattery_age', 1, { p: 0.91 });
  const day2 = ev('secrecy', 2, { p: 0.96 });
  const day4 = [ev('image_request', 4, { p: 0.94 }), ev('secrecy', 4, { p: 0.41 })];
  const day6 = ev('threat_payment', 6, { p: 0.98 });
  const base = { childId: CHILD, firstSeen: { 'p-kabir': 1 } };

  it('Day 1 → 1.0 (L0, rapport)', () => {
    const r = computeRisk({ ...base, evidence: [day1], evalDay: 1 });
    expect(round(r.score)).toBe(1.0);
    expect(r.level).toBe(0);
    expect(r.stage).toBe('rapport');
  });
  it('Day 2 → 2.9 (L1, secrecy/isolation)', () => {
    const r = computeRisk({ ...base, evidence: [day1, day2], evalDay: 2 });
    expect(round(r.score)).toBe(2.9);
    expect(r.level).toBe(1);
    expect(r.stage).toBe('secrecy_isolation');
  });
  it('Day 4 → 8.4 (L2, request; ×2 sequence; new-contact floor)', () => {
    const r = computeRisk({ ...base, evidence: [day1, day2, ...day4], evalDay: 4 });
    expect(round(r.score)).toBe(8.4);
    expect(r.level).toBe(2);
    expect(r.stage).toBe('request');
    expect(r.trace.some((t) => t.includes('×2'))).toBe(true);
    expect(r.trace.some((t) => t.includes('secrecy  p=0.41  below threshold'))).toBe(true);
    expect(r.tracks[0].floors.some((f) => f.includes('request from contact'))).toBe(true);
  });
  it('Day 6 → 10.9 (L3, coercion; threat floor)', () => {
    const r = computeRisk({ ...base, evidence: [day1, day2, ...day4, day6], evalDay: 6 });
    expect(round(r.score)).toBe(10.9);
    expect(r.level).toBe(3);
    expect(r.stage).toBe('coercion');
  });
});

describe('scoring rules', () => {
  const base = { childId: CHILD, firstSeen: { 'p-kabir': 1, 'p-dev': 1, 'p-arjun': 1, 'p-sana': 1, 'p-kiran': 1 } };

  it('decays with a 7-day half-life', () => {
    const r = computeRisk({ ...base, evidence: [ev('secrecy', 1)], evalDay: 8 });
    expect(r.score).toBeCloseTo(1.0, 5);
  });

  it('threat floor forces L3 even with a low score', () => {
    const r = computeRisk({ ...base, evidence: [ev('threat_payment', 1)], evalDay: 1 });
    expect(r.score).toBeCloseTo(4, 5);
    expect(r.level).toBe(3);
  });

  it('disable-protection floor forces L2', () => {
    expect(computeRisk({ ...base, evidence: [ev('disable_protection', 1)], evalDay: 1 }).level).toBe(2);
  });

  it('new-contact request floor only applies within 14 days of first contact', () => {
    const early = computeRisk({ ...base, firstSeen: { 'p-kabir': 1 }, evidence: [ev('meeting_request', 5)], evalDay: 5 });
    const late = computeRisk({ ...base, firstSeen: { 'p-kabir': 1 }, evidence: [ev('meeting_request', 20)], evalDay: 20 });
    expect(early.level).toBe(2);
    expect(late.level).toBe(1);
  });

  it('quotes and counterspeech are reduced ×0.3 and do not trigger floors', () => {
    const r = computeRisk({ ...base, evidence: [ev('threat_payment', 1, { modifier: 'quoted' })], evalDay: 1 });
    expect(r.score).toBeCloseTo(1.2, 5);
    expect(r.level).toBe(0);
  });

  it('banter reduces insults but never hides threats or grooming cues', () => {
    const insults = computeRisk({ ...base, evidence: [ev('insult_harassment', 1, { modifier: 'banter' }), ev('insult_harassment', 1, { modifier: 'banter' })], evalDay: 1 });
    expect(insults.level).toBe(0);
    const threat = computeRisk({ ...base, evidence: [ev('intimidation', 1, { modifier: 'banter' })], evalDay: 1 });
    expect(threat.score).toBeCloseTo(3, 5);
    expect(threat.level).toBe(1);
    const secrecy = computeRisk({ ...base, evidence: [ev('secrecy', 1, { modifier: 'banter' })], evalDay: 1 });
    expect(secrecy.score).toBeCloseTo(2, 5);
  });

  it('dismissal halves the score but never drops below L1, and is ignored at request stage', () => {
    const evs = [ev('secrecy', 1), ev('isolation', 1)];
    const r = computeRisk({ ...base, evidence: evs, dismissals: [{ day: 1, trackKey: null }], evalDay: 1 });
    expect(r.score).toBeCloseTo(2, 5);
    const later = computeRisk({ ...base, evidence: evs, dismissals: [{ day: 1, trackKey: null }], evalDay: 10 });
    expect(later.level).toBe(1);
    const req = computeRisk({ ...base, evidence: [ev('image_request', 1)], dismissals: [{ day: 1, trackKey: null }], evalDay: 1 });
    expect(req.score).toBeCloseTo(3, 5);
  });

  it('needs-review evidence counts at half weight and cannot set floors', () => {
    const r = computeRisk({ ...base, evidence: [ev('intimidation', 1, { status: 'needs_review' })], evalDay: 1 });
    expect(r.score).toBeCloseTo(1.5, 5);
    expect(r.level).toBe(0);
  });

  it('superseded and suppressed evidence is ignored', () => {
    const r = computeRisk({ ...base, evidence: [ev('threat_payment', 1, { status: 'superseded' }), ev('insult_harassment', 1, { status: 'suppressed' })], evalDay: 1 });
    expect(r.level).toBe(0);
    expect(r.tracks).toHaveLength(0);
  });

  it('bullying sums across senders and conversations, with pile-on and cross-chat bonuses', () => {
    const evs = [
      ev('insult_harassment', 1, { senderId: 'p-dev', conversationId: 'c-dev' }),
      ev('humiliation', 3, { senderId: 'p-arjun', conversationId: 'c-group' }),
      ev('humiliation', 3, { senderId: 'p-sana', conversationId: 'c-group' }),
      ev('exclusion', 3, { senderId: 'p-kiran', conversationId: 'c-group' }),
    ];
    const r = computeRisk({ ...base, evidence: evs, evalDay: 3 });
    const t = r.tracks.find((x) => x.key === 'bullying')!;
    expect(t.senders.sort()).toEqual(['p-arjun', 'p-dev', 'p-kiran', 'p-sana']);
    expect(t.conversations.sort()).toEqual(['c-dev', 'c-group']);
    expect(t.trace.some((l) => l.startsWith('pile-on'))).toBe(true);
    expect(t.trace.some((l) => l.startsWith('cross-chat'))).toBe(true);
    expect(r.category).toBe('bullying');
    expect(r.level).toBe(2);
  });

  it('bullying without a threat is capped at L2; with intimidation it may reach L3', () => {
    const many = ['p-dev', 'p-arjun', 'p-sana', 'p-kiran'].flatMap((s, i) => [ev('humiliation', 1, { senderId: s, conversationId: `c${i}` }), ev('insult_harassment', 1, { senderId: s, conversationId: `c${i}` })]);
    const capped = computeRisk({ ...base, evidence: many, evalDay: 1 });
    expect(capped.score).toBeGreaterThanOrEqual(9);
    expect(capped.level).toBe(2);
    const threat = computeRisk({ ...base, evidence: [...many, ev('intimidation', 1, { senderId: 'p-dev', conversationId: 'c0' })], evalDay: 1 });
    expect(threat.level).toBe(3);
  });

  it('bullying aimed at another participant is recorded but not counted for the protected child', () => {
    const r = computeRisk({ ...base, evidence: [ev('humiliation', 1, { senderId: 'p-arjun', targetId: 'p-riya' })], evalDay: 1 });
    expect(r.tracks).toHaveLength(0);
    expect(r.otherTargets).toHaveLength(1);
  });

  it("the child's own messages never raise the child's case", () => {
    const r = computeRisk({ ...base, evidence: [ev('insult_harassment', 1, { senderId: CHILD, targetId: 'p-riya' })], evalDay: 1 });
    expect(r.tracks).toHaveLength(0);
  });

  it('grooming tracks are separate per contact (no account linkage by assumption)', () => {
    const r = computeRisk({ ...base, evidence: [ev('secrecy', 1, { senderId: 'p-kabir' }), ev('secrecy', 1, { senderId: 'p-dev', conversationId: 'c-dev' })], evalDay: 1 });
    expect(r.tracks.map((t) => t.key).sort()).toEqual(['grooming:p-dev', 'grooming:p-kabir']);
    expect(r.score).toBeCloseTo(2, 5);
  });

  it('a new contact right after a block is flagged for review, not merged', () => {
    const r = computeRisk({
      ...base,
      firstSeen: { 'p-kabir': 1, 'p-new': 5 },
      evidence: [ev('secrecy', 1), ev('flattery_age', 5, { senderId: 'p-new', conversationId: 'c-new' })],
      blocks: [{ contactId: 'p-kabir', day: 4 }],
      evalDay: 5,
    });
    const t = r.tracks.find((x) => x.contactId === 'p-new')!;
    expect(t.linkCandidate?.fromContactId).toBe('p-kabir');
    expect(t.score).toBeCloseTo(1, 5);
  });

  it('is idempotent: duplicated evidence rows with the same key are counted once by the caller contract', () => {
    const e = ev('secrecy', 1);
    const once = computeRisk({ ...base, evidence: [e], evalDay: 1 });
    const again = computeRisk({ ...base, evidence: [e], evalDay: 1 });
    expect(again.score).toBe(once.score);
  });

  it('level thresholds are 2 / 5 / 9', () => {
    expect([1.9, 2, 4.9, 5, 8.9, 9].map((s) => levelForScore(s))).toEqual([0, 1, 1, 2, 2, 3]);
  });
});

describe('alert de-duplication', () => {
  it('fires once per level rise and never again for unchanged evidence', () => {
    const base = { childId: CHILD, firstSeen: { 'p-kabir': 1 } };
    const r1 = computeRisk({ ...base, evidence: [ev('secrecy', 1)], evalDay: 1 });
    const a1 = decideAlerts(r1, {});
    expect(a1.fire.map((t) => t.level)).toEqual([1]);
    const a2 = decideAlerts(r1, a1.next);
    expect(a2.fire).toHaveLength(0);
    const r2 = computeRisk({ ...base, evidence: [ev('secrecy', 1), ev('threat_payment', 2)], evalDay: 2 });
    expect(decideAlerts(r2, a1.next).fire.map((t) => t.level)).toEqual([3]);
  });

  it('guardian summary carries cue types and counts, never message text', () => {
    const r = computeRisk({ childId: CHILD, firstSeen: { 'p-kabir': 1 }, evidence: [ev('secrecy', 1), ev('image_request', 2)], evalDay: 2 });
    const s = guardianSummary(r.tracks[0], 'Meera', () => 'Kabir');
    expect(s.body).toContain('2 warning cues');
    expect(s.body).not.toMatch(/send me|photo/i);
  });
});
