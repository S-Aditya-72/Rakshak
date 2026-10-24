// Pure rules for modes, case origin and history initialisation. Kept free of store/network code so they can be
// unit-tested (flow.test.ts) and so the store, the UI and the tests all agree on one definition.

import type { Backend, ChatMessage, Mode, Origin } from '../types';

export type HistoryStatus = 'idle' | 'loading' | 'analyzing' | 'complete' | 'messages_only' | 'failed' | 'cancelled';

export interface HistoryInit {
  status: HistoryStatus;
  /** Batches analysed / total batches in the history. */
  done: number;
  total: number;
  error: string | null;
  /** Case assessment at the moment history analysis completed (before any live message). */
  baseline?: { level: 0 | 1 | 2 | 3; score: number; findings: number } | null;
}

export const HISTORY_IDLE: HistoryInit = { status: 'idle', done: 0, total: 0, error: null, baseline: null };

export const MODE_META: Record<Mode, { name: string; short: string; blurb: string }> = {
  A: { name: 'Guided Demo', short: 'Guided', blurb: 'Scripted examples and case studies, every verdict from the live pipeline' },
  B: { name: 'Continue the Conversation', short: 'Continue', blurb: 'Load an earlier conversation, then type the next messages yourself' },
  C: { name: 'Free Chat', short: 'Free chat', blurb: 'Start a fresh conversation with no history; context builds as you chat' },
};

export const ORIGIN_META: Record<Origin, { label: string; tone: 'blue' | 'teal' | 'green' | 'amber' }> = {
  scripted: { label: 'Scripted playback', tone: 'blue' },
  history: { label: 'Continued from history', tone: 'teal' },
  fresh: { label: 'Fresh conversation', tone: 'green' },
  preview: { label: 'Presentation preview · precomputed, not live AI', tone: 'amber' },
};

export const caseKeyOf = (childId: string, generation: number) => `${childId}#${generation}`;

/** Which mode naturally owns a case of this origin (used to suggest, never to force, a mode switch). */
export const modeForOrigin = (o: Origin | null): Mode | null => (o === 'scripted' || o === 'preview' ? 'A' : o === 'history' ? 'B' : o === 'fresh' ? 'C' : null);

/** People can type only into a live case (history or fresh), only outside the Guided Demo, and never while history is being set up. */
export function canCompose(mode: Mode, origin: Origin | null, init: HistoryInit): boolean {
  if (mode === 'A') return false;
  if (origin !== 'history' && origin !== 'fresh') return false;
  return init.status !== 'loading' && init.status !== 'analyzing';
}

/** Local analysis runs automatically after every saved message, whoever sent it. Cloud analysis never runs automatically. */
export const autoAnalyses = (backend: Backend) => backend === 'inhouse';

export interface Chunk {
  conversationId: string;
  day: number;
  ids: string[];
  lastId: string;
  analysed: boolean;
}

/**
 * Splits the first `checkpoint` messages into analysis batches: consecutive messages from the same conversation on
 * the same simulated day. Batches are analysed in chat order, so cross-chat evidence builds up the way it would have
 * live, without one model call per message.
 */
export function historyChunks(messages: ChatMessage[], checkpoint: number | null): Chunk[] {
  const msgs = messages.filter((m) => m.kind === 'msg' && m.conversationId);
  const hist = checkpoint === null ? msgs : msgs.slice(0, checkpoint);
  const chunks: Chunk[] = [];
  for (const m of hist) {
    const last = chunks[chunks.length - 1];
    if (last && last.conversationId === m.conversationId && last.day === m.day) {
      last.ids.push(m.id);
      last.lastId = m.id;
      last.analysed = last.analysed && !!m.analysis;
    } else {
      chunks.push({ conversationId: m.conversationId!, day: m.day, ids: [m.id], lastId: m.id, analysed: !!m.analysis });
    }
  }
  return chunks;
}

/** Status of a history case as reloaded from the server (e.g. after a refresh), stated honestly. */
export function historyStatusOf(origin: Origin | null, checkpoint: number | null, messages: ChatMessage[], backend: Backend): HistoryInit {
  if (origin !== 'history') return HISTORY_IDLE;
  const chunks = historyChunks(messages, checkpoint);
  const done = chunks.filter((c) => c.analysed).length;
  if (chunks.length > 0 && done === chunks.length) return { status: 'complete', done, total: chunks.length, error: null };
  if (!autoAnalyses(backend)) return { status: 'messages_only', done, total: chunks.length, error: null };
  return { status: 'idle', done, total: chunks.length, error: null };
}

/** Messages saved but not yet covered by any analysis, per conversation (the newest one is what needs a run). */
export function unanalysedTails(messages: ChatMessage[]): { conversationId: string; lastId: string }[] {
  const byConv = new Map<string, ChatMessage[]>();
  for (const m of messages) if (m.kind === 'msg' && m.conversationId) byConv.set(m.conversationId, [...(byConv.get(m.conversationId) ?? []), m]);
  const out: { conversationId: string; lastId: string }[] = [];
  for (const [conversationId, list] of byConv) {
    const last = list[list.length - 1];
    if (!last.analysis) out.push({ conversationId, lastId: last.id });
  }
  return out;
}

// ---------- persisted UI preferences (never case data: the case lives on the server) ----------

export interface Prefs {
  mode?: Mode;
  backend?: Backend;
  sound?: boolean;
  speed?: number;
}

export function parsePrefs(raw: string | null): Prefs {
  if (!raw) return {};
  try {
    const p = JSON.parse(raw) as Record<string, unknown>;
    const out: Prefs = {};
    if (p.mode === 'A' || p.mode === 'B' || p.mode === 'C') out.mode = p.mode;
    if (p.backend === 'inhouse' || p.backend === 'gpt') out.backend = p.backend;
    if (typeof p.sound === 'boolean') out.sound = p.sound;
    if (p.speed === 1 || p.speed === 2 || p.speed === 4) out.speed = p.speed;
    return out;
  } catch {
    return {};
  }
}
