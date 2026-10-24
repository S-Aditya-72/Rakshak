// Guardian evidence report: selection, redaction and export. Pure functions (report.test.ts).
//
// Guarantees:
// - Source evidence and messages are never modified; every function returns new objects.
// - The export document (ExportDoc) is the single source for both the on-screen preview and the downloaded files,
//   so what is downloaded is exactly what was reviewed.
// - A redacted export contains only redacted text: originals are not carried in the JSON or hidden in the HTML.
// - All text is HTML-escaped; the HTML has no scripts and a restrictive CSP.
// - Status is always "Not submitted". Nothing here contacts anyone.

import type { EvidenceEvent } from '@rakshak/shared';
import { CUE_META, LEVEL_META } from '../data/meta';
import type { AlertItem, ChatMessage, ConversationView, ParticipantView } from '../types';

export interface ReportItem {
  messageId: string;
  conversationId: string;
  conversationTitle: string;
  senderId: string;
  senderName: string;
  fromChild: boolean;
  day: number;
  time: string;
  text: string;
  findings: { cue: string; label: string; status: string; agreement: string; modifier: string; sources: string[]; strength: number; rationale: string; targetName: string | null }[];
}

/** Messages behind an alert, with the AI interpretations attached to each. Ordered as they happened. */
export function reportItems(alert: AlertItem, evidence: EvidenceEvent[], messages: ChatMessage[], participants: ParticipantView[], conversations: ConversationView[], childId: string): ReportItem[] {
  const keys = new Set(alert.evidenceKeys ?? []);
  const relevant = evidence.filter((e) => keys.has(e.key) || (!keys.size && alert.trackKey && trackMatches(alert.trackKey, e)));
  const names = Object.fromEntries(participants.map((p) => [p.id, p.displayName]));
  const titles = Object.fromEntries(conversations.map((c) => [c.id, c.title]));
  const byMsg = new Map<string, EvidenceEvent[]>();
  for (const e of relevant) byMsg.set(e.messageId, [...(byMsg.get(e.messageId) ?? []), e]);
  const order = messages.filter((m) => m.kind === 'msg').map((m) => m.id);
  return [...byMsg.entries()]
    .map(([messageId, evs]) => {
      const m = messages.find((x) => x.id === messageId);
      const e0 = evs[0];
      return {
        messageId,
        conversationId: e0.conversationId,
        conversationTitle: titles[e0.conversationId] ?? e0.conversationId,
        senderId: e0.senderId,
        senderName: names[e0.senderId] ?? e0.senderId,
        fromChild: e0.senderId === childId,
        day: m?.day ?? e0.day,
        time: m?.time ?? '',
        text: m?.text ?? '',
        findings: evs.map((e) => ({
          cue: e.cue,
          label: CUE_META[e.cue]?.label ?? e.cue,
          status: e.status,
          agreement: e.agreement,
          modifier: e.modifier,
          sources: [...e.sources],
          strength: e.p,
          rationale: e.rationale,
          targetName: e.targetId ? names[e.targetId] ?? e.targetId : null,
        })),
      };
    })
    .sort((a, b) => order.indexOf(a.messageId) - order.indexOf(b.messageId));
}

function trackMatches(trackKey: string, e: EvidenceEvent) {
  return trackKey === 'bullying' ? e.category === 'bullying' : e.category === 'grooming' && trackKey.endsWith(e.senderId);
}

// ---------- redaction ----------

export interface RedactionRule {
  /** Literal text to hide (case-insensitive), e.g. the child's name, handle, school or street. */
  term: string;
  replacement: string;
}

const PATTERNS: { name: string; re: RegExp; replacement: string }[] = [
  { name: 'email', re: /[\w.+-]+@[\w-]+(\.[\w-]+)+/g, replacement: '[email removed]' },
  { name: 'link', re: /\b(?:https?:\/\/|www\.)\S+/gi, replacement: '[link removed]' },
  { name: 'phone', re: /(?:\+?\d[\d\s-]{7,}\d)/g, replacement: '[phone removed]' },
  { name: 'handle', re: /(^|[^\w@])@[A-Za-z0-9_.]{2,}/g, replacement: '$1[handle removed]' },
];

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Default rules for a case: the child's display name and internal id map to the alias. */
export function defaultRules(childName: string, childId: string, alias: string, extra: string[] = []): RedactionRule[] {
  const rules: RedactionRule[] = [
    { term: childId, replacement: alias },
    { term: childName, replacement: alias },
    ...extra.filter((t) => t.trim().length >= 2).map((t) => ({ term: t.trim(), replacement: '[identifying detail removed]' })),
  ];
  return rules.filter((r) => r.term.trim().length > 0);
}

/** Redacts known identifiers (word-bounded, case-insensitive) and contact-detail patterns. Never mutates input. */
export function redactText(text: string, rules: RedactionRule[]): string {
  let out = text;
  // Whole contact details first (so a link or email containing the name goes as one unit), then known terms,
  // longest first so "Meera Iyer" is replaced before "Meera".
  for (const p of PATTERNS) out = out.replace(p.re, p.replacement);
  for (const r of [...rules].sort((a, b) => b.term.length - a.term.length)) {
    out = out.replace(new RegExp(`(^|[^\\p{L}\\p{N}_])${escapeRe(r.term)}(?=$|[^\\p{L}\\p{N}_])`, 'giu'), `$1${r.replacement}`);
  }
  return out;
}

// ---------- export document ----------

export interface ExportEntry {
  ref: string;
  messageId: string;
  conversationId: string;
  conversation: string;
  account: string;
  accountId: string;
  when: string;
  excerpt: string;
  aiInterpretation: { cue: string; status: string; agreement: string; modifier: string; models: string[]; strength: number; note: string }[];
}

export interface ExportDoc {
  reportId: string;
  createdAt: string;
  status: 'Not submitted';
  designation: string;
  protectedPerson: string;
  redacted: boolean;
  summary: string;
  assessment: { level: string; score: number; category: string; basis: string };
  timeline: ExportEntry[];
  reportedAccounts: { accountId: string; displayed: string; suspectedBehaviour: string[] }[];
  provenance: { backend: string; models: string[]; caseRef: string };
  notes: string;
  disclaimers: string[];
}

export const DISCLAIMERS = [
  'SYNTHETIC DEMONSTRATION DATA. Prepared by the RAKSHAK prototype from simulated conversations. Not a real incident.',
  'Status: Not submitted. RAKSHAK does not send this report to anyone; any complaint is made by a person through an official channel.',
  'AI interpretations are model output that can be wrong. They are not a legal determination and do not establish that any offence occurred.',
  'Accounts are listed as "reported accounts" with "suspected behaviour". RAKSHAK does not verify who controls an account or whether two accounts belong to one person.',
  'Times are simulated demo days, not real timestamps. This file is not certified evidence; keep the original messages and screenshots on the device.',
  'Automated redaction may be incomplete. Review every excerpt before sharing this file.',
];

export interface ExportOptions {
  reportId: string;
  createdAt: string;
  alert: AlertItem;
  items: ReportItem[];
  selected: Set<string>;
  /** Manual edits to the export text of an excerpt (original evidence is unchanged). */
  edits: Record<string, string>;
  redact: boolean;
  rules: RedactionRule[];
  alias: string;
  childName: string;
  childId: string;
  summary: string;
  notes: string;
  backendLabel: string;
  models: string[];
  caseKey: string;
}

export function newReportId(now = new Date()) {
  const d = now.toISOString().slice(0, 10).replace(/-/g, '');
  return `RKS-${d}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

export function buildExport(o: ExportOptions): ExportDoc {
  const clean = (s: string) => (o.redact ? redactText(s, o.rules) : s);
  const id = (pid: string) => (o.redact && pid === o.childId ? o.alias : pid);
  const chosen = o.items.filter((i) => o.selected.has(i.messageId));
  const timeline: ExportEntry[] = chosen.map((i, n) => ({
    ref: `E${n + 1}`,
    messageId: i.messageId,
    conversationId: i.conversationId,
    conversation: clean(i.conversationTitle),
    account: i.fromChild ? (o.redact ? o.alias : i.senderName) : i.senderName,
    accountId: id(i.senderId),
    when: `Simulated day ${i.day}${i.time ? `, ${i.time}` : ''} (synthetic demo time)`,
    excerpt: clean(o.edits[i.messageId] ?? i.text),
    aiInterpretation: i.findings.map((f) => ({
      cue: f.label,
      status: f.status.replace('_', ' '),
      agreement: f.agreement.replace('_', ' '),
      modifier: f.modifier,
      models: f.sources,
      strength: Math.round(f.strength * 100) / 100,
      note: clean(f.rationale),
    })),
  }));
  const accounts = new Map<string, { displayed: string; behaviours: Set<string> }>();
  for (const i of chosen) {
    if (i.fromChild) continue;
    const a = accounts.get(i.senderId) ?? { displayed: i.senderName, behaviours: new Set<string>() };
    i.findings.filter((f) => f.status === 'active' || f.status === 'needs_review').forEach((f) => a.behaviours.add(f.label));
    accounts.set(i.senderId, a);
  }
  return {
    reportId: o.reportId,
    createdAt: o.createdAt,
    status: 'Not submitted',
    designation: 'Synthetic demo · RAKSHAK prototype',
    protectedPerson: o.redact ? o.alias : o.childName,
    redacted: o.redact,
    summary: clean(o.summary),
    assessment: {
      level: `${LEVEL_META[o.alert.level].short} · ${LEVEL_META[o.alert.level].label}`,
      score: Math.round(o.alert.score * 10) / 10,
      category: o.alert.category ?? 'unknown',
      basis: 'Deterministic RAKSHAK engine score over the evidence below (prototype thresholds, not a validated probability).',
    },
    timeline,
    reportedAccounts: [...accounts.entries()].map(([accountId, a]) => ({ accountId, displayed: a.displayed, suspectedBehaviour: [...a.behaviours] })),
    provenance: { backend: o.backendLabel, models: o.models, caseRef: o.redact ? o.caseKey.replace(o.childId, o.alias) : o.caseKey },
    notes: clean(o.notes),
    disclaimers: DISCLAIMERS,
  };
}

export const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Printable, self-contained HTML. Every value is escaped; no scripts; nothing else is embedded. */
export function toHtml(doc: ExportDoc): string {
  const e = escapeHtml;
  const rows = doc.timeline
    .map(
      (t) => `<tr><td>${e(t.ref)}</td><td>${e(t.when)}</td><td>${e(t.conversation)}<br><small>${e(t.conversationId)}</small></td><td>${e(t.account)}<br><small>${e(t.accountId)}</small></td><td><blockquote>${e(t.excerpt)}</blockquote><small>message ${e(t.messageId)}</small></td><td>${t.aiInterpretation
        .map((f) => `<div><b>${e(f.cue)}</b> · ${e(f.status)} · ${e(f.agreement)}${f.modifier !== 'none' ? ` · ${e(f.modifier)}` : ''} · ${e(f.models.join(' + '))} · strength ${e(String(f.strength))}${f.note ? `<br><small>${e(f.note)}</small>` : ''}</div>`)
        .join('')}</td></tr>`,
    )
    .join('');
  const accounts = doc.reportedAccounts.map((a) => `<li>${e(a.displayed)} <small>(${e(a.accountId)})</small>: ${e(a.suspectedBehaviour.join(', ') || 'no active finding in the selected excerpts')}</li>`).join('');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>${e(doc.reportId)} · RAKSHAK evidence report (synthetic demo)</title>
<style>body{font:14px/1.5 system-ui,sans-serif;color:#111;max-width:980px;margin:24px auto;padding:0 16px}h1{font-size:20px}h2{font-size:15px;margin-top:22px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:6px;vertical-align:top;text-align:left}blockquote{margin:0;white-space:pre-wrap}small{color:#555}.banner{background:#fff3cd;border:1px solid #e0b400;padding:8px 10px;font-weight:600}.status{display:inline-block;border:1px solid #333;padding:2px 8px;font-weight:700}</style>
</head><body>
<div class="banner">${e(doc.designation)} · ${e(doc.disclaimers[0])}</div>
<h1>Evidence report ${e(doc.reportId)}</h1>
<p><span class="status">${e(doc.status)}</span> · created ${e(doc.createdAt)} · protected person: ${e(doc.protectedPerson)}${doc.redacted ? ' (alias; known identifiers redacted)' : ' (NOT redacted)'}</p>
<h2>Summary</h2><p>${e(doc.summary)}</p>
<h2>Deterministic risk assessment</h2><p>${e(doc.assessment.level)} · score ${e(String(doc.assessment.score))} · ${e(doc.assessment.category)}<br><small>${e(doc.assessment.basis)}</small></p>
<h2>Timeline of selected messages</h2>
<table><thead><tr><th>Ref</th><th>When</th><th>Conversation</th><th>Account</th><th>Recorded message (excerpt)</th><th>AI interpretation (model output, may be wrong)</th></tr></thead><tbody>${rows || '<tr><td colspan="6">No messages selected.</td></tr>'}</tbody></table>
<h2>Reported accounts</h2><ul>${accounts || '<li>None in the selected excerpts.</li>'}</ul>
<h2>Analysis provenance</h2><p>Backend: ${e(doc.provenance.backend)} · models: ${e(doc.provenance.models.join(', ') || 'unknown')} · case ${e(doc.provenance.caseRef)}</p>
${doc.notes ? `<h2>Guardian notes</h2><p>${e(doc.notes)}</p>` : ''}
<h2>Important</h2><ul>${doc.disclaimers.map((d) => `<li>${e(d)}</li>`).join('')}</ul>
</body></html>`;
}

export const toJson = (doc: ExportDoc) => JSON.stringify(doc, null, 2);

/** Saves a file locally through the browser (no network, no third-party service). */
export function download(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
