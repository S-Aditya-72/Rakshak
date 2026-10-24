// Store transitions with the HTTP client mocked. These check state bookkeeping (modes, case origin, history
// initialisation, reassessment triggers, alert routing); they say nothing about model accuracy.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls: { analyze: { conversationId: string; uptoMessageId?: string; backend: string; trigger: string }[]; history: number; reset: number; addMessage: number } = { analyze: [], history: 0, reset: 0, addMessage: 0 };
let serverState: any;
let failAnalyze = false;

const scenario = {
  id: 's2-bullying',
  number: 2,
  kind: 'core',
  caseStudy: null,
  title: 'Cyberbullying',
  subtitle: '',
  tests: '',
  intro: '',
  child: { id: 'p-meera', name: 'Meera' },
  participants: [{ id: 'p-dev', name: 'Dev', role: 'peer' }],
  conversations: [{ id: 'c1', kind: 'private', title: 'Dev', participants: ['p-meera', 'p-dev'] }],
  messages: [
    { id: 's2-bullying-m01', conversationId: 'c1', senderId: 'p-dev', day: 1, time: '1', text: 'one' },
    { id: 's2-bullying-m02', conversationId: 'c1', senderId: 'p-meera', day: 1, time: '2', text: 'two' },
    { id: 's2-bullying-m03', conversationId: 'c1', senderId: 'p-dev', day: 2, time: '3', text: 'three' },
    { id: 's2-bullying-m04', conversationId: 'c1', senderId: 'p-dev', day: 3, time: '4', text: 'future line' },
  ],
  checkpoints: [{ id: 'cp', after: 3, label: 'Day 2', intro: '', suggestions: ['presenter idea'] }],
  presenter: [],
};

function stateWith(messages: any[], origin: string | null, checkpoint: number | null, generation = 1) {
  return {
    child: { id: 'p-meera', displayName: 'Meera', role: 'protected_child' },
    participants: [
      { id: 'p-meera', displayName: 'Meera', role: 'protected_child' },
      { id: 'p-dev', displayName: 'Dev', role: 'peer' },
    ],
    conversations: [{ id: 'c1', childId: 'p-meera', kind: 'private', title: 'Dev', participantIds: ['p-meera', 'p-dev'] }],
    messages: messages.map((m, i) => ({ ...m, seq: i + 1 })),
    evidence: [],
    runs: [],
    snapshots: [],
    alerts: [],
    alerted: {},
    dismissals: [],
    blocks: [],
    firstSeen: {},
    scenarioId: origin === 'fresh' ? null : 's2-bullying',
    case: { generation, scenarioId: origin === 'fresh' ? null : 's2-bullying', origin, checkpoint },
  };
}

function runFor(conversationId: string, focus: string[]) {
  return {
    schemaVersion: 'rakshak.analysis.v1',
    analysisId: `run-${calls.analyze.length}`,
    requestId: 'r',
    backend: 'local_hybrid',
    models: { contextual: 'fake', classifier: 'fake' },
    childId: 'p-meera',
    conversationId,
    analyzedMessageIds: focus,
    focusMessageIds: focus,
    targetParticipantId: null,
    categories: [],
    assessment: 'harmless',
    findings: [],
    patterns: [],
    explanation: '',
    uncertainReason: null,
    roberta: [],
    fusion: [],
    touchedEvidence: [],
    supersededEvidence: [],
    latency: { totalMs: 1, robertaMs: null, contextualMs: null },
    contextStats: { messages: focus.length, relatedEvidence: 0, approxTokens: 10, truncated: false },
    error: null,
    warnings: [],
    stale: false,
    createdAt: new Date().toISOString(),
  };
}

vi.mock('./lib/api', async () => {
  const { AnalyzeResponseSchema } = await import('@rakshak/shared/schema');
  class ApiError extends Error {
    constructor(
      public status: number,
      public code: string,
      message: string,
    ) {
      super(message);
    }
  }
  return {
    ApiError,
    rid: () => 'r',
    api: {
      health: async () => ({ server: { ok: true }, roberta: {}, qwen: {}, chatgpt: { status: 'disconnected' } }),
      scenarios: async () => [scenario],
      state: async () => serverState,
      loadScenario: async () => {
        serverState = stateWith([], 'scripted', null, (serverState?.case?.generation ?? 0) + 1);
        return scenario;
      },
      loadHistory: async (_id: string, target: { checkpoint?: string; upto?: number }) => {
        calls.history++;
        const n = target.upto ?? 3;
        const reused = serverState?.case?.origin === 'history' && serverState.case.checkpoint === n;
        if (!reused) serverState = stateWith(scenario.messages.slice(0, n), 'history', n, (serverState?.case?.generation ?? 0) + 1);
        return { ...scenario, messages: scenario.messages.slice(0, n), checkpoint: scenario.checkpoints[0], historyMessageIds: [], reused };
      },
      continueCase: async () => {
        serverState.case = { ...serverState.case, origin: 'history', checkpoint: serverState.messages.length };
        return serverState.case;
      },
      reset: async () => {
        calls.reset++;
        serverState = stateWith([], 'fresh', null, (serverState?.case?.generation ?? 0) + 1);
        return { ok: true };
      },
      addMessage: async (m: any) => {
        calls.addMessage++;
        serverState.messages.push({ ...m, seq: serverState.messages.length + 1 });
        return m;
      },
      analyze: async (body: any) => {
        calls.analyze.push(body);
        if (failAnalyze) throw new ApiError(503, 'ollama_unavailable', 'Ollama is not running');
        const convMsgs = serverState.messages.filter((m: any) => m.conversationId === body.conversationId);
        const upto = convMsgs.findIndex((m: any) => m.id === body.uptoMessageId);
        const prior = serverState.runs.flatMap((r: any) => r.focusMessageIds);
        const focus = convMsgs.slice(0, upto + 1).map((m: any) => m.id).filter((id: string) => !prior.includes(id));
        const run = runFor(body.conversationId, focus.length ? focus : [body.uptoMessageId]);
        serverState.runs.push(run);
        return AnalyzeResponseSchema.parse({ result: run, evidence: [], firstSeen: {} });
      },
      snapshot: async () => ({}),
      alert: async () => ({ created: true }),
      dismissal: async () => ({}),
      block: async () => ({}),
      chatgpt: { status: async () => ({ status: 'disconnected' }), models: async () => ({ models: [] }) },
    },
  };
});

const store = await import('./store');
const get = () => store.useDemo.getState().data;

beforeEach(async () => {
  calls.analyze = [];
  calls.history = 0;
  calls.reset = 0;
  calls.addMessage = 0;
  failAnalyze = false;
  serverState = stateWith([], null, null, 0);
  store.useDemo.setState({ data: store.reduce(get(), { type: 'reset' }) });
  store.useDemo.getState().dispatch({ type: 'setBackend', backend: 'inhouse' });
  await store.bootstrap();
});

describe('modes and cases', () => {
  it('switching modes never resets the case', async () => {
    await store.loadHistory('s2-bullying', { checkpoint: 'cp' });
    const before = get();
    store.setMode('C');
    store.setMode('A');
    store.setMode('B');
    expect(get().messages).toBe(before.messages);
    expect(get().origin).toBe('history');
    expect(calls.reset).toBe(0);
  });

  it('loads exactly the history prefix and analyses it in batches, marking alerts historical', async () => {
    await store.loadHistory('s2-bullying', { checkpoint: 'cp' });
    const d = get();
    expect(d.mode).toBe('B');
    expect(d.messages.filter((m) => m.kind === 'msg').map((m) => m.id)).toEqual(['s2-bullying-m01', 's2-bullying-m02', 's2-bullying-m03']);
    expect(d.messages.some((m) => m.text === 'future line')).toBe(false);
    expect(d.historyInit.error).toBeNull();
    // Batches: day 1 (m01, m02) and day 2 (m03).
    expect(calls.analyze.map((c) => c.uptoMessageId)).toEqual(['s2-bullying-m02', 's2-bullying-m03']);
    expect(d.historyInit).toMatchObject({ status: 'complete', done: 2, total: 2 });
  });

  it('repeated loads of the same history do not re-run analysis or duplicate messages', async () => {
    await store.loadHistory('s2-bullying', { checkpoint: 'cp' });
    const n = calls.analyze.length;
    await store.loadHistory('s2-bullying', { checkpoint: 'cp' });
    await store.loadHistory('s2-bullying', { checkpoint: 'cp' });
    expect(calls.analyze.length).toBe(n);
    expect(get().messages.filter((m) => m.kind === 'msg')).toHaveLength(3);
  });

  it('a failed batch leaves a truthful, resumable state', async () => {
    failAnalyze = true;
    await store.loadHistory('s2-bullying', { checkpoint: 'cp' });
    expect(get().historyInit.status).toBe('failed');
    expect(get().historyInit.error).toMatch(/Ollama/);
    failAnalyze = false;
    await store.initHistory();
    expect(get().historyInit.status).toBe('complete');
  });

  it('cloud backend loads history without running any analysis', async () => {
    store.useDemo.getState().dispatch({ type: 'setBackend', backend: 'gpt' });
    await store.loadHistory('s2-bullying', { checkpoint: 'cp' });
    expect(calls.analyze).toHaveLength(0);
    expect(get().historyInit.status).toBe('messages_only');
  });

  it("a child's message triggers local reassessment, but never cloud analysis", async () => {
    await store.loadHistory('s2-bullying', { checkpoint: 'cp' });
    const n = calls.analyze.length;
    await store.sendLive('victim', 'please stop, that is not true');
    await new Promise((r) => setTimeout(r, 0));
    expect(calls.analyze.length).toBe(n + 1);
    expect(calls.analyze.at(-1)).toMatchObject({ trigger: 'auto', backend: 'local_hybrid' });

    store.useDemo.getState().dispatch({ type: 'setBackend', backend: 'gpt' });
    const m = calls.analyze.length;
    await store.sendLive('victim', 'stop');
    await new Promise((r) => setTimeout(r, 0));
    expect(calls.analyze.length).toBe(m);
  });

  it('typing is ignored in the Guided Demo and for scripted cases', async () => {
    await store.selectScenario('s2-bullying');
    store.setMode('C');
    await store.sendLive('victim', 'hello');
    expect(calls.addMessage).toBe(0);
  });

  it('continuing playback live keeps the played case and its generation', async () => {
    store.setMode('A');
    await store.selectScenario('s2-bullying');
    serverState.messages.push({ ...scenario.messages[0], seq: 1 });
    await store.hydrateFromServer();
    const gen = get().generation;
    await store.continueLiveFromHere();
    expect(get()).toMatchObject({ origin: 'history', checkpoint: 1, mode: 'B', generation: gen });
    expect(calls.reset).toBe(0);
  });

  it('Free Chat starts only on the explicit action', async () => {
    store.setMode('C');
    expect(calls.reset).toBe(0);
    await store.startFreshConversation();
    expect(calls.reset).toBe(1);
    expect(get().origin).toBe('fresh');
    expect(get().messages).toHaveLength(0);
  });

  it('a refresh restores the server case and its origin without resetting', async () => {
    await store.loadHistory('s2-bullying', { checkpoint: 'cp' });
    store.useDemo.setState({ data: store.reduce(get(), { type: 'reset' }) });
    await store.bootstrap();
    expect(get().origin).toBe('history');
    expect(get().messages.filter((m) => m.kind === 'msg')).toHaveLength(3);
    expect(get().historyInit.status).toBe('complete');
    expect(calls.reset).toBe(0);
  });
});

describe('alert routing', () => {
  const alert = { id: 'a', level: 2 as const, day: 1, time: 't', stage: 'rapport' as const, score: 6, contact: 'c', guardianTitle: 'x', guardianBody: 'y', cues: [], caseKey: 'p-meera#1' };
  const base = () => store.reduce(get(), { type: 'reset' });
  const applied = (historical: boolean) =>
    store.reduce(base(), { type: 'runApplied', run: runFor('c1', ['m']) as any, analyses: {}, evidence: [], firstSeen: {}, risk: { evalDay: 1, score: 6, level: 2, stage: 'rapport', category: 'bullying', dominantTrack: null, tracks: [], otherTargets: [], trace: [] }, point: { day: 1, score: 6, level: 2 }, fire: [{ ...alert, historical }], alerted: {}, historical });

  it('historical alerts are listed but not pushed as pop-ups', () => {
    const s = applied(true);
    expect(s.alerts).toHaveLength(1);
    expect(s.guardianBanner).toBeNull();
    expect(s.victimNudge).toBeNull();
  });
  it('live alerts are routed as before', () => {
    const s = applied(false);
    expect(s.guardianBanner?.id).toBe('a');
    expect(s.victimNudge?.id).toBe('a');
  });
  it('Get help keeps the selected alert (and its case) and closes the sheet', () => {
    const s = store.reduce({ ...base(), guardianSheet: alert }, { type: 'openHelp', alert });
    expect(s.helpFor?.caseKey).toBe('p-meera#1');
    expect(s.guardianSheet).toBeNull();
  });
});
