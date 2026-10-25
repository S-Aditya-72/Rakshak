import type { EvidenceEvent } from '@rakshak/shared';
import { describe, expect, it } from 'vitest';
import type { AlertItem, ChatMessage, ConversationView, ParticipantView } from '../types';
import { buildExport, defaultRules, escapeHtml, redactText, reportItems, toHtml, toJson, type ExportOptions } from './report';

const CHILD = 'p-meera';
const participants: ParticipantView[] = [
  { id: CHILD, displayName: 'Meera', role: 'protected_child' },
  { id: 'p-dev', displayName: 'Dev', role: 'peer' },
];
const conversations: ConversationView[] = [{ id: 'c1', kind: 'private', title: 'Dev', participantIds: [CHILD, 'p-dev'] }];
const messages: ChatMessage[] = [
  { id: 'm1', kind: 'msg', conversationId: 'c1', senderId: 'p-dev', text: 'Meera everyone laughed at you. call me 98765 43210 <script>alert(1)</script>', day: 1, time: '4:00 PM' },
  { id: 'm2', kind: 'msg', conversationId: 'c1', senderId: CHILD, text: 'please stop, my email is meera@example.com', day: 2, time: '5:00 PM' },
  { id: 'm3', kind: 'msg', conversationId: 'c1', senderId: 'p-dev', text: 'see you at Lakeview tomorrow meera, https://x.example/meera', day: 3, time: '6:00 PM' },
];
const ev = (key: string, messageId: string, senderId: string, cue: EvidenceEvent['cue'], extra: Partial<EvidenceEvent> = {}): EvidenceEvent => ({
  key,
  childId: CHILD,
  backend: 'local_hybrid',
  conversationId: 'c1',
  messageId,
  senderId,
  targetId: CHILD,
  targetBasis: 'private_chat',
  cue,
  category: 'bullying',
  day: 1,
  seq: 1,
  p: 0.9,
  modifier: 'none',
  status: 'active',
  agreement: 'agree',
  sources: ['qwen', 'roberta'],
  rationale: 'targets Meera directly',
  runId: 'run-1',
  ...extra,
});
const evidence = [ev('k1', 'm1', 'p-dev', 'humiliation'), ev('k2', 'm2', CHILD, 'insult_harassment', { modifier: 'counterspeech', status: 'needs_review' }), ev('k3', 'm3', 'p-dev', 'intimidation')];
const alert: AlertItem = { id: 'a1', level: 2, day: 3, time: '6:00 PM', stage: 'rapport', score: 7.4, contact: 'x', guardianTitle: 't', guardianBody: 'b', cues: [], category: 'bullying', trackKey: 'bullying', caseKey: `${CHILD}#3`, childName: 'Meera', evidenceKeys: ['k1', 'k2', 'k3'] };

function opts(over: Partial<ExportOptions> = {}): ExportOptions {
  const items = reportItems(alert, evidence, messages, participants, conversations, CHILD);
  return {
    reportId: 'RKS-TEST',
    createdAt: '2026-10-24T10:00:00Z',
    alert,
    items,
    selected: new Set(items.map((i) => i.messageId)),
    edits: {},
    redact: true,
    rules: defaultRules('Meera', CHILD, 'the child', ['Lakeview']),
    alias: 'the child',
    childName: 'Meera',
    childId: CHILD,
    summary: 'Meera was targeted by Dev over three days.',
    notes: '',
    backendLabel: 'RAKSHAK Hybrid (local)',
    models: ['qwen3.5:4b'],
    caseKey: `${CHILD}#3`,
    ...over,
  };
}

describe('report items', () => {
  it('lists the alert evidence in message order with attribution to the real sender', () => {
    const items = reportItems(alert, evidence, messages, participants, conversations, CHILD);
    expect(items.map((i) => i.messageId)).toEqual(['m1', 'm2', 'm3']);
    expect(items[1]).toMatchObject({ fromChild: true, senderId: CHILD });
    expect(items[1].findings[0]).toMatchObject({ modifier: 'counterspeech', status: 'needs_review' });
  });
});

describe('redaction', () => {
  it('removes the child name, school, phone, email and links but keeps the reported account', () => {
    const out = redactText('Meera at Lakeview, call 98765 43210 or meera@example.com, see https://x.example/meera @meera_x — from Dev', defaultRules('Meera', CHILD, 'the child', ['Lakeview']));
    expect(out).not.toMatch(/meera/i);
    expect(out).not.toMatch(/lakeview/i);
    expect(out).not.toContain('98765');
    expect(out).toContain('[email removed]');
    expect(out).toContain('[link removed]');
    expect(out).toContain('[handle removed]');
    expect(out).toContain('Dev');
  });
  it('does not touch words that only contain the name', () => {
    expect(redactText('Meeraj said hi', defaultRules('Meera', CHILD, 'the child'))).toBe('Meeraj said hi');
  });
});

describe('export', () => {
  it('redacted JSON and HTML carry no original identifiers and source evidence is unchanged', () => {
    const before = JSON.stringify({ evidence, messages });
    const doc = buildExport(opts());
    const json = toJson(doc);
    const html = toHtml(doc);
    for (const s of [json, html]) {
      expect(s).not.toMatch(/meera/i);
      expect(s).not.toMatch(/lakeview/i);
      expect(s).not.toContain('98765');
    }
    expect(JSON.stringify({ evidence, messages })).toBe(before);
    expect(doc.status).toBe('Not submitted');
    expect(doc.timeline[1].accountId).toBe('the child');
    expect(doc.reportedAccounts).toEqual([{ accountId: 'p-dev', displayed: 'Dev', suspectedBehaviour: ['Humiliation', 'Intimidation'] }]);
    expect(doc.disclaimers.join(' ')).toMatch(/not a legal determination/i);
  });

  it('labels a case-study reconstruction as reconstructed dialogue, not authentic evidence', () => {
    const plain = buildExport(opts());
    const doc = buildExport(opts({ reconstruction: true }));
    expect(plain.disclaimers[0]).toMatch(/not a real incident/i);
    expect(doc.designation).toMatch(/fictional reconstruction/i);
    expect(doc.disclaimers[0]).toMatch(/not authentic evidence/i);
    expect(doc.disclaimers.join(' ')).not.toMatch(/not a real incident/i);
    expect(toHtml(doc)).toContain('RECONSTRUCTED DIALOGUE, NOT AUTHENTIC EVIDENCE');
    expect(doc.disclaimers.slice(1)).toEqual(plain.disclaimers.slice(1));
  });

  it('escapes message text so it cannot inject markup', () => {
    const html = toHtml(buildExport(opts()));
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toMatch(/Content-Security-Policy/);
    expect(escapeHtml(`"'<>&`)).toBe('&quot;&#39;&lt;&gt;&amp;');
  });

  it('exports only selected messages and applies manual edits to the export copy only', () => {
    const doc = buildExport(opts({ selected: new Set(['m3']), edits: { m3: 'see you tomorrow (edited by guardian)' } }));
    expect(doc.timeline.map((t) => t.messageId)).toEqual(['m3']);
    expect(doc.timeline[0].excerpt).toBe('see you tomorrow (edited by guardian)');
    expect(messages[2].text).toContain('Lakeview');
  });

  it('the downloaded HTML is generated from the same document as the preview', () => {
    const doc = buildExport(opts());
    expect(toHtml(doc)).toBe(toHtml(JSON.parse(toJson(doc))));
  });
});
