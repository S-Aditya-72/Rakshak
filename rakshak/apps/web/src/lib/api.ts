// Client for the RAKSHAK inference service (apps/server). By default it calls /api on the same origin, which Vite
// proxies to 127.0.0.1:8787. Phones point it at the server laptop instead (getServer / setServer).
// Every analysis response is validated against the shared zod contract before the UI uses it.

import type { BackendId, Conversation, EvidenceEvent, Message, Participant } from '@rakshak/shared';
import { AnalyzeResponseSchema, type AnalyzeResponse } from '@rakshak/shared/schema';

export interface ServerConfig {
  /** e.g. http://192.168.1.20:8787, or a tunnel URL. Empty = this laptop through the dev server. */
  url: string;
  /** Access code printed by `npm run server:lan`. */
  token: string;
}

const SERVER_KEY = 'rakshak.server';
let server: ServerConfig = loadServer();
const serverListeners = new Set<(c: ServerConfig) => void>();

/** Called after setServer, e.g. so the device-sync socket reconnects to the new address. */
export function onServerChange(fn: (c: ServerConfig) => void): () => void {
  serverListeners.add(fn);
  return () => serverListeners.delete(fn);
}

function loadServer(): ServerConfig {
  try {
    const v = JSON.parse(localStorage.getItem(SERVER_KEY) ?? 'null');
    if (v && typeof v.url === 'string') return { url: v.url, token: typeof v.token === 'string' ? v.token : '' };
  } catch {
    /* storage unavailable */
  }
  return { url: '', token: '' };
}

export function getServer(): ServerConfig {
  return server;
}

/** "192.168.1.20" → http://192.168.1.20:8787, "abc.trycloudflare.com" → https://…, trailing "/api/" dropped. */
export function setServer(next: ServerConfig): ServerConfig {
  let url = next.url.trim().replace(/\/+$/, '').replace(/\/api$/, '');
  if (url && !/^https?:\/\//i.test(url)) {
    const ip = url.match(/^(\d{1,3}(?:\.\d{1,3}){3})(:\d+)?$/);
    url = ip ? `http://${ip[1]}${ip[2] ?? ':8787'}` : `https://${url}`;
  }
  server = { url, token: next.token.trim() };
  try {
    localStorage.setItem(SERVER_KEY, JSON.stringify(server));
  } catch {
    /* kept for this session only */
  }
  serverListeners.forEach((fn) => fn(server));
  return server;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

async function call<T>(method: string, path: string, body?: unknown, timeoutMs = 15000, signal?: AbortSignal): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new DOMException('timeout', 'TimeoutError')), timeoutMs);
  const onAbort = () => ctrl.abort(signal?.reason);
  signal?.addEventListener('abort', onAbort);
  try {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (server.token) headers['x-rakshak-token'] = server.token;
    const res = await fetch(`${server.url}/api${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await res.text();
    let data: any = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      /* non-JSON error page (e.g. proxy error) */
    }
    if (!res.ok) {
      const err = data?.error ?? data?.detail ?? {};
      const code = typeof err === 'object' ? err.code ?? `http_${res.status}` : `http_${res.status}`;
      const message = typeof err === 'object' ? err.message ?? (typeof data?.detail === 'string' ? data.detail : res.statusText) : String(err);
      if (res.status === 502 || res.status === 504 || (res.status === 500 && !data)) throw new ApiError(503, 'server_offline', 'RAKSHAK inference service is not running (start apps/server).');
      throw new ApiError(res.status, code, message);
    }
    return data as T;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    if ((e as Error)?.name === 'TimeoutError' || ctrl.signal.reason?.name === 'TimeoutError') throw new ApiError(504, 'timeout', `Request timed out after ${Math.round(timeoutMs / 1000)}s`);
    if ((e as Error)?.name === 'AbortError') throw new ApiError(499, 'aborted', 'Request cancelled');
    throw new ApiError(503, 'server_offline', 'RAKSHAK inference service is not reachable.');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

export interface Health {
  server: { ok: boolean; uptimeS: number };
  roberta: { enabled: boolean; ready: boolean; model: string; device: string | null; loadMs: number | null; error: string | null };
  qwen: { model: string; reachable: boolean; modelPresent: boolean; loaded: boolean; vramBytes?: number; contextLength?: number; numCtx: number; error?: string };
  chatgpt: ChatGPTStatus;
}

export interface ChatGPTStatus {
  enabled: boolean;
  reachable: boolean;
  status: 'disconnected' | 'connecting' | 'connected' | 'reauth_required' | 'unavailable';
  sharing: boolean;
  consent: boolean;
  identity?: { name?: string; email?: string };
  reason?: string;
  code?: string;
  error?: { code: string; message: string };
}

export interface ServerState {
  child: Participant;
  participants: Participant[];
  conversations: Conversation[];
  messages: Message[];
  evidence: EvidenceEvent[];
  runs: AnalyzeResponse['result'][];
  snapshots: { day: number; score: number; level: number; stage: string; category: string; runId: string | null }[];
  alerts: { id: string; backend: BackendId; trackKey: string; level: number; day: number; time: string; title: string; body: string; historical?: boolean; withdrawn?: boolean; withdrawnReason?: string | null }[];
  alerted: Record<string, number>;
  dismissals: { day: number; trackKey: string | null }[];
  blocks: { contactId: string; day: number }[];
  firstSeen: Record<string, number>;
  scenarioId: string | null;
  case?: CaseMeta;
}

export interface CaseMeta {
  generation: number;
  scenarioId: string | null;
  origin: 'scripted' | 'history' | 'fresh' | null;
  checkpoint: number | null;
}

export interface Checkpoint {
  id: string;
  /** Number of scripted messages in the history (the live conversation starts after this many). */
  after: number;
  label: string;
  intro: string;
  /** Presenter-only ideas for live messages. Shown in the UI, never sent to a model. */
  suggestions: string[];
}

export interface ScenarioView {
  id: string;
  number: number | null;
  kind: 'core' | 'case_study';
  caseStudy: string | null;
  title: string;
  subtitle: string;
  tests: string;
  intro: string;
  child: { id: string; name: string };
  participants: { id: string; name: string; role: 'contact' | 'peer' }[];
  conversations: { id: string; kind: 'private' | 'group'; title: string; participants: string[] }[];
  messages: { id: string; conversationId: string; senderId: string; day: number; time: string; text: string; caption?: string | null }[];
  checkpoints: Checkpoint[];
  presenter: string[];
}

export interface HistoryView extends ScenarioView {
  checkpoint: Checkpoint;
  historyMessageIds: string[];
  reused: boolean;
}

export const api = {
  health: () => call<Health>('GET', '/health', undefined, 6000),
  state: (backend: BackendId) => call<ServerState>('GET', `/state?backend=${backend}`),
  scenarios: () => call<ScenarioView[]>('GET', '/scenarios'),
  loadScenario: (id: string) => call<ScenarioView>('POST', `/scenarios/${encodeURIComponent(id)}/load`),
  loadHistory: (id: string, target: { checkpoint?: string; upto?: number }, force = false) => {
    const q = new URLSearchParams();
    if (target.checkpoint) q.set('checkpoint', target.checkpoint);
    if (target.upto !== undefined) q.set('upto', String(target.upto));
    if (force) q.set('force', 'true');
    return call<HistoryView>('POST', `/scenarios/${encodeURIComponent(id)}/history?${q}`);
  },
  continueCase: (childId: string) => call<CaseMeta>('POST', `/case/continue?childId=${encodeURIComponent(childId)}`),
  reset: (mode: 'live' | 'empty') => call<{ ok: boolean }>('POST', `/reset?mode=${mode}`),
  addParticipant: (displayName: string, role: 'contact' | 'peer') => call<Participant>('POST', '/participants', { displayName, role }),
  addConversation: (kind: 'private' | 'group', title: string, participantIds: string[]) => call<Conversation>('POST', '/conversations', { kind, title, participantIds }),
  addMessage: (m: { id: string; conversationId: string; senderId: string; day: number; time: string; text: string }) => call<Message>('POST', '/messages', m),
  async analyze(body: { backend: BackendId; conversationId: string; uptoMessageId?: string; requestId: string; trigger: 'auto' | 'owner_button'; model?: string }, signal?: AbortSignal): Promise<AnalyzeResponse> {
    const raw = await call<unknown>('POST', '/analyze', body, body.backend === 'chatgpt_cloud' ? 200_000 : 150_000, signal);
    const parsed = AnalyzeResponseSchema.safeParse(raw);
    if (!parsed.success) throw new ApiError(502, 'invalid_response', `Server response failed contract validation: ${parsed.error.issues[0]?.path.join('.')} ${parsed.error.issues[0]?.message}`);
    return parsed.data;
  },
  snapshot: (childId: string, s: unknown) => call('POST', `/cases/${childId}/snapshots`, s),
  alert: (childId: string, a: { id: string; backend: BackendId; trackKey?: string; level: number; day: number; time: string; title: string; body: string; historical: boolean }) =>
    call<{ created: boolean }>('POST', `/cases/${childId}/alerts`, a),
  withdrawAlert: (childId: string, alertId: string, b: { backend: BackendId; reason: string }) =>
    call<{ withdrawn: boolean }>('POST', `/cases/${childId}/alerts/${encodeURIComponent(alertId)}/withdraw`, b),
  dismissal: (childId: string, d: { day: number; trackKey: string | null }) => call('POST', `/cases/${childId}/dismissals`, d),
  block: (childId: string, b: { contactId: string; day: number }) => call('POST', `/cases/${childId}/blocks`, b),
  guardians: {
    invite: (b: { minutes: number; scope: 'all' | 'critical'; label?: string }) => call<{ id: string; code: string; scope: 'all' | 'critical'; expiresAt: number }>('POST', '/guardians/invites', b),
    list: () => call<{ guardians: import('./sync').GuardianView[] }>('GET', '/guardians'),
    revoke: (id: string) => call<{ ok: boolean }>('POST', `/guardians/${encodeURIComponent(id)}/revoke`, {}),
  },
  connectInfo: () => call<{ addresses: string[]; port: number; token: string; lan: boolean; public: string | null }>('GET', '/connect-info'),
  syncPeers: () => call<{ peers: { id: string; role: 'chat' | 'guardian' | 'temp'; name: string; addr: string; scope: string; audience: string; connectedAt: number; frames: number; bytes: number; recent: string[] }[]; blockedFrames: number }>('GET', '/sync/peers', undefined, 4000),
  chatgpt: {
    status: () => call<ChatGPTStatus>('GET', '/chatgpt/status', undefined, 6000),
    signIn: () => call<{ started: boolean }>('POST', '/chatgpt/signin', {}, 15000),
    signOut: () => call('POST', '/chatgpt/signout', {}),
    models: () => call<{ models: { slug: string; displayName: string }[] }>('GET', '/chatgpt/models', undefined, 25000),
    consent: (accepted: boolean) => call<{ consent: boolean }>('POST', '/chatgpt/consent', { accepted }),
  },
};

export const rid = () => (crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '') : Math.random().toString(36).slice(2) + Date.now().toString(36));
