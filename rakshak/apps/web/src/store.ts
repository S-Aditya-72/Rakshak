// Demo state + scripted player.
// Every change is an Action run through `reduce`, and actions are mirrored to other tabs over
// BroadcastChannel, so /predator, /victim and /console can live in separate windows and stay in sync.

import { create } from 'zustand';
import { CONTACT, CUE_ACTIVE_P, WEEKDAYS } from './data/meta';
import { PREVIEW_BY_LEVEL, SCENARIO } from './data/scenario';
import type { AlertItem, Analysis, Backend, ChatMessage, Level, Mode, Side, Stage } from './types';

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
  | { type: 'snapshot'; data: DemoData };

function initial(keep?: Partial<DemoData>): DemoData {
  return {
    mode: 'A',
    backend: 'gpt',
    sound: true,
    speed: 1,
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
  };
}

function buildAlert(id: string, a: Analysis, day: number, time: string, messages: ChatMessage[], preview = false): AlertItem {
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
    contact: CONTACT.hash,
    guardianTitle: a.alert?.guardianTitle ?? '',
    guardianBody: a.alert?.guardianBody ?? '',
    cues,
    preview,
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

function reduce(s: DemoData, a: Action): DemoData {
  switch (a.type) {
    case 'reset':
      return initial({ mode: s.mode, backend: s.backend, sound: s.sound, speed: s.speed });
    case 'setMode':
      return initial({ mode: a.mode, backend: s.backend, sound: s.sound, speed: s.speed });
    case 'setBackend':
      return { ...s, backend: a.backend };
    case 'setSound':
      return { ...s, sound: a.sound };
    case 'setSpeed':
      return { ...s, speed: a.speed };
    case 'setPlaying':
      return { ...s, playing: a.playing };
    case 'setCursor':
      return { ...s, cursor: a.cursor };
    case 'setDay':
      return { ...s, simDay: a.day };
    case 'typing':
      return { ...s, typing: { ...s.typing, [a.side]: a.on } };
    case 'push':
      return { ...s, messages: [...s.messages, a.message] };
    case 'analyzing':
      return { ...s, analyzingId: a.id };
    case 'analysis': {
      const messages = s.messages.map((m) => (m.id === a.id ? { ...m, analysis: a.analysis } : m));
      const msg = messages.find((m) => m.id === a.id)!;
      let next: DemoData = {
        ...s,
        messages,
        analyzingId: null,
        score: a.analysis.score,
        level: Math.max(s.level, a.analysis.level) as Level,
        stage: a.analysis.stage,
        history: [...s.history, { day: msg.day, score: a.analysis.score, level: a.analysis.level }],
      };
      if (a.analysis.level >= 1) {
        next = route(next, buildAlert(`alert-${a.id}`, a.analysis, msg.day, msg.time, messages));
      }
      return next;
    }
    case 'preview': {
      const p = PREVIEW_BY_LEVEL[a.level];
      const fake: ChatMessage[] = SCENARIO.filter((st) => st.analysis && st.analysis.level <= a.level).map((st, i) => ({
        id: `p${i}`,
        kind: 'msg',
        text: st.text,
        day: st.day,
        time: st.time,
        analysis: st.analysis,
      }));
      return route(s, buildAlert(a.id, p.analysis, p.day, p.time, fake, true));
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
  }
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
      if (data.messages.length || data.alerts.length) channel.postMessage({ from: tabId, snapshot: data });
    } else if (msg.snapshot) {
      if (useDemo.getState().data.messages.length === 0) useDemo.setState({ data: msg.snapshot });
    } else if (msg.action) {
      useDemo.setState((st) => ({ data: reduce(st.data, msg.action!) }));
    }
  };
  channel.postMessage({ from: tabId, hello: true });
}

// ---------- scripted player (Mode A) ----------

const dispatch = (a: Action) => useDemo.getState().dispatch(a);
const get = () => useDemo.getState().data;
const uid = () => Math.random().toString(36).slice(2, 10);
let runToken = 0;

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms / get().speed));
const typingMs = (text: string) => Math.min(2200, Math.max(700, 450 + text.length * 26));

async function runStep(i: number, token: number): Promise<boolean> {
  const step = SCENARIO[i];
  if (!step) return false;

  if (step.day !== get().simDay || get().messages.length === 0) {
    dispatch({ type: 'setDay', day: step.day });
    dispatch({
      type: 'push',
      message: { id: uid(), kind: 'day', text: `Day ${step.day} · ${WEEKDAYS[step.day]}`, day: step.day, time: step.time },
    });
    await wait(600);
    if (token !== runToken) return false;
  }

  dispatch({ type: 'typing', side: step.from, on: true });
  await wait(typingMs(step.text));
  if (token !== runToken) return false;
  dispatch({ type: 'typing', side: step.from, on: false });

  const id = uid();
  dispatch({ type: 'push', message: { id, kind: 'msg', from: step.from, text: step.text, day: step.day, time: step.time } });

  if (step.analysis) {
    dispatch({ type: 'analyzing', id });
    await wait(get().backend === 'gpt' ? 1100 : 450);
    if (token !== runToken) return false;
    dispatch({ type: 'analysis', id, analysis: step.analysis });
    if (step.analysis.level >= 1) await wait(2600);
  }
  await wait(450);
  if (token !== runToken) return false;
  dispatch({ type: 'setCursor', cursor: i + 1 });
  return true;
}

export async function play() {
  if (get().playing || get().mode !== 'A') return;
  const token = ++runToken;
  dispatch({ type: 'setPlaying', playing: true });
  while (get().playing && token === runToken && get().cursor < SCENARIO.length) {
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
  if (get().playing || get().mode !== 'A') return;
  const token = ++runToken;
  dispatch({ type: 'setPlaying', playing: true });
  await runStep(get().cursor, token);
  if (token === runToken) dispatch({ type: 'setPlaying', playing: false });
}

export function resetDemo() {
  runToken++;
  dispatch({ type: 'reset' });
}

export function setMode(mode: Mode) {
  runToken++;
  dispatch({ type: 'setMode', mode });
}

export function sendLive(side: Side, text: string) {
  const d = get();
  const now = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (d.messages.length === 0) {
    dispatch({ type: 'push', message: { id: uid(), kind: 'day', text: `Day ${d.simDay} · Today`, day: d.simDay, time: now } });
  }
  dispatch({ type: 'push', message: { id: uid(), kind: 'msg', from: side, text, day: d.simDay, time: now } });
}

export function previewAlert(level: 1 | 2 | 3) {
  dispatch({ type: 'preview', level, id: `preview-${level}-${uid()}` });
}

export const SCRIPT_LENGTH = SCENARIO.length;
