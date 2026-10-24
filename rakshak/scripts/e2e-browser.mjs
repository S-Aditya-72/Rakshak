// Browser end-to-end check: drives the real web UI in headless Chrome (CDP, no npm deps) against the live
// inference service. Plays a test case or sends unscripted Mode B messages, then reports state + console errors.
//
//   node scripts/e2e-browser.mjs scenario s2-bullying [outDir]
//   node scripts/e2e-browser.mjs live "message one" "message two" ...          (Mode C: fresh conversation)
//   node scripts/e2e-browser.mjs history s1-banter boundary "child:msg" "msg"  (Mode B: history checkpoint, then live)
//   E2E_HELP=1 also opens Get help → evidence review on the newest L2/L3 alert and checks the redacted report.
//
// Requires: web dev server on :5280 (npm run dev) and apps/server on :8787. Uses the dev-only window.__rakshak hook.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [cmd = 'scenario', ...rest] = process.argv.slice(2);
const CHROME = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
].find((p) => p && existsSync(p));
if (!CHROME) throw new Error('Chrome not found; set CHROME_PATH');
const PORT = 9341;
const BASE = process.env.RAKSHAK_WEB ?? 'http://127.0.0.1:5280';
const profile = await mkdtemp(join(tmpdir(), 'rakshak-e2e-'));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--window-size=1720,1000', '--mute-audio', '--no-first-run', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pages;
for (let i = 0; i < 80; i++) {
  try {
    pages = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    if (pages.some((p) => p.type === 'page')) break;
  } catch {}
  await sleep(250);
}
const ws = new WebSocket(pages.find((p) => p.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let seq = 0;
const pending = new Map();
const problems = [];
ws.addEventListener('message', (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) {
    const { res, rej } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
  } else if (msg.method === 'Runtime.exceptionThrown') problems.push(`exception: ${msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text}`);
  else if (msg.method === 'Runtime.consoleAPICalled' && (msg.params.type === 'error' || msg.params.type === 'warning'))
    problems.push(`console.${msg.params.type}: ${msg.params.args.map((a) => a.value ?? a.description).join(' ').slice(0, 300)}`);
});
const send = (method, params = {}) =>
  new Promise((res, rej) => {
    const id = ++seq;
    pending.set(id, { res, rej });
    ws.send(JSON.stringify({ id, method, params }));
  });
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
};

await send('Runtime.enable');
await send('Page.enable');
const mode = cmd === 'live' ? 'C' : cmd === 'history' ? 'B' : 'A';
await send('Page.navigate', { url: `${BASE}/#/sim?mode=${mode}` });
for (let i = 0; i < 80 && !(await evaluate('!!window.__rakshak').catch(() => false)); i++) await sleep(250);
await sleep(2500);

const summary = `(() => { const d = window.__rakshak.useDemo.getState().data; return {
  mode: d.mode, origin: d.origin, checkpoint: d.checkpoint, historyInit: d.historyInit, backend: d.backend, scenarioId: d.scenarioId, serverOnline: d.serverOnline, cursor: d.cursor,
  level: d.level, score: Number(d.score.toFixed(2)), category: d.risk?.category ?? null, dominant: d.risk?.dominantTrack ?? null,
  tracks: (d.risk?.tracks ?? []).map(t => ({ key: t.key, level: t.level, score: Number(t.score.toFixed(2)), senders: t.senders, chats: t.conversations })),
  alerts: d.alerts.map(a => ({ level: a.level, title: a.guardianTitle, category: a.category, preview: !!a.preview, historical: !!a.historical })),
  evidence: d.evidence.filter(e => e.status === 'active' || e.status === 'needs_review').length,
  analysed: d.messages.filter(m => m.analysis).length, messages: d.messages.filter(m => m.kind === 'msg').length,
  pending: d.pending.length, runError: d.runError, conversations: d.conversations.length,
  lastRun: d.lastRun && { assessment: d.lastRun.assessment, findings: d.lastRun.findings.map(f => f.cue + (f.modifier !== 'none' ? '/' + f.modifier : '')), latencyMs: Math.round(d.lastRun.latency.totalMs) },
  history: d.history.map(h => h.score.toFixed(1) + '@D' + h.day + ':L' + h.level).join(' ') } })()`;

let result;
if (cmd === 'scenario') {
  const id = rest[0] ?? 's2-bullying';
  await evaluate(`window.__rakshak.selectScenario(${JSON.stringify(id)})`);
  await evaluate(`window.__rakshak.useDemo.getState().dispatch({ type: 'setSpeed', speed: 4 })`);
  await evaluate('window.__rakshak.play(), true');
  const t0 = Date.now();
  while (Date.now() - t0 < 15 * 60_000) {
    await sleep(1500);
    const s = await evaluate(`(() => { const d = window.__rakshak.useDemo.getState().data; return { playing: d.playing, cursor: d.cursor, len: window.__rakshak.scriptLength() } })()`);
    // E2E_STOP_AT=n: pause after n scripted messages (then "Continue live from here", see below).
    if (process.env.E2E_STOP_AT && s.cursor >= Number(process.env.E2E_STOP_AT)) {
      await evaluate('window.__rakshak.pause(), true');
      for (let i = 0; i < 120 && (await evaluate('window.__rakshak.useDemo.getState().data.pending.length')) > 0; i++) await sleep(500);
      break;
    }
    if (!s.playing && s.cursor >= s.len) break;
    if (!s.playing && s.cursor < s.len) {
      problems.push(`player stopped early at ${s.cursor}/${s.len}`);
      break;
    }
  }
  await sleep(1500);
  result = await evaluate(summary);
  if (process.env.E2E_STOP_AT) {
    // Mode A → B: keep the played case and continue it live with the given messages (E2E_LIVE='["child:..","..."]').
    const before = { messages: result.messages, evidence: result.evidence, level: result.level };
    await evaluate('window.__rakshak.continueLiveFromHere()');
    for (let i = 0; i < 240 && (await evaluate('window.__rakshak.useDemo.getState().data.historyInit.status')) === 'analyzing'; i++) await sleep(500);
    const after = await evaluate(summary);
    for (const raw of JSON.parse(process.env.E2E_LIVE ?? '[]')) {
      const child = raw.startsWith('child:');
      await evaluate(`window.__rakshak.sendLive(${JSON.stringify(child ? 'victim' : 'predator')}, ${JSON.stringify(child ? raw.slice(6) : raw)})`);
      await sleep(300);
      for (let i = 0; i < 400 && (await evaluate('window.__rakshak.useDemo.getState().data.pending.length')) > 0; i++) await sleep(500);
    }
    const live = await evaluate(summary);
    result.continueLive = { before, afterContinue: { mode: after.mode, origin: after.origin, checkpoint: after.checkpoint, messages: after.messages, evidence: after.evidence, level: after.level, historyInit: after.historyInit }, afterLive: live };
    if (after.messages !== before.messages || after.origin !== 'history' || after.mode !== 'B') problems.push('continue live changed the played case or did not switch to B');
  }
} else if (cmd === 'history') {
  const [id = 's2-bullying', checkpoint, ...msgs] = rest;
  await evaluate(`window.__rakshak.loadHistory(${JSON.stringify(id)}, ${JSON.stringify(checkpoint ? { checkpoint } : {})}), true`);
  const t0 = Date.now();
  let h;
  while (Date.now() - t0 < 10 * 60_000) {
    await sleep(1000);
    h = await evaluate('window.__rakshak.useDemo.getState().data.historyInit');
    if (!['loading', 'analyzing', 'idle'].includes(h.status)) break;
  }
  if (h?.status !== 'complete' && h?.status !== 'messages_only') problems.push(`history setup ended as ${h?.status}: ${h?.error ?? ''}`);
  const baseline = await evaluate(summary);
  for (const raw of msgs) {
    const child = raw.startsWith('child:');
    const text = child ? raw.slice(6) : raw;
    await evaluate(`window.__rakshak.sendLive(${JSON.stringify(child ? 'victim' : 'predator')}, ${JSON.stringify(text)})`);
    await sleep(300);
    for (let i = 0; i < 400; i++) {
      await sleep(500);
      if ((await evaluate('window.__rakshak.useDemo.getState().data.pending.length')) === 0) break;
    }
  }
  result = await evaluate(summary);
  result.baseline = { level: baseline.level, score: baseline.score, evidence: baseline.evidence, alerts: baseline.alerts, historyInit: baseline.historyInit, messages: baseline.messages };
} else if (cmd === 'live') {
  await evaluate('window.__rakshak.startFreshConversation()');
  await sleep(1000);
  for (const text of rest) {
    await evaluate(`window.__rakshak.sendLive('predator', ${JSON.stringify(text)})`);
    for (let i = 0; i < 240; i++) {
      await sleep(500);
      if ((await evaluate('window.__rakshak.useDemo.getState().data.pending.length')) === 0) break;
    }
  }
  result = await evaluate(summary);
  // Backend switch: ChatGPT keeps its own (empty) evidence set; switching back restores the local case.
  await evaluate(`window.__rakshak.setBackend('gpt')`);
  await sleep(1500);
  const onGpt = await evaluate(`(() => { const d = window.__rakshak.useDemo.getState().data; return { backend: d.backend, evidence: d.evidence.length, level: d.level } })()`);
  await evaluate(`window.__rakshak.setBackend('inhouse')`);
  await sleep(1500);
  const backOnLocal = await evaluate(`(() => { const d = window.__rakshak.useDemo.getState().data; return { backend: d.backend, evidence: d.evidence.length, level: d.level } })()`);
  // Reload: case memory comes back from SQLite.
  await send('Page.reload');
  for (let i = 0; i < 80 && !(await evaluate('!!window.__rakshak').catch(() => false)); i++) await sleep(250);
  await sleep(3000);
  const afterReload = await evaluate(summary);
  result.checks = {
    backendSwitch: { onGpt, backOnLocal, ok: onGpt.backend === 'gpt' && backOnLocal.evidence === result.evidence && backOnLocal.level === result.level },
    reload: { messages: afterReload.messages, level: afterReload.level, evidence: afterReload.evidence, ok: afterReload.messages === result.messages && afterReload.level === result.level },
  };
}

const outDir = rest[1] && cmd === 'scenario' ? rest[1] : join(tmpdir(), 'rakshak-e2e-shots');
await mkdir(outDir, { recursive: true });
// E2E_TABS=case,evidence,trace,models also screenshots the engine drawer on each tab.
const tabs = (process.env.E2E_TABS ?? '').split(',').filter(Boolean);
const shots = [];
const capture = async (suffix) => {
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  const file = join(outDir, `${cmd}-${(rest[0] ?? 'live').replace(/[^a-z0-9-]/gi, '_').slice(0, 30)}${suffix}.png`);
  await writeFile(file, Buffer.from(shot.data, 'base64'));
  shots.push(file);
};
await capture('');
if (process.env.E2E_HELP) {
  // Guardian help → evidence review on the newest L2/L3 alert of this case; checks the reviewed (redacted) report.
  const opened = await evaluate(`(() => { const s = window.__rakshak.useDemo.getState(); const a = [...s.data.alerts].reverse().find((x) => x.level >= 2 && !x.preview); if (!a) return false; s.dispatch({ type: 'openHelp', alert: a, tab: 'evidence' }); return a.childName; })()`);
  if (!opened) problems.push('no L2/L3 alert to open Get help on');
  else {
    await sleep(800);
    await evaluate(`[...document.querySelectorAll('.help button')].find((b) => b.textContent.includes('Open evidence review'))?.click(), true`);
    await sleep(1200);
    const html = await evaluate(`document.querySelector('.help-preview')?.getAttribute('srcdoc') ?? ''`);
    result.report = {
      bytes: html.length,
      notSubmitted: html.includes('Not submitted'),
      synthetic: html.includes('SYNTHETIC'),
      childNameLeaked: new RegExp(`\\b${opened}\\b`, 'i').test(html),
      rawScriptTag: /<script/i.test(html),
      rows: (html.match(/<tr><td>E\d+/g) ?? []).length,
    };
    if (!result.report.notSubmitted || result.report.childNameLeaked || result.report.rawScriptTag || !result.report.rows) problems.push(`report check failed: ${JSON.stringify(result.report)}`);
    await capture('-help-evidence');
    await evaluate(`(() => { const s = window.__rakshak.useDemo.getState(); s.dispatch({ type: 'openHelp', alert: s.data.helpFor, tab: 'support' }); })()`);
    await sleep(700);
    await capture('-help-support');
    await evaluate(`window.__rakshak.useDemo.getState().dispatch({ type: 'closeHelp' })`);
  }
}
if (tabs.length) {
  await evaluate(`(() => { const d = window.__rakshak.useDemo.getState(); d.dispatch({ type: 'closeCritical' }); d.dispatch({ type: 'closeNudge' }); d.dispatch({ type: 'closeBanner' }); })()`);
  await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'e' })), true`);
  await sleep(800);
  for (const t of tabs) {
    await evaluate(`[...document.querySelectorAll('.drawer .seg-btn')].find((b) => b.textContent.trim().toLowerCase() === ${JSON.stringify(t)})?.click(), true`);
    await sleep(900);
    await capture(`-drawer-${t}`);
  }
}
const file = shots.join(' ');
console.log(JSON.stringify({ result, problems, screenshot: file }, null, 2));
ws.close();
chrome.kill();
process.exit(problems.some((p) => p.startsWith('exception')) ? 1 : 0);
