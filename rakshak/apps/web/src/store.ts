// Demo state, the scenario player and the live analysis loop.
// Every change is an Action run through `reduce`, and actions are mirrored to other tabs (BroadcastChannel) and other
// devices (the server's sync relay), so pop-out windows and phones stay in sync. See lib/sync.ts.
// Async work (server calls, model runs) happens only in the tab that started it; its results arrive as actions.
//
// Modes vs cases: `mode` is only what the presenter is looking at (A Guided Demo, B Continue the Conversation,
// C Free Chat). The case itself (people, chats, messages, evidence) lives on the server and has an `origin`
// (scripted, history, fresh, preview). Switching modes never changes or erases the case; replacing it is always an
// explicit action (pick a scenario, load a history, start a new conversation, reset).

import type { RiskState } from '@rakshak/engine';
import type { AnalysisResult, EvidenceEvent } from '@rakshak/shared';
import { create } from 'zustand';
import { BACKEND_META, CHILD, CUE_ACTIVE_P, GUARDIAN, WEEKDAYS } from './data/meta';
import { PREVIEW_BY_LEVEL, SCENARIO as PREVIEW_SCRIPT } from './data/scenario';
import { api, ApiError, rid, type ChatGPTStatus, type Checkpoint, type Health, type ScenarioView, type ServerState } from './lib/api';
import { alertsToFire, alertsToWithdraw, analysisFor, nameMap, riskOf, WITHDRAW_REASON, type CaseInputs } from './lib/case';
import { activeAudience, isGuardianDevice, type Audience } from './lib/device';
import { autoAnalyses, canCompose, caseKeyOf, HISTORY_IDLE, historyChunks, historyStatusOf, parsePrefs, unanalysedTails, type HistoryInit, type Prefs } from './lib/flow';
import { createBus } from './lib/sync';
import type { AlertItem, Analysis, Backend, CaseResponse, ChatMessage, ConversationView, Level, Mode, Notice, Origin, ParticipantView, ResponseKind, Side, Stage } from './types';

/** Id of the offline presentation preview (precomputed analyses, clearly labelled, never presented as live AI). */
export const PREVIEW_ID = 'preview-scripted';

export type HelpTab = 'understand' | 'support' | 'evidence' | 'complaint';

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
  /** Scripted playback: the text being typed on that side's keyboard. */
  drafts: Record<Side, string>;
  /** Read receipts: `${conversationId}:${side}` → last message that side's phone has seen. */
  reads: Record<string, { upto: string; time: string }>;
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
  /** What the child and guardian did about the alerts (button presses), newest last. */
  responses: CaseResponse[];
  /** Help request / SOS from the child, shown on the guardian's phone. */
  guardianNotice: Notice | null;
  /** Check-in from the guardian, shown on the child's phone. */
  childNotice: Notice | null;
  /** Alert whose "Get help" workflow is open (always tied to the alert's own case). */
  helpFor: AlertItem | null;
  helpTab: HelpTab;
  /** Case-study playback paused itself at this guardian alert (once per run), offering review or continue. */
  csHold: string | null;

  // ---- the case ----
  origin: Origin | null;
  /** History cases: how many messages were preloaded (the live conversation starts after this many). */
  checkpoint: number | null;
  /** Server case generation; with childId it identifies this case (alerts carry it). */
  generation: number;
  historyInit: HistoryInit;

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
  | { type: 'typing'; side: Side; on: boolean; draft?: string }
  | { type: 'read'; conversationId: string; side: Side; upto: string; time: string }
  | { type: 'block'; contactId: string; day: number; by?: 'child' | 'guardian'; time?: string }
  /** Guardian devices: the alert summary chat devices publish for them (never message content). */
  | { type: 'project'; state: Partial<DemoData> }
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
  | { type: 'openHelp'; alert: AlertItem; tab?: HelpTab }
  | { type: 'closeHelp' }
  | { type: 'snapshot'; data: DemoData }
  | { type: 'respond'; response: CaseResponse; guardianNotice?: Notice; childNotice?: Notice; system?: ChatMessage }
  | { type: 'clearNotice'; who: 'guardian' | 'child' }
  // real case memory
  | { type: 'hydrate'; state: Partial<DemoData> }
  | { type: 'historyInit'; patch: Partial<HistoryInit> }
  | { type: 'setActiveConv'; id: string; perspective?: string | null }
  | { type: 'setPerspective'; id: string }
  | { type: 'addConversation'; conversation: ConversationView; participants: ParticipantView[] }
  | { type: 'pending'; ids: string[]; on: boolean }
  | { type: 'runApplied'; run: AnalysisResult; analyses: Record<string, Analysis>; evidence: EvidenceEvent[]; firstSeen: Record<string, number>; risk: RiskState; point: { day: number; score: number; level: Level }; fire: AlertItem[]; alerted: Record<string, number>; historical: boolean; withdrawn?: string[] }
  | { type: 'runError'; error: { code: string; message: string } | null; clear?: string[] }
  | { type: 'setRisk'; risk: RiskState; dismissalList?: DemoData['dismissalList']; blocks?: DemoData['blocks'] }
  | { type: 'env'; patch: Partial<Pick<DemoData, 'health' | 'serverOnline' | 'scenarios' | 'caption'>> }
  | { type: 'chatgpt'; patch: Partial<DemoData['chatgpt']> };

// ---------- persisted UI preferences (the case itself is persisted on the server) ----------

const PREFS_KEY = 'rakshak-ui-v1';

function loadPrefs(): Prefs {
  try {
    return typeof localStorage === 'undefined' ? {} : parsePrefs(localStorage.getItem(PREFS_KEY));
  } catch {
    return {};
  }
}

function savePrefs(d: DemoData) {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(PREFS_KEY, JSON.stringify({ mode: d.mode, backend: d.backend, sound: d.sound, speed: d.speed }));
  } catch {
    /* storage unavailable: preferences simply are not remembered */
  }
}

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
    drafts: { predator: '', victim: '' },
    reads: {},
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
    responses: [],
    guardianNotice: null,
    childNotice: null,
    helpFor: null,
    helpTab: 'understand',
    csHold: null,
    origin: null,
    checkpoint: null,
    generation: 0,
    historyInit: HISTORY_IDLE,
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

/** Display name of the protected child in this case. */
export const childNameOf = (d: Pick<DemoData, 'participants' | 'childId'>) => d.participants.find((p) => p.id === d.childId)?.displayName ?? CHILD.name;
export const caseKeyFor = (d: Pick<DemoData, 'childId' | 'generation' | 'origin'>) => (d.origin === 'preview' ? 'preview' : caseKeyOf(d.childId, d.generation));

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
    contactId: 'p-kabir',
    caseKey: 'preview',
    childName: CHILD.name,
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

export function reduce(s: DemoData, a: Action): DemoData {
  switch (a.type) {
    case 'reset':
      return initial(KEEP(s));
    case 'setMode':
      // Navigation only: the case, its messages and its alerts are untouched.
      return { ...s, mode: a.mode };
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
      return { ...s, typing: { ...s.typing, [a.side]: a.on }, drafts: { ...s.drafts, [a.side]: a.on ? a.draft ?? '' : '' } };
    case 'read':
      return { ...s, reads: { ...s.reads, [`${a.conversationId}:${a.side}`]: { upto: a.upto, time: a.time } } };
    case 'block': {
      if (s.blocks.some((b) => b.contactId === a.contactId)) return s;
      const blocks = [...s.blocks, { contactId: a.contactId, day: a.day }];
      // The note in the chat is added by every device that holds the chat (a guardian's phone presses Block without one).
      const conv = s.conversations.find((c) => c.kind === 'private' && c.participantIds.includes(a.contactId));
      const name = s.participants.find((p) => p.id === a.contactId)?.displayName ?? 'this contact';
      const noteId = `sys-block-${a.contactId}`;
      const messages =
        conv && a.by && !s.messages.some((m) => m.id === noteId)
          ? [...s.messages, { id: noteId, kind: 'system' as const, conversationId: conv.id, text: a.by === 'child' ? `You blocked ${name}` : `${GUARDIAN.name} blocked ${name} through RAKSHAK`, day: a.day, time: a.time ?? '' }]
          : s.messages;
      // Devices that hold the evidence re-score with the block (computeRisk is pure); guardian devices only note it.
      if (!s.risk || s.evidence.length === 0) return { ...s, blocks, messages };
      const risk = riskOf(caseInputs({ ...s, blocks }));
      return { ...s, blocks, messages, risk, score: risk.score, level: risk.level, stage: risk.stage };
    }
    case 'project':
      return { ...s, ...a.state };
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
    case 'openHelp':
      return { ...s, helpFor: a.alert, helpTab: a.tab ?? 'understand', guardianSheet: null, critical: null, reportOpen: false };
    case 'closeHelp':
      return { ...s, helpFor: null };
    case 'snapshot':
      return a.data;
    case 'respond': {
      let next: DemoData = { ...s, responses: [...s.responses, a.response] };
      if (a.guardianNotice) next.guardianNotice = a.guardianNotice;
      if (a.childNotice) next.childNotice = a.childNotice;
      if (a.system && !s.messages.some((m) => m.id === a.system!.id)) next.messages = [...s.messages, a.system];
      if (a.response.kind === 'report_done') next = { ...next, critical: null, reportOpen: false };
      return next;
    }
    case 'clearNotice':
      return a.who === 'guardian' ? { ...s, guardianNotice: null } : { ...s, childNotice: null };

    case 'hydrate':
      return { ...s, ...a.state };
    case 'historyInit':
      return { ...s, historyInit: { ...s.historyInit, ...a.patch } };
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
      if (a.withdrawn?.length) {
        // Retracted on a fuller reading: keep the alert in the guardian's history, marked withdrawn, and take it off screen.
        const gone = new Set(a.withdrawn);
        const off = (x: AlertItem | null) => (x && gone.has(x.id) ? null : x);
        next = {
          ...next,
          alerts: next.alerts.map((al) => (gone.has(al.id) ? { ...al, withdrawn: true, withdrawnReason: WITHDRAW_REASON } : al)),
          victimNudge: off(next.victimNudge),
          guardianBanner: off(next.guardianBanner),
          guardianSheet: off(next.guardianSheet),
          critical: off(next.critical),
        };
      }
      // Historical findings are recorded and listed, but not pushed as a storm of pop-ups.
      if (a.historical) next = { ...next, alerts: [...next.alerts, ...a.fire] };
      else for (const al of a.fire) next = route(next, al);
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

// ---------- store + cross-tab / cross-device sync ----------

interface Store {
  data: DemoData;
  dispatch: (a: Action) => void;
}

/** Actions a guardian device may send. Its other actions (opening a sheet, closing a banner) stay on that phone. */
const GUARDIAN_ACTIONS = new Set<Action['type']>(['respond', 'block', 'clearNotice']);

export const useDemo = create<Store>((set) => ({
  data: initial(loadPrefs()),
  dispatch: (a) => {
    set((st) => ({ data: reduce(st.data, a) }));
    if (a.type === 'setMode' || a.type === 'setBackend' || a.type === 'setSound' || a.type === 'setSpeed') savePrefs(useDemo.getState().data);
    if (a.type === 'project') return;
    if (!isGuardianDevice()) bus.post({ action: a }, ['chat']);
    else if (GUARDIAN_ACTIONS.has(a.type)) bus.post({ action: a }, ['chat']);
    scheduleProjection();
  },
}));

type Wire = { from: string; action?: Action; hello?: boolean; aud?: Audience; snapshot?: DemoData; projection?: Partial<DemoData> };

/** Phones only mirror the laptop, so after a dropped connection they take its snapshot even if they hold old data. */
let viewer = false;
let awaitingSnapshot = false;

export function setViewer(on: boolean) {
  viewer = on;
}

const bus = createBus(
  (msg: Wire) => {
    const guardian = isGuardianDevice();
    if (msg.hello) {
      if (guardian) return; // guardian devices hold no case to share
      if (msg.aud && msg.aud !== 'chat') return publishProjection(msg.aud, true);
      const data = useDemo.getState().data;
      if (data.messages.length || data.alerts.length || data.conversations.length) bus.post({ snapshot: data }, ['chat']);
    } else if (msg.projection) {
      if (guardian) useDemo.setState((st) => ({ data: reduce(st.data, { type: 'project', state: msg.projection! }) }));
    } else if (msg.snapshot) {
      if (guardian) return;
      if (useDemo.getState().data.messages.length === 0 || (viewer && awaitingSnapshot)) useDemo.setState({ data: { ...initial(), ...msg.snapshot } });
      awaitingSnapshot = false;
      scheduleProjection();
    } else if (msg.action) {
      useDemo.setState((st) => ({ data: reduce(st.data, msg.action!) }));
      scheduleProjection();
    }
  },
  () => {
    awaitingSnapshot = true;
    sayHello();
  },
);

function sayHello() {
  bus.post({ hello: true, aud: activeAudience() }, ['chat']);
}
sayHello();

/** A device's role changed (a role screen opened): start clean, then ask the chat devices for what this role may see. */
export function resetForRole() {
  useDemo.setState((st) => ({ data: initial({ ...KEEP(st.data), scenarios: [] }) })); // scenarios carry script text
  lastProjection.guardian = lastProjection.critical = '';
  sayHello();
}

// ---------- what guardian devices receive ----------
// Chat devices publish a summary for the guardians whenever it changes: alerts at the guardian's level, the risk
// track behind them, responses and notices. Never messages, drafts, evidence or model output (the relay checks).

const lastProjection: Record<'guardian' | 'critical', string> = { guardian: '', critical: '' };
let projectionTimer: ReturnType<typeof setTimeout> | undefined;

function scheduleProjection() {
  if (isGuardianDevice()) return;
  clearTimeout(projectionTimer);
  projectionTimer = setTimeout(() => {
    publishProjection('guardian');
    publishProjection('critical');
  }, 120);
}

function publishProjection(aud: Audience, force = false) {
  if (aud === 'chat' || isGuardianDevice()) return;
  const state = projectFor(useDemo.getState().data, aud);
  const json = JSON.stringify(state);
  if (!force && json === lastProjection[aud]) return;
  lastProjection[aud] = json;
  bus.post({ projection: state }, [aud]);
}

/** The guardian's view of the case. "critical": a temporary guardian who only gets Level 3. */
export function projectFor(d: DemoData, aud: 'guardian' | 'critical'): Partial<DemoData> {
  const min = aud === 'critical' ? 3 : 2; // Level 1 nudges stay private to the child
  const alerts = d.alerts.filter((a) => a.level >= min);
  const visible = alerts.length > 0;
  return {
    mode: d.mode,
    sound: d.sound,
    scenarioId: d.scenarioId,
    origin: d.origin,
    generation: d.generation,
    childId: d.childId,
    simDay: d.simDay,
    participants: d.participants,
    alerts,
    score: visible ? d.score : 0,
    level: visible ? d.level : 0,
    stage: visible ? d.stage : 'rapport',
    history: visible ? d.history : [],
    risk: visible && d.risk ? { ...d.risk, tracks: d.risk.tracks.filter((t) => t.level >= min) } : null,
    dismissals: d.dismissals,
    guardianBanner: d.guardianBanner && d.guardianBanner.level >= min ? d.guardianBanner : null,
    critical: d.critical,
    guardianNotice: aud === 'critical' && d.guardianNotice?.tone !== 'urgent' ? null : d.guardianNotice,
    responses: d.responses,
    blocks: d.blocks,
  };
}

// ---------- helpers ----------

const dispatch = (a: Action) => useDemo.getState().dispatch(a);
const get = () => useDemo.getState().data;
const uid = () => Math.random().toString(36).slice(2, 10);
const apiBackend = (b: Backend) => BACKEND_META[b].api;
let runToken = 0;
/** Bumped whenever the case is replaced (reset, scenario/history load, new conversation) or the backend switches. */
let caseEpoch = 0;
let inflight = new AbortController();
/** Bumped to stop a running history initialisation (cancel, or another case replaced it). */
let initToken = 0;
/** scenario@checkpoint of the history load in progress, so a double click does not start a second one. */
let historyLoadKey: string | null = null;

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms / get().speed));
export const typingMs = (text: string) => Math.min(2200, Math.max(700, 450 + text.length * 26));
const nowTime = () => new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

function caseInputs(d: DemoData, patch: Partial<CaseInputs> = {}): CaseInputs {
  return { childId: d.childId, evidence: d.evidence, firstSeen: d.firstSeen, dismissals: d.dismissalList, blocks: d.blocks, simDay: d.simDay, participants: d.participants, ...patch };
}

function sideOf(senderId: string): Side {
  return senderId === get().childId ? 'victim' : 'predator';
}

function bumpEpoch() {
  caseEpoch++;
  initToken++;
  inflight.abort();
  inflight = new AbortController();
}

function errOf(e: unknown) {
  return e instanceof ApiError ? { code: e.code, message: e.message } : { code: 'internal', message: String(e) };
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

/** First load / refresh: restore whatever case the server holds, in whatever mode was last selected. Never resets. */
export async function bootstrap() {
  const health = await refreshHealth();
  if (!health) return;
  try {
    const scenarios = await api.scenarios();
    dispatch({ type: 'env', patch: { scenarios } });
  } catch {
    /* listed later */
  }
  if (get().origin !== 'preview' && get().messages.length === 0) await hydrateFromServer();
}

/** Load the persisted case (conversations, messages, evidence, history, origin) for the active backend. */
export async function hydrateFromServer() {
  const epoch = caseEpoch;
  let st: ServerState;
  try {
    st = await api.state(apiBackend(get().backend));
  } catch {
    dispatch({ type: 'env', patch: { serverOnline: false } });
    return;
  }
  if (epoch !== caseEpoch) return;
  applyServerState(st);
}

/** Case studies are stored (and analysed) under neutral names; people on screen see the real case identities. */
function shownNames(sc: ScenarioView | undefined) {
  const cs = sc?.kind === 'case_study';
  const people = new Map<string, string>(cs ? [[sc.child.id, sc.child.name], ...sc.participants.map((p): [string, string] => [p.id, p.name])] : []);
  const titles = new Map<string, string>(cs ? sc.conversations.map((c): [string, string] => [c.id, c.title]) : []);
  return { person: (id: string, stored: string) => people.get(id) ?? stored, title: (id: string, stored: string) => titles.get(id) ?? stored };
}

function applyServerState(st: ServerState) {
  const d = get();
  const meta = st.case ?? { generation: 0, scenarioId: st.scenarioId, origin: null, checkpoint: null };
  const shown = shownNames(d.scenarios.find((s) => s.id === (meta.scenarioId ?? st.scenarioId)));
  const participants: ParticipantView[] = st.participants.map((p) => ({ id: p.id, displayName: shown.person(p.id, p.displayName), role: p.role }));
  const conversations: ConversationView[] = st.conversations.map((c) => ({ id: c.id, kind: c.kind, title: shown.title(c.id, c.title), participantIds: c.participantIds }));
  const backend = d.backend;
  const origin: Origin | null = meta.origin ?? (st.scenarioId ? 'scripted' : st.messages.length || st.conversations.length ? 'fresh' : null);
  const caseKey = caseKeyOf(st.child.id, meta.generation);
  const childName = shown.person(st.child.id, st.child.displayName);
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
  // Notes ("Amma blocked Kabir"), undelivered messages and photos live only on the devices, not on the server: keep them.
  const local = new Map(d.messages.map((m) => [m.id, m]));
  messages = messages.map((m) => (local.get(m.id)?.image ? { ...m, image: local.get(m.id)!.image } : m));
  const known = new Set(messages.map((m) => m.id));
  messages = [...messages, ...d.messages.filter((m) => (m.kind === 'system' || m.undelivered) && !known.has(m.id))];
  const lastMsg = st.messages[st.messages.length - 1];
  const activeConv = d.activeConv && conversations.some((c) => c.id === d.activeConv) ? d.activeConv : lastMsg?.conversationId ?? conversations[0]?.id ?? null;
  const alerts: AlertItem[] = st.alerts.map((a) => {
    const track = risk.tracks.find((t) => t.key === a.trackKey);
    return {
      id: a.id,
      level: a.level as 1 | 2 | 3,
      day: a.day,
      time: a.time,
      stage: track?.stage ?? risk.stage,
      score: track?.score ?? risk.score,
      contact: a.trackKey,
      guardianTitle: a.title,
      guardianBody: a.body,
      cues: (track?.cues ?? []).map((c) => ({ cue: c.cue, day: c.day })),
      category: a.trackKey === 'bullying' ? 'bullying' : 'grooming',
      trackKey: a.trackKey,
      contactId: track?.contactId ?? undefined,
      caseKey,
      childName,
      historical: !!a.historical,
      evidenceKeys: (track?.cues ?? []).map((c) => c.evidenceKey),
      withdrawn: !!a.withdrawn,
      withdrawnReason: a.withdrawn ? a.withdrawnReason ?? WITHDRAW_REASON : undefined,
    };
  });
  const scenarioId = meta.scenarioId ?? st.scenarioId ?? null;
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
    scenarioId,
    origin,
    checkpoint: meta.checkpoint,
    generation: meta.generation,
    // Scripted playback saves messages in script order, so the saved count is where playback resumes.
    cursor: origin === 'scripted' ? st.messages.length : d.cursor,
    historyInit: d.historyInit.status === 'analyzing' || d.historyInit.status === 'loading' ? d.historyInit : historyStatusOf(origin, meta.checkpoint, messages, backend),
    pending: [],
    runError: null,
  };
  dispatch({ type: 'hydrate', state });
  if (activeConv) dispatch({ type: 'setActiveConv', id: activeConv });
}

// ---------- analysis loop ----------

/** Run real analysis for one conversation up to a message. Local: automatic. ChatGPT: owner button only. */
export async function analyzeConversation(conversationId: string, uptoMessageId: string | undefined, trigger: 'auto' | 'owner_button', opts: { historical?: boolean } = {}) {
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
    if (epoch !== caseEpoch || get().backend !== backend) return false; // stale: case replaced or backend switched meanwhile
    if (resp.result.stale) {
      dispatch({ type: 'pending', ids: waitingIds, on: false });
      return false; // a newer run covers these messages
    }
    applyRun(resp.result as AnalysisResult, resp.evidence as EvidenceEvent[], resp.firstSeen ?? {}, !!opts.historical);
    return true;
  } catch (e) {
    if (epoch !== caseEpoch) return false;
    const err = errOf(e);
    if (err.code === 'aborted') return false;
    dispatch({ type: 'runError', error: err, clear: waitingIds.concat(uptoMessageId ? [uptoMessageId] : []) });
    if (err.code === 'server_offline') dispatch({ type: 'env', patch: { serverOnline: false } });
    return false;
  }
}

function applyRun(run: AnalysisResult, evidence: EvidenceEvent[], firstSeen: Record<string, number>, historical: boolean) {
  const d = get();
  const inputs = caseInputs(d, { evidence, firstSeen });
  const risk = riskOf(inputs);
  const analyses: Record<string, Analysis> = {};
  for (const id of run.focusMessageIds) analyses[id] = analysisFor(id, run, evidence, risk, d.backend);
  const lastFocus = d.messages.find((m) => m.id === run.focusMessageIds[run.focusMessageIds.length - 1]);
  const day = lastFocus?.day ?? d.simDay;
  const names = nameMap(d.participants);
  const childName = childNameOf(d);
  const caseKey = caseKeyFor(d);
  // Alerts whose evidence was retracted are withdrawn first, which re-arms their track for new confirmed evidence.
  const withdrawn = historical ? [] : alertsToWithdraw(d.alerts, evidence, risk);
  const alertedBase = { ...d.alerted };
  for (const w of withdrawn) if (w.trackKey) delete alertedBase[w.trackKey];
  const { items, next } = alertsToFire(risk, alertedBase, { day, time: lastFocus?.time ?? nowTime(), childName, names, runId: run.analysisId });
  const fire = items.map((a) => ({ ...a, caseKey, childName, historical, evidenceKeys: risk.tracks.find((t) => t.key === a.trackKey)?.cues.map((c) => c.evidenceKey) ?? [] }));
  dispatch({ type: 'runApplied', run, analyses, evidence, firstSeen, risk, point: { day, score: risk.score, level: risk.level }, fire, alerted: next, historical, withdrawn: withdrawn.map((w) => w.id) });
  // Persist the deterministic outputs next to the evidence (fire-and-forget; the server de-duplicates alerts).
  const b = apiBackend(d.backend);
  api.snapshot(d.childId, { backend: b, runId: run.analysisId, day, score: risk.score, level: risk.level, stage: risk.stage, category: risk.category, dominantTrack: risk.dominantTrack, trace: risk.trace, evidenceKeys: evidence.filter((e) => e.status === 'active' || e.status === 'needs_review').map((e) => e.key) }).catch(() => {});
  for (const w of withdrawn) api.withdrawAlert(d.childId, w.id, { backend: b, reason: WITHDRAW_REASON }).catch(() => {});
  for (const a of fire) api.alert(d.childId, { id: a.id, backend: b, trackKey: a.trackKey, level: a.level, day: a.day, time: a.time, title: a.guardianTitle, body: a.guardianBody, historical }).catch(() => {});
}

function recomputeRisk(patch: Partial<CaseInputs> = {}) {
  const d = get();
  const risk = riskOf(caseInputs(d, patch));
  dispatch({ type: 'setRisk', risk, dismissalList: patch.dismissals, blocks: patch.blocks });
}

/** Local backend only: analyse whatever was saved but never covered by a run (e.g. the child's last reply). */
async function analyseTails(opts: { historical?: boolean } = {}) {
  if (!autoAnalyses(get().backend)) return;
  for (const t of unanalysedTails(get().messages)) await analyzeConversation(t.conversationId, t.lastId, 'auto', opts);
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

// ---------- responses to alerts (the buttons on the alerts) ----------

function responseLabel(kind: ResponseKind, child: string): string {
  return {
    child_help: `${child} asked to talk to ${GUARDIAN.name}`,
    child_sos: `${child} sent an SOS to ${GUARDIAN.name}`,
    child_block: `${child} blocked the contact`,
    child_photo_held: `${child} chose not to send a photo after RAKSHAK's warning`,
    child_photo_sent: `${child} sent a photo after RAKSHAK's warning`,
    guardian_talk: `${GUARDIAN.name} sent ${child} a check-in`,
    guardian_block: `${GUARDIAN.name} blocked the contact`,
    guardian_counsellor: 'School counsellor notified (cue types and dates only)',
    guardian_trusted: 'Trusted adult alerted',
    guardian_call: `${GUARDIAN.name} opened the dialer for 1930`,
    report_done: 'Guided report completed',
  }[kind];
}

/** Record a button press and deliver its effect to the other phones (the action is mirrored like any other). */
export function respond(kind: ResponseKind, alertId?: string, extra: { guardianNotice?: Notice; childNotice?: Notice; system?: ChatMessage } = {}) {
  const d = get();
  const child = childNameOf(d);
  const response: CaseResponse = { id: `r-${uid()}`, kind, by: kind.startsWith('child') ? 'child' : 'guardian', label: responseLabel(kind, child), day: d.simDay, time: nowTime(), alertId };
  const notice = (tone: Notice['tone'], title: string, body: string): Notice => ({ id: `n-${uid()}`, tone, title, body, time: response.time });
  const auto =
    kind === 'child_help'
      ? { guardianNotice: notice('calm', `${child} would like to talk`, `Sent from RAKSHAK on ${child}'s phone. None of their messages are shared.`) }
      : kind === 'child_sos'
        ? { guardianNotice: notice('urgent', `${child} needs you now`, `SOS from RAKSHAK on ${child}'s phone. Call them or go to them.`) }
        : kind === 'child_photo_sent'
          ? { guardianNotice: notice('warn', `${child} sent a photo`, `A photo was sent in a chat RAKSHAK flagged, after a warning. The photo itself is not shared with you.`) }
          : kind === 'guardian_talk'
            ? { childNotice: notice('calm', GUARDIAN.name, `Hey ${child}, can we talk this evening? You're not in trouble. 💛`) }
            : {};
  dispatch({ type: 'respond', response, ...auto, ...extra });
}

/** The child answered the guardian's check-in. */
export function replyToGuardian(text: string) {
  const time = nowTime();
  const child = childNameOf(get());
  dispatch({ type: 'clearNotice', who: 'child' });
  dispatch({
    type: 'respond',
    response: { id: `r-${uid()}`, kind: 'child_help', by: 'child', label: `${child} replied: ${text}`, day: get().simDay, time },
    guardianNotice: { id: `n-${uid()}`, tone: 'calm', title: `${child} replied`, body: text, time },
  });
}

export function isBlocked(contactId: string | null | undefined): boolean {
  return !!contactId && get().blocks.some((b) => b.contactId === contactId);
}

/**
 * Block a contact, from the child's nudge or the guardian's alert. The engine records it (a brand-new contact right
 * after a block is flagged for review), the chat shows a note, and in live chat the contact's messages stop arriving.
 */
export function blockContact(contactId: string | undefined, by: 'child' | 'guardian', alertId?: string) {
  const d = get();
  if (!contactId || isBlocked(contactId)) return;
  respond(by === 'child' ? 'child_block' : 'guardian_block', alertId);
  dispatch({ type: 'block', contactId, day: d.simDay, by, time: nowTime() });
  if (d.scenarioId !== PREVIEW_ID) api.block(d.childId, { contactId, day: d.simDay }).catch(() => {}); // the preview has no server case
}

/** Child tapped "Block" in a nudge: blocks the contact of the open private chat. */
export function blockActiveContact() {
  const d = get();
  const conv = d.conversations.find((c) => c.id === d.activeConv);
  blockContact(conv?.kind === 'private' ? conv.participantIds.find((p) => p !== d.childId) : undefined, 'child', d.victimNudge?.id);
}

/** Block from the guardian's Get help panel: the same block as the alert's button, shared with every phone. */
export function recordBlock(contactId: string, alertId?: string) {
  blockContact(contactId, 'guardian', alertId);
}

// ---------- messages ----------

async function postMessage(m: ChatMessage) {
  try {
    await api.addMessage({ id: m.id, conversationId: m.conversationId!, senderId: m.senderId!, day: m.day, time: m.time, text: m.text });
    return true;
  } catch (e) {
    const err = errOf(e);
    dispatch({ type: 'runError', error: { code: err.code, message: `Message not saved: ${err.message}` } });
    if (err.code === 'server_offline') dispatch({ type: 'env', patch: { serverOnline: false } });
    return false;
  }
}

/** Modes B and C: a person typed a message on one of the phones. */
export async function sendLive(side: Side, text: string, conversationId?: string, image?: string) {
  const d = get();
  if (!canCompose(d.mode, d.origin, d.historyInit)) return;
  const convId = conversationId ?? d.activeConv;
  if (!convId) return;
  const senderId = side === 'victim' ? d.childId : d.perspective;
  if (!senderId) return;
  const m: ChatMessage = { id: `m-${uid()}${uid()}`, kind: 'msg', from: side, conversationId: convId, senderId, text, day: d.simDay, time: nowTime(), ...(image ? { image } : {}) };
  dispatch({ type: 'typing', side, on: false });
  const conv = d.conversations.find((c) => c.id === convId);
  if (side === 'predator' && conv?.kind === 'private' && isBlocked(senderId)) {
    // Blocked: the contact sees "Not delivered"; the child never receives it and nothing is analysed.
    dispatch({ type: 'push', message: { ...m, undelivered: true } });
    return;
  }
  dispatch({ type: 'push', message: m });
  const ok = await postMessage(m);
  // Every saved message is eligible for local contextual reassessment, including the child's own objections and
  // clarifications (the engine never scores the child's own messages against the child). Rapid messages are
  // coalesced by the server into one run that covers all of them. ChatGPT never runs from typing: owner button only.
  if (ok && autoAnalyses(d.backend)) void analyzeConversation(convId, m.id, 'auto');
}

/** A phone's keyboard: "typing…" on the other phone while someone types (live chat). */
let typingOff: ReturnType<typeof setTimeout> | undefined;
export function typingLive(side: Side) {
  if (!get().typing[side]) dispatch({ type: 'typing', side, on: true });
  clearTimeout(typingOff);
  typingOff = setTimeout(() => dispatch({ type: 'typing', side, on: false }), 2500);
}

/** A phone has this chat open and on screen: the other side's messages up to `upto` are read. */
export function markRead(conversationId: string, side: Side, upto: string) {
  const r = get().reads[`${conversationId}:${side}`];
  if (r?.upto === upto) return;
  dispatch({ type: 'read', conversationId, side, upto, time: nowTime() });
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

// ---------- mode navigation ----------

/** Switch the view. Never resets or replaces the case; stops scripted playback when leaving the Guided Demo. */
export function setMode(mode: Mode) {
  if (mode !== 'A' && get().playing) pause();
  dispatch({ type: 'setMode', mode });
}

// ---------- Mode B: continue a conversation from history ----------

/**
 * Explicit "Load history": saves the scenario's messages up to a checkpoint on the server (idempotent), then
 * analyses them in batches with the local pipeline. Cloud: messages only, until the owner presses Analyze.
 */
export async function loadHistory(scenarioId: string, target: { checkpoint?: string; upto?: number }, opts: { force?: boolean } = {}) {
  const d0 = get();
  const busy = d0.historyInit.status === 'loading' || d0.historyInit.status === 'analyzing';
  const n = target.upto ?? d0.scenarios.find((s) => s.id === scenarioId)?.checkpoints.find((c) => c.id === target.checkpoint)?.after;
  const key = `${scenarioId}@${n}`;
  const same = (d0.scenarioId === scenarioId && d0.origin === 'history' && d0.checkpoint === n) || historyLoadKey === key;
  if (busy && same && !opts.force) return; // a repeated click while the same history is still being set up
  historyLoadKey = key;
  if (d0.playing) pause();
  runToken++;
  initToken++;
  dispatch({ type: 'historyInit', patch: { status: 'loading', done: 0, total: 0, error: null } });
  let out;
  try {
    out = await api.loadHistory(scenarioId, target, opts.force);
  } catch (e) {
    const err = errOf(e);
    historyLoadKey = null;
    dispatch({ type: 'historyInit', patch: { status: 'failed', error: `History not loaded: ${err.message}` } });
    if (err.code === 'server_offline') dispatch({ type: 'env', patch: { serverOnline: false } });
    return;
  }
  if (!out.reused) {
    bumpEpoch();
    dispatch({ type: 'reset' });
  }
  dispatch({ type: 'hydrate', state: { scenarioId, mode: 'B' } });
  savePrefs(get());
  await hydrateFromServer();
  try {
    await initHistory();
  } finally {
    if (historyLoadKey === key) historyLoadKey = null;
  }
}

/** Analyse the preloaded history batch by batch (bounded, sequential, resumable). Already analysed batches are skipped. */
export async function initHistory() {
  const token = ++initToken;
  const epoch = caseEpoch;
  const d = get();
  if (d.origin !== 'history') return;
  const chunks = historyChunks(d.messages, d.checkpoint);
  const total = chunks.length;
  let done = chunks.filter((c) => c.analysed).length;
  if (!autoAnalyses(d.backend)) {
    dispatch({ type: 'historyInit', patch: { status: done === total && total > 0 ? 'complete' : 'messages_only', done, total, error: null } });
    return;
  }
  dispatch({ type: 'historyInit', patch: { status: 'analyzing', done, total, error: null } });
  for (const c of chunks) {
    if (c.analysed) continue;
    const ok = await analyzeConversation(c.conversationId, c.lastId, 'auto', { historical: true });
    if (token !== initToken || epoch !== caseEpoch) return; // cancelled or replaced: the newer action owns the status
    if (!ok) {
      const err = get().runError;
      dispatch({ type: 'historyInit', patch: { status: 'failed', done, total, error: err ? `${err.message}` : 'Analysis of this part of the history did not complete.' } });
      return;
    }
    done++;
    dispatch({ type: 'historyInit', patch: { done } });
  }
  const after = get();
  const baseline = { level: after.level, score: after.score, findings: after.evidence.filter((e) => e.status === 'active').length };
  dispatch({ type: 'historyInit', patch: { status: 'complete', done, total, error: null, baseline } });
}

/** Stop after the batch that is already running (its result is real and is kept). Resume with initHistory(). */
export function cancelHistoryInit() {
  if (get().historyInit.status !== 'analyzing') return;
  initToken++;
  dispatch({ type: 'historyInit', patch: { status: 'cancelled' } });
}

/** Mode A → B: keep the played case exactly as it is and continue it live from the current point. */
export async function continueLiveFromHere() {
  const d = get();
  if (d.origin !== 'scripted' || d.cursor === 0) return;
  pause();
  try {
    const meta = await api.continueCase(d.childId);
    dispatch({ type: 'hydrate', state: { origin: 'history', checkpoint: meta.checkpoint, generation: meta.generation, mode: 'B', caption: null, csHold: null } });
    savePrefs(get());
  } catch (e) {
    dispatch({ type: 'runError', error: errOf(e) });
    return;
  }
  // Playback analyses after other participants' messages; a trailing child reply is analysed now.
  dispatch({ type: 'historyInit', patch: historyStatusOf('history', get().checkpoint, get().messages, get().backend) });
  if (autoAnalyses(get().backend)) await initHistory();
}

// ---------- Mode C: fresh conversation ----------

/** Explicit "Start new conversation": a new case with no preloaded messages and one default contact. */
export async function startFreshConversation() {
  if (get().playing) pause();
  runToken++;
  bumpEpoch();
  dispatch({ type: 'reset' });
  dispatch({ type: 'hydrate', state: { mode: 'C', scenarioId: null } });
  savePrefs(get());
  try {
    await api.reset('live');
  } catch {
    dispatch({ type: 'env', patch: { serverOnline: false } });
    return;
  }
  await hydrateFromServer();
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

/** Checkpoint defined at the current playback position, if any. */
export function checkpointAt(sc: ScenarioView | null, n: number): Checkpoint | null {
  return sc?.checkpoints.find((c) => c.after === n) ?? null;
}

/** Load a scenario for playback: resets the case on the server and creates its people and chats. True if loaded. */
export async function selectScenario(id: string): Promise<boolean> {
  runToken++;
  bumpEpoch();
  csHoldDone = false;
  const keep = get();
  dispatch({ type: 'reset' });
  if (id === PREVIEW_ID) {
    dispatch({ type: 'hydrate', state: { scenarioId: PREVIEW_ID, origin: 'preview', ...previewCast() } });
    dispatch({ type: 'setActiveConv', id: 'preview-c-kabir' });
    return true;
  }
  try {
    const sc = await api.loadScenario(id);
    const participants: ParticipantView[] = [{ id: sc.child.id, displayName: sc.child.name, role: 'protected_child' }, ...sc.participants.map((p) => ({ id: p.id, displayName: p.name, role: p.role }))];
    const conversations: ConversationView[] = sc.conversations.map((c) => ({ id: c.id, kind: c.kind, title: c.title, participantIds: c.participants }));
    dispatch({ type: 'hydrate', state: { scenarioId: id, origin: 'scripted', childId: sc.child.id, participants, conversations, activeConv: sc.messages[0]?.conversationId ?? conversations[0]?.id ?? null } });
    dispatch({ type: 'setActiveConv', id: sc.messages[0]?.conversationId ?? conversations[0].id });
    // The generation identifies this case for its alerts.
    await hydrateFromServer();
    return get().serverOnline !== false;
  } catch (e) {
    dispatch({ type: 'hydrate', state: { scenarioId: keep.scenarioId } });
    dispatch({ type: 'runError', error: { code: 'server_offline', message: e instanceof ApiError ? e.message : 'Could not load scenario' } });
    return false;
  }
}

// ---------- case-study playback ----------

let csStarting = false;
/** The current case-study run already paused at its first guardian alert (reset whenever the case is loaded again). */
let csHoldDone = false;

/**
 * "Play reconstruction": load this case study, confirm it is the case now loaded, then start Mode A playback.
 * Returns null once playback has started, or an error message (nothing is played on failure). Clicks while it is
 * starting are ignored. Cloud analysis still waits for the owner's explicit "Analyze with ChatGPT".
 */
export async function playCaseStudy(id: string): Promise<string | null> {
  if (csStarting) return null;
  csStarting = true;
  try {
    if (get().playing) pause();
    setMode('A');
    const ok = await selectScenario(id);
    const d = get();
    if (!ok || d.scenarioId !== id || d.origin !== 'scripted' || d.cursor !== 0) {
      return d.runError?.message ?? 'The reconstruction did not load. Check that the inference service is running, then try again.';
    }
    void play();
    return null;
  } finally {
    csStarting = false;
  }
}

/** Case-study playback only, once per run: stop at the first new guardian-level alert so it can be reviewed. */
function holdAtGuardianAlert(before: Set<string>): boolean {
  const d = get();
  if (csHoldDone || d.origin !== 'scripted' || currentScenario()?.kind !== 'case_study') return false;
  const alert = d.alerts.find((a) => !before.has(a.id) && a.level >= 2 && !a.historical && !a.withdrawn);
  if (!alert) return false;
  csHoldDone = true;
  pause();
  dispatch({ type: 'hydrate', state: { csHold: alert.id } });
  return true;
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
  dispatch({ type: 'typing', side, on: true, draft: step.text });
  await wait(typingMs(step.text));
  if (token !== runToken) return false;
  dispatch({ type: 'typing', side, on: false });

  const msg: ChatMessage = { id: step.id, kind: 'msg', from: side, conversationId: step.conversationId, senderId: step.senderId, text: step.text, day: step.day, time: step.time };
  dispatch({ type: 'push', message: msg });

  if (preview) {
    dispatch({ type: 'setCursor', cursor: i + 1 });
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
    // The cursor counts saved messages, so pausing mid-analysis never leaves a saved message "unplayed".
    dispatch({ type: 'setCursor', cursor: i + 1 });
    // Playback keeps its pace by analysing after other participants' messages. A child reply is still assessed:
    // it is in the focus of the next run (everything since the last analysed message), and a trailing child reply
    // is analysed when playback stops (see play()).
    if (autoAnalyses(get().backend) && step.senderId !== get().childId) {
      const before = new Set(get().alerts.map((a) => a.id));
      await analyzeConversation(step.conversationId, msg.id, 'auto');
      if (epoch !== caseEpoch || token !== runToken) return false;
      if (get().alerts.length > before.size) {
        if (holdAtGuardianAlert(before)) return false;
        await wait(2600);
      }
    }
  }
  await wait(450);
  return token === runToken;
}

export async function play() {
  const d = get();
  if (d.playing || d.mode !== 'A' || !d.scenarioId || (d.origin !== 'scripted' && d.origin !== 'preview')) return;
  const token = ++runToken;
  const epoch = caseEpoch;
  if (d.csHold) dispatch({ type: 'hydrate', state: { csHold: null } });
  dispatch({ type: 'setPlaying', playing: true });
  while (get().playing && token === runToken && get().cursor < scriptLength()) {
    const ok = await runStep(get().cursor, token);
    if (!ok) break;
  }
  if (token === runToken) dispatch({ type: 'setPlaying', playing: false });
  if (epoch === caseEpoch && get().origin === 'scripted') await analyseTails();
}

export function pause() {
  runToken++;
  dispatch({ type: 'typing', side: 'predator', on: false });
  dispatch({ type: 'typing', side: 'victim', on: false });
  dispatch({ type: 'setPlaying', playing: false });
}

export async function stepOnce() {
  const d = get();
  if (d.playing || d.mode !== 'A' || !d.scenarioId || (d.origin !== 'scripted' && d.origin !== 'preview')) return;
  const token = ++runToken;
  dispatch({ type: 'setPlaying', playing: true });
  await runStep(get().cursor, token);
  if (token === runToken) dispatch({ type: 'setPlaying', playing: false });
}

/** Explicit reset: restarts the current case from its own starting point and clears its memory on the server. */
export async function resetDemo() {
  const d = get();
  runToken++;
  if (d.origin === 'scripted' || d.origin === 'preview') return selectScenario(d.scenarioId!);
  if (d.origin === 'history' && d.scenarioId) {
    const sc = d.scenarios.find((s) => s.id === d.scenarioId);
    const cp = sc?.checkpoints.find((c) => c.after === d.checkpoint);
    return loadHistory(d.scenarioId, cp ? { checkpoint: cp.id } : { upto: d.checkpoint ?? 1 }, { force: true });
  }
  if (d.origin === 'fresh') return startFreshConversation();
  bumpEpoch();
  dispatch({ type: 'reset' });
}

export async function setBackend(backend: Backend) {
  runToken++;
  bumpEpoch();
  const d = get();
  if (d.playing) pause();
  dispatch({ type: 'setBackend', backend });
  // Each backend keeps its own evidence for the same conversations, so results can be compared. Never a silent
  // fallback: switching to cloud loads the case without running anything.
  if (d.origin !== 'preview' && d.conversations.length) {
    dispatch({ type: 'historyInit', patch: HISTORY_IDLE });
    await hydrateFromServer();
  }
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
