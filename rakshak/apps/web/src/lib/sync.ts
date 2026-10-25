// Carries store messages between tabs (BroadcastChannel) and between devices (the server's /api/sync relay), so the
// laptop and the phones show the same case. A message can arrive over both routes; ids make sure each one is applied once.
// Every message names its audience (`to`): chat devices hold the conversation, guardian devices only get alert
// summaries. The relay enforces this between devices; tabs on one machine filter the same way.

import { create } from 'zustand';
import { getServer, onServerChange, type ServerConfig } from './api';
import { activeAudience, onRoleChange, useDevice, type Audience } from './device';

export interface GuardianView {
  id: string;
  scope: 'all' | 'critical';
  label: string;
  claimedBy: string | null;
  state: 'active' | 'expired' | 'revoked';
  createdAt: number;
  expiresAt: number;
  connected: boolean;
}

export interface SyncStatus {
  /** unauthorized: wrong access code · offline: server unreachable (retrying) · ended: temporary access expired or revoked */
  state: 'connecting' | 'live' | 'unauthorized' | 'offline' | 'ended';
  /** Devices connected to the relay, this one included. */
  peers: number;
  /** Temporary guardians invited so far (chat and guardian devices). */
  guardians: GuardianView[];
  /** This device's own temporary access (temporary guardians only). */
  access: GuardianView | null;
  ended: 'expired' | 'revoked' | null;
}

export const useSync = create<SyncStatus>(() => ({ state: 'connecting', peers: 0, guardians: [], access: null, ended: null }));

export interface Bus {
  readonly id: string;
  post(msg: Record<string, unknown>, to: Audience[]): void;
  reconnect(): void;
}

const MAX_SEEN = 2000;
/** Bumped whenever the shared case changes shape: devices running an older build are ignored instead of crashing this one. */
export const SYNC_VERSION = 2;

/**
 * onMessage receives every message from another tab or device meant for this one. onConnect runs when the relay
 * (re)connects, so the store can ask the others for what it missed.
 */
export function createBus(onMessage: (msg: any) => void, onConnect: () => void): Bus {
  const id = Math.random().toString(36).slice(2);
  const seen = new Set<string>();
  let n = 0;

  const deliver = (msg: any) => {
    if (!msg || msg.from === id || msg.v !== SYNC_VERSION) return;
    if (Array.isArray(msg.to) && !msg.to.includes(activeAudience())) return;
    if (msg.mid) {
      if (seen.has(msg.mid)) return;
      seen.add(msg.mid);
      if (seen.size > MAX_SEEN) seen.delete(seen.values().next().value!);
    }
    onMessage(msg);
  };

  const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('rakshak-demo') : null;
  if (channel) channel.onmessage = (e) => deliver(e.data);

  let ws: WebSocket | null = null;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let delay = 1000;

  const connect = (cfg: ServerConfig) => {
    clearTimeout(retry);
    if (ws) {
      ws.onclose = null;
      ws.close();
    }
    if (typeof WebSocket === 'undefined' || typeof location === 'undefined') return; // no browser (unit tests)
    const base = cfg.url ? cfg.url.replace(/^http/i, 'ws') : `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`;
    useSync.setState({ state: 'connecting' });
    const sock = new WebSocket(`${base}/api/sync`);
    ws = sock;
    sock.onopen = () => sock.send(JSON.stringify({ auth: cfg.token, role: activeAudience() === 'chat' ? 'chat' : 'guardian', name: useDevice.getState().name }));
    sock.onmessage = (e) => {
      let msg: any;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }
      if (typeof msg.peers === 'number') {
        const first = useSync.getState().state !== 'live';
        useSync.setState({ state: 'live', peers: msg.peers, ended: null, ...(msg.guardians ? { guardians: msg.guardians } : {}), ...('access' in msg ? { access: msg.access } : {}) });
        delay = 1000;
        if (first) onConnect();
      } else if (msg.error === 'unauthorized') {
        useSync.setState({ state: 'unauthorized', peers: 0 });
      } else if (msg.error === 'expired' || msg.error === 'revoked') {
        useSync.setState({ state: 'ended', peers: 0, ended: msg.error });
      } else deliver(msg);
    };
    sock.onclose = () => {
      if (ws !== sock) return;
      ws = null;
      const st = useSync.getState().state;
      if (st === 'ended') return; // temporary access is over; only a new invite brings it back
      if (st !== 'unauthorized') useSync.setState({ state: 'offline', peers: 0 });
      retry = setTimeout(() => connect(getServer()), st === 'unauthorized' ? 10_000 : delay);
      delay = Math.min(delay * 2, 10_000);
    };
  };

  connect(getServer());
  onServerChange((cfg) => {
    delay = 1000;
    connect(cfg);
  });
  // The role decides what this device may receive, so changing it starts a fresh connection.
  onRoleChange(() => connect(getServer()));

  return {
    id,
    post(msg, to) {
      const wire = { ...msg, v: SYNC_VERSION, to, from: id, mid: `${id}-${++n}` };
      channel?.postMessage(wire);
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(wire));
    },
    reconnect: () => connect(getServer()),
  };
}
