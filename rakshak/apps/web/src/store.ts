// Demo state, the scenario player and the live analysis loop.
// Every change is an Action run through `reduce`, and actions are mirrored to other tabs over BroadcastChannel,
// so /predator, /victim and /console can live in separate windows and stay in sync.
// Async work (server calls, model runs) happens only in the tab that started it; its results arrive as actions.

import type { RiskState } from '@rakshak/engine';
import type { AnalysisResult, EvidenceEvent } from '@rakshak/shared';
import { create } from 'zustand';
import { BACKEND_META, CHILD, CUE_ACTIVE_P, WEEKDAYS } from './data/meta';
import { PREVIEW_BY_LEVEL, SCENARIO as PREVIEW_SCRIPT } from './data/scenario';
import { api, ApiError, rid, type ChatGPTStatus, type Health, type ScenarioView, type ServerState } from './lib/api';
import { alertsToFire, analysisFor, nameMap, riskOf, type CaseInputs } from './lib/case';
import type { AlertItem, Analysis, Backend, ChatMessage, ConversationView, Level, Mode, ParticipantView, Side, Stage } from './types';

/** Id of the offline presentation preview (precomputed analyses, clearly labelled, never presented as live AI). */
export const PREVIEW_ID = 'preview-scripted';

export interface DemoData {
  mode: Mode;
  backend: Backend;
  sound: boolean;
  speed: number;
  playing: boolean;
  cursor: number;
  simDay: number;
  messages: ChatMessage[];
  typing: Record<Side, boolean>;
  analyzingId: string | null;
  score: number;
  level: Level;
  stage: Stage;
  history: { day: number; score: number; level: Level }[];
  alerts: AlertItem[];
  dismissals: number;
  victimNudge: AlertItem | null;
  guardianBanner: AlertItem | null;
  guardianSheet: AlertItem | null;
  critical: AlertItem | null;
  reportOpen: boolean;

  // ---- real case memory ----
  childId: string;
  participants: ParticipantView[];
  conversations: ConversationView[];
  activeConv: string | null;
  /** Participant typing on the left ("contact") phone. */
  perspective: string | null;
  evidence: EvidenceEvent[];
  firstSeen: Record<string, number>;
  dismissalList: { day: number; trackKey: string | null }[];
  blocks: { contactId: string; day: number }[];
  alerted: Record<string, number>;
  risk: RiskState | null;
  lastRun: AnalysisResult | null;
  pending: string[];
  runError: { code: string; message: string } | null;

  // ---- environment ----
  health: Health | null;
  serverOnline: boolean | null;
  scenarios: ScenarioView[];
  scenarioId: string | null;
  caption: string | null;
  chatgpt: { status: ChatGPTStatus | null; models: { slug: string; displayName: string }[]; model: string | null; busy: boolean; error: string | null };
}

export type Action =
  | { type: 'reset' }
  | { type: 'setMode'; mode: Mode }
  | { type: 'setBackend'; backend: Backend }
  | { type: 'setSound'; sound: boolean }
  | { type: 'setSpeed'; speed: number }
  | { type: 'setPlaying'; playing: boolean }
  | { type: 'setCursor'; cursor: number }
  | { type: 'setDay'; day: number }
  | { type: 'typing'; side: Side; on: boolean }
  | { type: 'push'; message: ChatMessage }
  | { type: 'analyzing'; id: string | null }
  | { type: 'analysis'; id: string; analysis: Analysis }
  | { type: 'preview'; level: 1 | 2 | 3; id: string }
  | { type: 'dismissNudge' }
  | { type: 'closeNudge' }
  | { type: 'closeBanner' }
  | { type: 'openSheet'; alert: AlertItem }
  | { type: 'closeSheet' }
  | { type: 'closeCritical' }
  | { type: 'openReport' }
  | { type: 'closeReport' }
  | { type: 'snapshot'; data: DemoData }
  // real case memory
  | { type: 'hydrate'; state: Partial<DemoData> }
  | { type: 'setActiveConv'; id: string; perspective?: string | null }
  | { type: 'setPerspective'; id: string }
  | { type: 'addConversation'; conversation: ConversationView; participants: ParticipantView[] }
  | { type: 'pending'; ids: string[]; on: boolean }
  | { type: 'runApplied'; run: AnalysisResult; analyses: Record<string, Analysis>; evidence: EvidenceEvent[]; firstSeen: Record<string, number>; risk: RiskState; point: { day: number; score: number; level: Level }; fire: AlertItem[]; alerted: Record<string, number> }
  | { type: 'runError'; error: { code: string; message: string } | null; clear?: string[] }
  | { type: 'setRisk'; risk: RiskState; dismissalList?: DemoData['dismissalList']; blocks?: DemoData['blocks'] }
  | { type: 'env'; patch: Partial<Pick<DemoData, 'health' | 'serverOnline' | 'scenarios' | 'caption'>> }
  | { type: 'chatgpt'; patch: Partial<DemoData['chatgpt']> };

function initial(keep?: Partial<DemoData>): DemoData {
  return {
    mode: 'A',
    backend: 'inhouse',
    sound: true,
    speed: 1,
    health: null,
    serverOnline: null,
    scenarios: [],
    scenarioId: null,
    chatgpt: { status: null, models: [], model: null, busy: false, error: null },
    ...keep,
    playing: false,
    cursor: 0,
    simDay: 1,
    messages: [],
    typing: { predator: false, victim: false },
    analyzingId: null,
    score: 0,
    level: 0,
    stage: 'rapport',
    history: [],
    alerts: [],
    dismissals: 0,
    victimNudge: null,
    guardianBanner: null,
    guardianSheet: null,
    critical: null,
    reportOpen: false,
    childId: CHILD.id,
    participants: [{ id: CHILD.id, displayName: CHILD.name, role: 'protected_child' }],
    conversations: [],
    activeConv: null,
    perspective: null,
    evidence: [],
    firstSeen: {},
    dismissalList: [],
    blocks: [],
    alerted: {},
    risk: null,
    lastRun: null,
    pending: [],
    runError: null,
    caption: null,
  };
}

const KEEP = (s: DemoData): Partial<DemoData> => ({
  mode: s.mode,
  backend: s.backend,
  sound: s.sound,
  speed: s.speed,
  health: s.health,
  serverOnline: s.serverOnline,
  scenarios: s.scenarios,
  scenarioId: s.scenarioId,
  chatgpt: s.chatgpt,
});

/** Legacy alert builder, used only by the presentation preview and the "Preview L1/L2/L3" buttons. */
function buildPreviewAlert(id: string, a: Analysis, day: number, time: string, messages: ChatMessage[], preview = false): AlertItem {
  const cues = messages
    .filter((m) => m.analysis)
    .flatMap((m) => m.analysis!.cues.filter((c) => c.p >= CUE_ACTIVE_P).map((c) => ({ cue: c.cue, day: m.day })));
  return {
    id,
    level: a.level as 1 | 2 | 3,
    day,
    time,
    stage: a.stage,
    score: a.score,
    contact: 'Kabir (preview)',
    guardianTitle: a.alert?.guardianTitle ?? '',
    guardianBody: a.alert?.guardianBody ?? '',
    cues,
    preview,
    category: 'grooming',
  };
}

/** Routes an alert to the surfaces its level reaches (Plan.md §6.2). */
function route(s: DemoData, alert: AlertItem): DemoData {
  return {
    ...s,
    alerts: [...s.alerts, alert],
    victimNudge: alert,
    guardianBanner: alert.level === 2 ? alert : s.guardianBanner,
    critical: alert.level === 3 ? alert : s.critical,
    reportOpen: alert.level === 3 ? false : s.reportOpen,
  };
}

function withDayRow(messages: ChatMessage[], m: ChatMessage): ChatMessage[] {
  const prev = [...messages].reverse().find((x) => x.conversationId === m.conversationId);
  if (m.kind === 'msg' && (!prev || prev.day !== m.day)) {
    return [...messages, { id: `day-${m.conversationId}-${m.day}`, kind: 'day', conversationId: m.conversationId, text: `Day ${m.day} · ${WEEKDAYS[m.day] ?? ''}`, day: m.day, time: m.time }, m];
  }
  return [...messages, m];
}

function reduce(s: DemoData, a: Action): DemoData {
  switch (a.type) {
    case 'reset':
      return initial(KEEP(s));
    case 'setMode':
      return initial({ ...KEEP(s), mode: a.mode, scenarioId: a.mode === 'A' ? s.scenarioId : null });
    case 'setBackend':
      return { ...s, backend: a.backend, runError: null };
    case 'setSound':
      return { ...s, sound: a.sound };
    case 'setSpeed':
      return { ...s, speed: a.speed };
    case 'setPlaying':
      return { ...s, playing: a.playing };
    case 'setCursor':
      return { ...s, cursor: a.cursor };
    case 'setDay': {
      // Advancing the sim clock lets the engine's 7-day decay show up; computeRisk is pure, so it is safe here.
      if (!s.risk) return { ...s, simDay: a.day };
      const risk = riskOf(caseInputs({ ...s, simDay: a.day }));
      return { ...s, simDay: a.day, risk, score: risk.score, level: risk.level, stage: risk.stage };
    }
    case 'typing':
      return { ...s, typing: { ...s.typing, [a.side]: a.on } };
    case 'push':
      if (s.messages.some((m) => m.id === a.message.id)) return s;
      return { ...s, messages: a.message.kind === 'msg' && a.message.conversationId ? withDayRow(s.messages, a.message) : [...s.messages, a.message] };
    case 'analyzing':
      return { ...s, analyzingId: a.id };
    case 'analysis': {
      // Presentation preview path only (precomputed analyses).
      const messages = s.messages.map((m) => (m.id === a.id ? { ...m, analysis: a.analysis } : m));
      const msg = messages.find((m) => m.id === a.id)!;
      let next: DemoData = {
        ...s,
        messages,
        analyzingId: null,
        score: a.analysis.score,
        level: a.analysis.level,
        stage: a.analysis.stage,
        history: [...s.history, { day: msg.day, score: a.analysis.score, level: a.analysis.level }],
      };
      if (a.analysis.level >= 1) next = route(next, buildPreviewAlert(`alert-${a.id}`, a.analysis, msg.day, msg.time, messages, true));
      return next;
    }
    case 'preview': {
      const p = PREVIEW_BY_LEVEL[a.level];
      const fake: ChatMessage[] = PREVIEW_SCRIPT.filter((st) => st.analysis && st.analysis.level <= a.level).map((st, i) => ({
        id: `p${i}`,
        kind: 'msg',
        text: st.text,
        day: st.day,
        time: st.time,
        analysis: st.analysis,
      }));
      return route(s, buildPreviewAlert(a.id, p.analysis, p.day, p.time, fake, true));
    }
    case 'dismissNudge':
      return { ...s, victimNudge: null, dismissals: s.dismissals + 1 };
    case 'closeNudge':
      return { ...s, victimNudge: null };
    case 'closeBanner':
      return { ...s, guardianBanner: null };
    case 'openSheet':
      return { ...s, guardianSheet: a.alert, guardianBanner: null };
    case 'closeSheet':
      return { ...s, guardianSheet: null };
    case 'closeCritical':
      return { ...s, critical: null, reportOpen: false };
    case 'openReport':
      return { ...s, reportOpen: true };
    case 'closeReport':
      return { ...s, reportOpen: false };
    case 'snapshot':
      return a.data;

    case 'hydrate':
      return { ...s, ...a.state };
    case 'setActiveConv':
      return { ...s, activeConv: a.id, perspective: a.perspective !== undefined ? a.perspective : defaultPerspective(s, a.id) };
    case 'setPerspective':
      return { ...s, perspective: a.id };
    case 'addConversation': {
      const known = new Set(s.participants.map((p) => p.id));
      return {
        ...s,
        participants: [...s.participants, ...a.participants.filter((p) => !known.has(p.id))],
        conversations: [...s.conversations.filter((c) => c.id !== a.conversation.id), a.conversation],
      };
    }
    case 'pending': {
      const set = new Set(s.pending);
      a.ids.forEach((id) => (a.on ? set.add(id) : set.delete(id)));
      const pending = [...set];
      return { ...s, pending, analyzingId: pending[pending.length - 1] ?? null };
    }
    case 'runApplied': {
      const covered = new Set(a.run.focusMessageIds);
      const messages = s.messages.map((m) => (a.analyses[m.id] ? { ...m, analysis: a.analyses[m.id] } : m));
      const pending = s.pending.filter((id) => !covered.has(id));
      let next: DemoData = {
        ...s,
        messages,
        pending,
        analyzingId: pending[pending.length - 1] ?? null,
        evidence: a.evidence,
        firstSeen: a.firstSeen,
        risk: a.risk,
        score: a.risk.score,
        level: a.risk.level,
        stage: a.risk.stage,
        history: [...s.history, a.point],
        alerted: a.alerted,
        lastRun: a.run,
        runError: a.run.error && a.run.error.code !== 'stale' ? a.run.error : null,
      };
      for (const al of a.fire) next = route(next, al);
      return next;
    }
    case 'runError': {
      const clear = new Set(a.clear ?? []);
      const pending = s.pending.filter((id) => !clear.has(id));
      return { ...s, runError: a.error, pending, analyzingId: pending[pending.length - 1] ?? null };
    }
    case 'setRisk':
      return {
        ...s,
        risk: a.risk,
        score: a.risk.score,
        level: a.risk.level,
        stage: a.risk.stage,
        dismissalList: a.dismissalList ?? s.dismissalList,
        blocks: a.blocks ?? s.blocks,
      };
    case 'env':
      return { ...s, ...a.patch };
    case 'chatgpt':
      return { ...s, chatgpt: { ...s.chatgpt, ...a.patch } };
  }
}

function defaultPerspective(s: DemoData, convId: string): string | null {
  const conv = s.conversations.find((c) => c.id === convId);
  if (!conv) return null;
  const others = conv.participantIds.filter((p) => p !== s.childId);
  return s.perspective && others.includes(s.perspective) ? s.perspective : others[0] ?? null;
}

// ---------- store + cross-tab sync ----------

const tabId = Math.random().toString(36).slice(2);
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('rakshak-demo') : null;

interface Store {
  data: DemoData;
  dispatch: (a: Action) => void;
}

export const useDemo = create<Store>((set) => ({
  data: initial(),
  dispatch: (a) => {
    set((st) => ({ data: reduce(st.data, a) }));
    channel?.postMessage({ from: tabId, action: a });
  },
}));

type Wire = { from: string; action?: Action; hello?: boolean; snapshot?: DemoData };

if (channel) {
  channel.onmessage = (e: MessageEvent<Wire>) => {
    const msg = e.data;
    if (msg.from === tabId) return;
    if (msg.hello) {
      const data = useDemo.getState().data;
      if (data.messages.length || data.alerts.length || data.conversations.length) channel.postMessage({ from: tabId, snapshot: data });
    } else if (msg.snapshot) {
      if (useDemo.getState().data.messages.length === 0) useDemo.setState({ data: msg.snapshot });
    } else if (msg.action) {
      useDemo.setState((st) => ({ data: reduce(st.data, msg.action!) }));
    }
  };
  channel.postMessage({ from: tabId, hello: true });
}

// ---------- helpers ----------

const dispatch = (a: Action) => useDemo.getState().dispatch(a);
const get = () => useDemo.getState().data;
const uid = () => Math.random().toString(36).slice(2, 10);
const apiBackend = (b: Backend) => BACKEND_META[b].api;
let runToken = 0;
/** Bumped on every reset / scenario load / mode or backend switch: older in-flight results are discarded. */
let caseEpoch = 0;
let inflight = new AbortController();

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms / get().speed));
const typingMs = (text: string) => Math.min(2200, Math.max(700, 450 + text.length * 26));
const nowTime = () => new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

function caseInputs(d: DemoData, patch: Partial<CaseInputs> = {}): CaseInputs {
  return { childId: d.childId, evidence: d.evidence, firstSeen: d.firstSeen, dismissals: d.dismissalList, blocks: d.blocks, simDay: d.simDay, participants: d.participants, ...patch };
}

function sideOf(senderId: string): Side {
  return senderId === get().childId ? 'victim' : 'predator';
}

function bumpEpoch() {
  caseEpoch++;
  inflight.abort();
  inflight = new AbortController();
}

// ---------- server bootstrap / hydration ----------

export async function refreshHealth() {
  try {
    const health = await api.health();
    dispatch({ type: 'env', patch: { health, serverOnline: true } });
    dispatch({ type: 'chatgpt', patch: { status: health.chatgpt } });
    return health;
  } catch {
    dispatch({ type: 'env', patch: { serverOnline: false } });
    return null;
  }
}

export async function bootstrap() {
  const health = await refreshHealth();
  if (!health) return;
  try {
    const scenarios = await api.scenarios();
    dispatch({ type: 'env', patch: { scenarios } });
  } catch {
    /* listed later */
  }
  const d = get();
  if (d.mode === 'B') await hydrateFromServer(true);
  else if (d.scenarioId && d.scenarioId !== PREVIEW_ID && d.messages.length === 0) await hydrateFromServer(false);
}

/** Load the persisted case (conversations, messages, evidence, history) for the active backend. */
export async function hydrateFromServer(seedLive: boolean) {
  const epoch = caseEpoch;
  let st: ServerState;
  try {
    st = await api.state(apiBackend(get().backend));
    // Mode B owns its own live case. Memory left behind by a Mode A test case is replaced, not mixed in.
    if (seedLive && (st.conversations.length === 0 || st.scenarioId)) {
      await api.reset('live');
      st = await api.state(apiBackend(get().backend));
    }
  } catch (e) {
    dispatch({ type: 'env', patch: { serverOnline: false } });
    return;
  }
  if (epoch !== caseEpoch) return;
  applyServerState(st);
}

function applyServerState(st: ServerState) {
  const d = get();
  const participants: ParticipantView[] = st.participants.map((p) => ({ id: p.id, displayName: p.displayName, role: p.role }));
  const conversations: ConversationView[] = st.conversations.map((c) => ({ id: c.id, kind: c.kind, title: c.title, participantIds: c.participantIds }));
  const backend = d.backend;
  // Rebuild per-message analyses from the persisted runs (latest run that judged each message wins).
  const runFor = new Map<string, AnalysisResult>();
  for (const r of st.runs) if (!r.stale) for (const id of r.focusMessageIds) runFor.set(id, r as AnalysisResult);
  const evidence = st.evidence as EvidenceEvent[];
  const risk = riskOf({ childId: st.child.id, evidence, firstSeen: st.firstSeen, dismissals: st.dismissals, blocks: st.blocks, simDay: Math.max(1, ...st.messages.map((m) => m.day)), participants });
  let messages: ChatMessage[] = [];
  for (const m of st.messages) {
    const run = runFor.get(m.id);
    messages = withDayRow(messages, {
      id: m.id,
      kind: 'msg',
      conversationId: m.conversationId,
      senderId: m.senderId,
      from: m.senderId === st.child.id ? 'victim' : 'predator',
      text: m.text,
      day: m.day,
      time: m.time,
      analysis: run ? analysisFor(m.id, run, evidence, risk, backend) : undefined,
    });
  }
  const lastMsg = st.messages[st.messages.length - 1];
  const activeConv = d.activeConv && conversations.some((c) => c.id === d.activeConv) ? d.activeConv : lastMsg?.conversationId ?? conversations[0]?.id ?? null;
  const alerts: AlertItem[] = st.alerts.map((a) => ({
    id: a.id,
    level: a.level as 1 | 2 | 3,
    day: a.day,
    time: a.time,
    stage: risk.stage,
    score: risk.score,
    contact: a.trackKey,
    guardianTitle: a.title,
    guardianBody: a.body,
    cues: (risk.tracks.find((t) => t.key === a.trackKey)?.cues ?? []).map((c) => ({ cue: c.cue, day: c.day })),
    category: a.trackKey === 'bullying' ? 'bullying' : 'grooming',
    trackKey: a.trackKey,
  }));
  const state: Partial<DemoData> = {
    childId: st.child.id,
    participants,
    conversations,
    messages,
    evidence,
    firstSeen: st.firstSeen,
    dismissalList: st.dismissals,
    dismissals: st.dismissals.length,
    blocks: st.blocks,
    alerted: st.alerted,
    risk,
    score: risk.score,
    level: risk.level,
    stage: risk.stage,
    history: st.snapshots.map((h) => ({ day: h.day, score: h.score, level: h.level as Level })),
    alerts,
    lastRun: (st.runs[st.runs.length - 1] as AnalysisResult) ?? null,
    simDay: Math.max(d.simDay, ...st.messages.map((m) => m.day)),
    activeConv,
    scenarioId: st.scenarioId ?? (d.mode === 'B' ? null : d.scenarioId),
    pending: [],
    runError: null,
  };
  dispatch({ type: 'hydrate', state });
  if (activeConv) dispatch({ type: 'setActiveConv', id: activeConv });
}

// ---------- analysis loop ----------

/** Run real analysis for one conversation up to a message. Local: automatic. ChatGPT: owner button only. */
export async function analyzeConversation(conversationId: string, uptoMessageId: string | undefined, trigger: 'auto' | 'owner_button') {
  const d = get();
  const backend = d.backend;
  const epoch = caseEpoch;
  const convMsgs = d.messages.filter((m) => m.kind === 'msg' && m.conversationId === conversationId);
  const uptoIdx = uptoMessageId ? convMsgs.findIndex((m) => m.id === uptoMessageId) : convMsgs.length - 1;
  const waitingIds = convMsgs.slice(0, uptoIdx + 1).filter((m) => !m.analysis).map((m) => m.id);
  dispatch({ type: 'pending', ids: waitingIds.length ? waitingIds : uptoMessageId ? [uptoMessageId] : [], on: true });
  try {
    const resp = await api.analyze(
      { backend: apiBackend(backend), conversationId, uptoMessageId, requestId: rid(), trigger, model: backend === 'gpt' ? d.chatgpt.model ?? undefined : undefined },
      inflight.signal,
    );
    if (epoch !== caseEpoch || get().backend !== backend) return; // stale: case reset or backend switched meanwhile
    if (resp.result.stale) return; // a newer run covers these messages
    applyRun(resp.result as AnalysisResult, resp.evidence as EvidenceEvent[], resp.firstSeen ?? {});
  } catch (e) {
    if (epoch !== caseEpoch) return;
    const err = e instanceof ApiError ? { code: e.code, message: e.message } : { code: 'internal', message: String(e) };
    if (err.code === 'aborted') return;
    dispatch({ type: 'runError', error: err, clear: waitingIds.concat(uptoMessageId ? [uptoMessageId] : []) });
    if (err.code === 'server_offline') dispatch({ type: 'env', patch: { serverOnline: false } });
  }
}

function applyRun(run: AnalysisResult, evidence: EvidenceEvent[], firstSeen: Record<string, number>) {
  const d = get();
  const inputs = caseInputs(d, { evidence, firstSeen });
  const risk = riskOf(inputs);
  const analyses: Record<string, Analysis> = {};
  for (const id of run.focusMessageIds) analyses[id] = analysisFor(id, run, evidence, risk, d.backend);
  const lastFocus = d.messages.find((m) => m.id === run.focusMessageIds[run.focusMessageIds.length - 1]);
  const day = lastFocus?.day ?? d.simDay;
  const names = nameMap(d.participants);
  const child = d.participants.find((p) => p.id === d.childId)?.displayName ?? CHILD.name;
  const { items, next } = alertsToFire(risk, d.alerted, { day, time: lastFocus?.time ?? nowTime(), childName: child, names, runId: run.analysisId });
  dispatch({ type: 'runApplied', run, analyses, evidence, firstSeen, risk, point: { day, score: risk.score, level: risk.level }, fire: items, alerted: next });
  // Persist the deterministic outputs next to the evidence (fire-and-forget; the server de-duplicates alerts).
  const b = apiBackend(d.backend);
  api.snapshot(d.childId, { backend: b, runId: run.analysisId, day, score: risk.score, level: risk.level, stage: risk.stage, category: risk.category, dominantTrack: risk.dominantTrack, trace: risk.trace, evidenceKeys: evidence.filter((e) => e.status === 'active' || e.status === 'needs_review').map((e) => e.key) }).catch(() => {});
  for (const a of items) api.alert(d.childId, { id: a.id, backend: b, trackKey: a.trackKey, level: a.level, day: a.day, time: a.time, title: a.guardianTitle, body: a.guardianBody }).catch(() => {});
}

function recomputeRisk(patch: Partial<CaseInputs> = {}) {
  const d = get();
  const risk = riskOf(caseInputs(d, patch));
  dispatch({ type: 'setRisk', risk, dismissalList: patch.dismissals, blocks: patch.blocks });
}

/** Child dismissed an L1 nudge: halves that track's score (engine rule), never below L1. */
export async function dismissNudge() {
  const d = get();
  const trackKey = d.victimNudge?.trackKey ?? null;
  dispatch({ type: 'dismissNudge' });
  if (d.victimNudge?.preview) return;
  const dismissals = [...d.dismissalList, { day: d.simDay, trackKey }];
  recomputeRisk({ dismissals });
  api.dismissal(d.childId, { day: d.simDay, trackKey }).catch(() => {});
}

/** Child tapped "Block" in a nudge: recorded so a brand-new contact right after it is flagged for review. */
export function blockActiveContact() {
  const d = get();
  const conv = d.conversations.find((c) => c.id === d.activeConv);
  const contactId = conv?.kind === 'private' ? conv.participantIds.find((p) => p !== d.childId) : undefined;
  if (!contactId) return;
  const blocks = [...d.blocks, { contactId, day: d.simDay }];
  recomputeRisk({ blocks });
  api.block(d.childId, { contactId, day: d.simDay }).catch(() => {});
}

// ---------- messages ----------

async function postMessage(m: ChatMessage) {
  try {
    await api.addMessage({ id: m.id, conversationId: m.conversationId!, senderId: m.senderId!, day: m.day, time: m.time, text: m.text });
    return true;
  } catch (e) {
    const err = e instanceof ApiError ? { code: e.code, message: e.message } : { code: 'internal', message: String(e) };
    dispatch({ type: 'runError', error: { code: err.code, message: `Message not saved: ${err.message}` } });
    if (err.code === 'server_offline') dispatch({ type: 'env', patch: { serverOnline: false } });
    return false;
  }
}

/** Mode B: a person typed a message on one of the phones. */
export async function sendLive(side: Side, text: string) {
  const d = get();
  const convId = d.activeConv;
  if (!convId) return;
  const senderId = side === 'victim' ? d.childId : d.perspective;
  if (!senderId) return;
  const m: ChatMessage = { id: `m-${uid()}${uid()}`, kind: 'msg', from: side, conversationId: convId, senderId, text, day: d.simDay, time: nowTime() };
  dispatch({ type: 'push', message: m });
  const ok = await postMessage(m);
  // Local hybrid analyses automatically. ChatGPT never runs from someone's typing: the owner must press the button.
  if (ok && d.backend === 'inhouse' && senderId !== d.childId) void analyzeConversation(convId, m.id, 'auto');
}

/** Owner-initiated ChatGPT analysis of the open conversation (Sign in with ChatGPT terms: no background use). */
export async function analyzeWithChatGPT() {
  const d = get();
  if (d.backend !== 'gpt' || !d.activeConv) return;
  await analyzeConversation(d.activeConv, undefined, 'owner_button');
}

/** Re-run the selected backend over every conversation (local hybrid only; sequential on the GPU). */
export async function analyzeAllChats() {
  const d = get();
  if (d.backend !== 'inhouse') return;
  for (const c of d.conversations) {
    const last = [...get().messages].reverse().find((m) => m.kind === 'msg' && m.conversationId === c.id);
    if (last) await analyzeConversation(c.id, last.id, 'auto');
  }
}

export async function createConversation(kind: 'private' | 'group', title: string, existingIds: string[], newNames: string[]) {
  const created: ParticipantView[] = [];
  for (const n of newNames) {
    const p = await api.addParticipant(n, kind === 'private' ? 'contact' : 'peer');
    created.push({ id: p.id, displayName: p.displayName, role: p.role });
  }
  const ids = [...existingIds, ...created.map((p) => p.id)];
  const conv = await api.addConversation(kind, title, ids);
  dispatch({ type: 'addConversation', conversation: { id: conv.id, kind: conv.kind, title: conv.title, participantIds: conv.participantIds }, participants: created });
  dispatch({ type: 'setActiveConv', id: conv.id });
}

export function openConversation(id: string) {
  dispatch({ type: 'setActiveConv', id });
}

// ---------- scenario player (Mode A) ----------

function currentScenario(): ScenarioView | null {
  const d = get();
  return d.scenarios.find((s) => s.id === d.scenarioId) ?? null;
}

export function scriptLength(): number {
  const d = get();
  if (d.scenarioId === PREVIEW_ID) return PREVIEW_SCRIPT.length;
  return currentScenario()?.messages.length ?? 0;
}

/** Load a scenario: resets the case on the server and creates its people and chats. */
export async function selectScenario(id: string) {
  runToken++;
  bumpEpoch();
  const keep = get();
  dispatch({ type: 'reset' });
  if (id === PREVIEW_ID) {
    dispatch({ type: 'hydrate', state: { scenarioId: PREVIEW_ID, ...previewCast() } });
    dispatch({ type: 'setActiveConv', id: 'preview-c-kabir' });
    return;
  }
  try {
    const sc = await api.loadScenario(id);
    const participants: ParticipantView[] = [{ id: sc.child.id, displayName: sc.child.name, role: 'protected_child' }, ...sc.participants.map((p) => ({ id: p.id, displayName: p.name, role: p.role }))];
    const conversations: ConversationView[] = sc.conversations.map((c) => ({ id: c.id, kind: c.kind, title: c.title, participantIds: c.participants }));
    dispatch({ type: 'hydrate', state: { scenarioId: id, childId: sc.child.id, participants, conversations, activeConv: sc.messages[0]?.conversationId ?? conversations[0]?.id ?? null } });
    dispatch({ type: 'setActiveConv', id: sc.messages[0]?.conversationId ?? conversations[0].id });
  } catch (e) {
    dispatch({ type: 'hydrate', state: { scenarioId: keep.scenarioId } });
    dispatch({ type: 'runError', error: { code: 'server_offline', message: e instanceof ApiError ? e.message : 'Could not load scenario' } });
  }
}

function previewCast(): Partial<DemoData> {
  return {
    childId: CHILD.id,
    participants: [
      { id: CHILD.id, displayName: CHILD.name, role: 'protected_child' },
      { id: 'p-kabir', displayName: 'Kabir', role: 'contact' },
    ],
    conversations: [{ id: 'preview-c-kabir', kind: 'private', title: 'Kabir', participantIds: [CHILD.id, 'p-kabir'] }],
  };
}

async function runStep(i: number, token: number): Promise<boolean> {
  const d0 = get();
  const preview = d0.scenarioId === PREVIEW_ID;
  const sc = currentScenario();
  const step = preview
    ? (() => {
        const p = PREVIEW_SCRIPT[i];
        return p && { id: `preview-m${i}`, conversationId: 'preview-c-kabir', senderId: p.from === 'victim' ? CHILD.id : 'p-kabir', day: p.day, time: p.time, text: p.text, caption: null as string | null, analysis: p.analysis };
      })()
    : sc?.messages[i] && { ...sc.messages[i], analysis: undefined as Analysis | undefined };
  if (!step) return false;
  const epoch = caseEpoch;

  if (get().activeConv !== step.conversationId) {
    dispatch({ type: 'setActiveConv', id: step.conversationId, perspective: step.senderId !== get().childId ? step.senderId : undefined });
    await wait(500);
    if (token !== runToken) return false;
  } else if (step.senderId !== get().childId && get().perspective !== step.senderId) {
    dispatch({ type: 'setPerspective', id: step.senderId });
  }
  if (step.caption) dispatch({ type: 'env', patch: { caption: step.caption } });
  if (step.day !== get().simDay) {
    dispatch({ type: 'setDay', day: step.day });
    await wait(500);
    if (token !== runToken) return false;
  }

  const side = sideOf(step.senderId);
  dispatch({ type: 'typing', side, on: true });
  await wait(typingMs(step.text));
  if (token !== runToken) return false;
  dispatch({ type: 'typing', side, on: false });

  const msg: ChatMessage = { id: step.id, kind: 'msg', from: side, conversationId: step.conversationId, senderId: step.senderId, text: step.text, day: step.day, time: step.time };
  dispatch({ type: 'push', message: msg });

  if (preview) {
    if (step.analysis) {
      dispatch({ type: 'analyzing', id: msg.id });
      await wait(700);
      if (token !== runToken) return false;
      dispatch({ type: 'analysis', id: msg.id, analysis: { ...step.analysis, preview: true } });
      if (step.analysis.level >= 1) await wait(2600);
    }
  } else {
    const ok = await postMessage(msg);
    if (!ok) return false;
    if (get().backend === 'inhouse' && step.senderId !== get().childId) {
      const before = get().alerts.length;
      await analyzeConversation(step.conversationId, msg.id, 'auto');
      if (epoch !== caseEpoch || token !== runToken) return false;
      if (get().alerts.length > before) await wait(2600);
    }
  }
  await wait(450);
  if (token !== runToken) return false;
  dispatch({ type: 'setCursor', cursor: i + 1 });
  return true;
}

export async function play() {
  const d = get();
  if (d.playing || d.mode !== 'A' || !d.scenarioId) return;
  const token = ++runToken;
  dispatch({ type: 'setPlaying', playing: true });
  while (get().playing && token === runToken && get().cursor < scriptLength()) {
    const ok = await runStep(get().cursor, token);
    if (!ok) break;
  }
  if (token === runToken) dispatch({ type: 'setPlaying', playing: false });
}

export function pause() {
  runToken++;
  dispatch({ type: 'typing', side: 'predator', on: false });
  dispatch({ type: 'typing', side: 'victim', on: false });
  dispatch({ type: 'setPlaying', playing: false });
}

export async function stepOnce() {
  const d = get();
  if (d.playing || d.mode !== 'A' || !d.scenarioId) return;
  const token = ++runToken;
  dispatch({ type: 'setPlaying', playing: true });
  await runStep(get().cursor, token);
  if (token === runToken) dispatch({ type: 'setPlaying', playing: false });
}

/** Reset clears the synthetic case and its memory on the server too. */
export async function resetDemo() {
  runToken++;
  bumpEpoch();
  const d = get();
  dispatch({ type: 'reset' });
  if (d.mode === 'A' && d.scenarioId) await selectScenario(d.scenarioId);
  else if (d.mode === 'B') {
    try {
      await api.reset('live');
    } catch {
      dispatch({ type: 'env', patch: { serverOnline: false } });
    }
    await hydrateFromServer(true);
  }
}

export async function setMode(mode: Mode) {
  runToken++;
  bumpEpoch();
  dispatch({ type: 'setMode', mode });
  if (mode === 'B') await hydrateFromServer(true);
}

export async function setBackend(backend: Backend) {
  runToken++;
  bumpEpoch();
  const d = get();
  if (d.playing) pause();
  dispatch({ type: 'setBackend', backend });
  // Each backend keeps its own evidence for the same conversations, so results can be compared.
  if (d.scenarioId !== PREVIEW_ID && (d.conversations.length || d.mode === 'B')) await hydrateFromServer(d.mode === 'B');
  if (backend === 'gpt') void refreshChatGPT();
}

export function previewAlert(level: 1 | 2 | 3) {
  dispatch({ type: 'preview', level, id: `preview-${level}-${uid()}` });
}

// ---------- ChatGPT (Sign in with ChatGPT) ----------

export async function refreshChatGPT() {
  try {
    const status = await api.chatgpt.status();
    dispatch({ type: 'chatgpt', patch: { status, error: null } });
    if (status.status === 'connected' && status.sharing && get().chatgpt.models.length === 0) {
      const { models } = await api.chatgpt.models();
      dispatch({ type: 'chatgpt', patch: { models, model: get().chatgpt.model ?? models[0]?.slug ?? null } });
    }
  } catch (e) {
    dispatch({ type: 'chatgpt', patch: { error: e instanceof ApiError ? e.message : String(e) } });
  }
}

export async function chatgptSignIn() {
  dispatch({ type: 'chatgpt', patch: { busy: true, error: null } });
  try {
    await api.chatgpt.signIn();
    // The companion opens the browser; poll until the OAuth callback completes.
    for (let i = 0; i < 90; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const status = await api.chatgpt.status();
      dispatch({ type: 'chatgpt', patch: { status } });
      if (status.status !== 'connecting') break;
    }
    await refreshChatGPT();
  } catch (e) {
    dispatch({ type: 'chatgpt', patch: { error: e instanceof ApiError ? e.message : String(e) } });
  } finally {
    dispatch({ type: 'chatgpt', patch: { busy: false } });
  }
}

export async function chatgptSignOut() {
  try {
    await api.chatgpt.signOut();
  } finally {
    dispatch({ type: 'chatgpt', patch: { models: [], model: null } });
    await refreshChatGPT();
  }
}

export async function chatgptConsent(accepted: boolean) {
  const r = await api.chatgpt.consent(accepted);
  const status = get().chatgpt.status;
  dispatch({ type: 'chatgpt', patch: { status: status ? { ...status, consent: r.consent } : status } });
}

export function selectChatGPTModel(slug: string) {
  dispatch({ type: 'chatgpt', patch: { model: slug } });
}
