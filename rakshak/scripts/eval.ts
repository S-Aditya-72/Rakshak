// RAKSHAK evaluation harness. Runs every scenario + eval fixture through the REAL inference service and the
// deterministic engine, then compares the outcome with each file's `expect` block (never shown to the models).
//
//   npm run eval                          # local hybrid (RoBERTa + Qwen3.5 4B)
//   npm run eval -- --only s2-bullying    # one case
//   npm run eval -- --chatgpt <model>     # also run ChatGPT (owner-run; requires sign-in in the UI first)
//
// Writes eval/reports/<timestamp>.{json,md} and eval/reports/latest.{json,md}.
// Results describe these synthetic cases only; they are not a measure of real-world accuracy.

import { computeRisk, decideAlerts, type RiskState } from '@rakshak/engine';
import type { AnalysisResult, EvidenceEvent } from '@rakshak/shared';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const API = process.env.RAKSHAK_API ?? 'http://127.0.0.1:8787';
const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
const chatgptModel = args.includes('--chatgpt') ? args[args.indexOf('--chatgpt') + 1] : null;

interface Expect {
  level: [number, number];
  categories: string[];
  target: string | null;
  offenders: string[];
  nonOffenders: string[];
  mustNotAlert: boolean;
  conversationsWithEvidence?: string[];
  /** Cues that must appear in clean (unmodified, active/needs-review) evidence from a non-child sender. */
  requiredCues?: string[];
  notes?: string;
}
interface ScenarioFile {
  id: string;
  title: string;
  child: { id: string; name: string };
  participants: { id: string; name: string }[];
  messages: { conv: string; from: string; day: number; time: string; text: string }[];
  expect: Expect;
}

async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await fetch(`${API}/api${path}`, { method, headers: body ? { 'content-type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json();
  if (!r.ok) throw new Error(`${r.status} ${JSON.stringify(j).slice(0, 200)}`);
  return j as T;
}

function loadScenarios(): ScenarioFile[] {
  const files = [
    ...readdirSync(join(ROOT, 'scenarios')).filter((f) => f.endsWith('.json')).map((f) => join(ROOT, 'scenarios', f)),
    ...readdirSync(join(ROOT, 'scenarios', 'eval')).filter((f) => f.endsWith('.json')).map((f) => join(ROOT, 'scenarios', 'eval', f)),
  ];
  return files.map((f) => JSON.parse(readFileSync(f, 'utf8'))).filter((s) => !only || s.id === only);
}

const pct = (xs: number[], p: number) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor((p / 100) * xs.length))] : null);

async function runCase(sc: ScenarioFile, backend: 'local_hybrid' | 'chatgpt_cloud') {
  const child = sc.child.id;
  await api('POST', `/scenarios/${sc.id}/load`);
  const runs: AnalysisResult[] = [];
  const errors: string[] = [];
  let evidence: EvidenceEvent[] = [];
  let firstSeen: Record<string, number> = {};
  let alerted: Record<string, number> = {};
  const alerts: { level: number; track: string; atMessage: number }[] = [];
  const timeline: { msg: number; score: number; level: number }[] = [];
  let risk: RiskState | null = null;
  const ids: string[] = [];

  const apply = (res: { result: AnalysisResult; evidence: EvidenceEvent[] | null; firstSeen: Record<string, number> | null }, i: number, day: number) => {
    runs.push(res.result);
    if (res.result.error && res.result.error.code !== 'stale') errors.push(`${res.result.error.code}: ${res.result.error.message}`);
    if (!res.evidence) return;
    evidence = res.evidence;
    firstSeen = res.firstSeen ?? firstSeen;
    risk = computeRisk({ childId: child, evidence, firstSeen, evalDay: day });
    const d = decideAlerts(risk, alerted);
    alerted = d.next;
    for (const t of d.fire) alerts.push({ level: t.level, track: t.key, atMessage: i + 1 });
    timeline.push({ msg: i + 1, score: Number(risk.score.toFixed(2)), level: risk.level });
  };

  for (const [i, m] of sc.messages.entries()) {
    const id = `${sc.id}-m${String(i + 1).padStart(2, '0')}`;
    ids.push(id);
    await api('POST', '/messages', { id, conversationId: m.conv, senderId: m.from, day: m.day, time: m.time, text: m.text });
    if (backend === 'local_hybrid' && m.from !== child) {
      apply(await api('POST', '/analyze', { backend, conversationId: m.conv, uptoMessageId: id, requestId: `eval-${id}`, trigger: 'auto' }), i, m.day);
    }
  }
  if (backend === 'chatgpt_cloud') {
    // Owner-run: one explicit analysis per conversation at the end.
    const lastDay = sc.messages[sc.messages.length - 1].day;
    for (const conv of [...new Set(sc.messages.map((m) => m.conv))]) {
      apply(await api('POST', '/analyze', { backend, conversationId: conv, requestId: `eval-cg-${conv}`, trigger: 'owner_button', model: chatgptModel }), sc.messages.length - 1, lastDay);
    }
  }
  return { runs, errors, evidence, risk: risk as RiskState | null, alerts, timeline, ids };
}

function score(sc: ScenarioFile, out: Awaited<ReturnType<typeof runCase>>) {
  const e = sc.expect;
  const risk = out.risk;
  const level = risk?.level ?? 0;
  // Offenders = senders the engine attributes harm to (unmodified evidence only; banter/quotes never attribute).
  const tracks = risk?.tracks ?? [];
  const offenders = new Set(tracks.flatMap((t) => (t.kind === 'bullying' ? t.senders : t.contactId && t.cues.length ? [t.contactId] : [])));
  const categories = [...new Set(tracks.filter((t) => t.level >= 1).map((t) => t.kind))];
  const msgIds = new Set(out.ids);
  const scored = out.evidence.filter((x) => x.status === 'active' || x.status === 'needs_review');
  const invalidRefs = out.evidence.filter((x) => !msgIds.has(x.messageId)).length;
  const dominant = risk?.tracks[0];
  const targetOk = e.target === null ? !dominant || dominant.level === 0 : scored.filter((x) => x.senderId !== sc.child.id).some((x) => x.targetId === e.target);
  const fpOffenders = e.nonOffenders.filter((p) => offenders.has(p));
  const fnOffenders = e.offenders.filter((p) => !offenders.has(p));
  const levelOk = level >= e.level[0] && level <= e.level[1];
  const alerted = out.alerts.length > 0;
  const lat = out.runs.filter((r) => !r.stale);
  return {
    id: sc.id,
    title: sc.title,
    level,
    score: Number((risk?.score ?? 0).toFixed(2)),
    expectedLevel: e.level,
    levelOk,
    falsePositive: (e.mustNotAlert && alerted) || level > e.level[1],
    falseNegative: level < e.level[0],
    categories,
    categoriesOk: e.categories.every((c) => categories.includes(c as 'bullying' | 'grooming')) && (e.categories.length > 0 || categories.length === 0),
    targetOk,
    offenders: [...offenders],
    falsePositiveOffenders: fpOffenders,
    missedOffenders: fnOffenders,
    requiredCuesOk: e.requiredCues ? e.requiredCues.every((c) => scored.some((x) => x.cue === c && x.modifier === 'none' && x.senderId !== sc.child.id)) : null,
    conversationsOk: e.conversationsWithEvidence ? e.conversationsWithEvidence.every((c) => scored.some((x) => x.conversationId === c && x.senderId !== sc.child.id)) : null,
    evidence: scored.length,
    invalidEvidenceRefs: invalidRefs,
    disagreements: scored.filter((x) => x.agreement === 'needs_review').length,
    contextOverrides: out.runs.flatMap((r) => r.fusion).filter((f) => f.agreement === 'context_override').length,
    verifierRejections: out.runs.flatMap((r) => r.warnings).filter((w) => w.startsWith('verifier rejected')).length,
    validationWarnings: out.runs.flatMap((r) => r.warnings).filter((w) => !w.startsWith('verifier') && !w.startsWith('context:')).length,
    alerts: out.alerts,
    timeline: out.timeline,
    errors: out.errors,
    latencyMs: {
      runs: lat.length,
      p50: pct(lat.map((r) => r.latency.totalMs), 50),
      p95: pct(lat.map((r) => r.latency.totalMs), 95),
      max: lat.length ? Math.max(...lat.map((r) => r.latency.totalMs)) : null,
      robertaP50: pct(lat.flatMap((r) => (r.latency.robertaMs != null ? [r.latency.robertaMs] : [])), 50),
      contextualP50: pct(lat.flatMap((r) => (r.latency.contextualMs != null ? [r.latency.contextualMs] : [])), 50),
    },
  };
}

async function main() {
  const health = await api<any>('GET', '/health').catch((e) => {
    throw new Error(`Inference service not reachable at ${API}: ${e.message}`);
  });
  const backends: ('local_hybrid' | 'chatgpt_cloud')[] = ['local_hybrid'];
  const skipped: { what: string; why: string }[] = [];
  const localReady = health.roberta.ready && health.qwen.reachable && health.qwen.modelPresent;
  if (!localReady) skipped.push({ what: 'local_hybrid (full)', why: `RoBERTa ready=${health.roberta.ready}, Ollama reachable=${health.qwen.reachable}, ${health.qwen.model} present=${health.qwen.modelPresent}. Runs are degraded.` });
  if (chatgptModel) {
    if (health.chatgpt.reachable && health.chatgpt.status === 'connected' && health.chatgpt.sharing) {
      await api('POST', '/chatgpt/consent', { accepted: true });
      backends.push('chatgpt_cloud');
    } else skipped.push({ what: 'chatgpt_cloud', why: `not available: ${health.chatgpt.reason ?? health.chatgpt.status}` });
  } else skipped.push({ what: 'chatgpt_cloud', why: 'not requested (owner must sign in and pass --chatgpt <model>)' });

  const results: Record<string, ReturnType<typeof score>[]> = {};
  for (const backend of backends) {
    results[backend] = [];
    for (const sc of loadScenarios()) {
      process.stdout.write(`${backend} · ${sc.id} … `);
      const t0 = Date.now();
      const out = await runCase(sc, backend);
      const r = score(sc, out);
      results[backend].push(r);
      console.log(`L${r.level} (expected L${r.expectedLevel.join('–')}) ${r.levelOk && r.requiredCuesOk !== false ? 'OK' : 'MISS'} · offenders ${r.offenders.join(',') || '-'} · ${Math.round((Date.now() - t0) / 1000)}s`);
    }
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const report = {
    generatedAt: new Date().toISOString(),
    environment: { roberta: health.roberta, qwen: health.qwen, chatgpt: { status: health.chatgpt.status, reachable: health.chatgpt.reachable } },
    skipped,
    results,
    disclaimer: 'Synthetic, team-written cases. These numbers describe this prototype on these cases only and are not a measure of real-world accuracy.',
  };
  const dir = join(ROOT, 'eval', 'reports');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${stamp}.json`), JSON.stringify(report, null, 2));
  writeFileSync(join(dir, 'latest.json'), JSON.stringify(report, null, 2));
  const md = toMarkdown(report);
  writeFileSync(join(dir, `${stamp}.md`), md);
  writeFileSync(join(dir, 'latest.md'), md);
  console.log(`\nReport: eval/reports/latest.md`);
}

function toMarkdown(report: any): string {
  const lines = [`# RAKSHAK evaluation report`, '', `Generated ${report.generatedAt}.`, '', `> ${report.disclaimer}`, ''];
  lines.push('## Environment', '', `- RoBERTa: ${report.environment.roberta.model} on ${report.environment.roberta.device} (ready: ${report.environment.roberta.ready})`);
  lines.push(`- Qwen: ${report.environment.qwen.model} via Ollama (reachable: ${report.environment.qwen.reachable}, context ${report.environment.qwen.contextLength ?? report.environment.qwen.numCtx})`);
  lines.push(`- ChatGPT: ${report.environment.chatgpt.reachable ? report.environment.chatgpt.status : 'companion not running'}`, '');
  if (report.skipped.length) {
    lines.push('## Not executed', '');
    for (const s of report.skipped) lines.push(`- **${s.what}**: ${s.why}`);
    lines.push('');
  }
  for (const [backend, rows] of Object.entries<any[]>(report.results)) {
    const ok = rows.filter((r) => r.levelOk && r.requiredCuesOk !== false).length;
    lines.push(`## ${backend}`, '', `Cases passing (level in range and required cues found): **${ok}/${rows.length}**.` + ` Offender attribution errors: ${rows.reduce((n, r) => n + r.falsePositiveOffenders.length, 0)} wrongly counted, ${rows.reduce((n, r) => n + r.missedOffenders.length, 0)} missed.` + ` Invalid evidence references: ${rows.reduce((n, r) => n + r.invalidEvidenceRefs, 0)}.`, '', `Level within expected range: **${rows.filter((r) => r.levelOk).length}/${rows.length}**. False positives: ${rows.filter((r) => r.falsePositive).length}. False negatives: ${rows.filter((r) => r.falseNegative).length}.`, '');
    lines.push('| Case | Level (expected) | Score | OK | Target | Required cues | Offenders found | Wrongly counted | Missed | Evidence | Invalid refs | Disagreements | Verifier rejections | p50 / p95 latency |');
    lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
    for (const r of rows) {
      lines.push(
        `| ${r.title} | L${r.level} (L${r.expectedLevel.join('–')}) | ${r.score} | ${r.levelOk ? '✅' : '❌'} | ${r.targetOk ? '✅' : '❌'} | ${r.requiredCuesOk === null ? '–' : r.requiredCuesOk ? '✅' : '❌'} | ${r.offenders.join(', ') || '–'} | ${r.falsePositiveOffenders.join(', ') || '–'} | ${r.missedOffenders.join(', ') || '–'} | ${r.evidence} | ${r.invalidEvidenceRefs} | ${r.disagreements} | ${r.verifierRejections} | ${r.latencyMs.p50 ? Math.round(r.latencyMs.p50) : '–'} / ${r.latencyMs.p95 ? Math.round(r.latencyMs.p95) : '–'} ms |`,
      );
    }
    lines.push('');
    const errs = rows.filter((r) => r.errors.length);
    if (errs.length) {
      lines.push('### Errors during runs', '');
      for (const r of errs) lines.push(`- ${r.title}: ${[...new Set(r.errors)].join('; ')}`);
      lines.push('');
    }
    lines.push('### Score timelines', '');
    for (const r of rows) lines.push(`- **${r.title}**: ${r.timeline.map((t: any) => `${t.score}(L${t.level})`).join(' → ') || 'no runs'}`);
    lines.push('');
  }
  return lines.join('\n');
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
