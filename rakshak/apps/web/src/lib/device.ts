// Who this device is, remembered across launches: the child's phone, the other person's phone, the guardian's phone or
// a temporary guardian's. The laptop's pages are always the "engine" (they hold the whole case).
// The role decides what the device may receive: guardians only ever get alert summaries (see store.ts and relay.py).

import { create } from 'zustand';

export type DeviceRole = 'child' | 'contact' | 'guardian' | 'temp';
/** Sync audiences, matching the server relay: chat devices hold the conversation; guardians get alert summaries. */
export type Audience = 'chat' | 'guardian' | 'critical';

export interface DeviceProfile {
  role: DeviceRole | null;
  /** Shown to other devices, e.g. "Ms. Rao" for a temporary guardian. */
  name: string;
  /** Temporary guardians: the invite's scope, as granted by the guardian. */
  scope?: 'all' | 'critical';
}

const KEY = 'rakshak.device';

function load(): DeviceProfile {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (v && typeof v === 'object') return { role: v.role ?? null, name: typeof v.name === 'string' ? v.name : '', scope: v.scope };
  } catch {
    /* storage unavailable */
  }
  return { role: null, name: '' };
}

export const useDevice = create<DeviceProfile>(() => load());

export function setDevice(p: DeviceProfile) {
  useDevice.setState(p, true);
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* kept for this session only */
  }
}

const ROUTE_ROLE: Record<string, DeviceRole> = { child: 'child', contact: 'contact', guardian: 'guardian', temp: 'temp' };

/** Role pages (/m/...) set this; every other page is the laptop engine. Read from the address before the first
 *  connection, so a guardian phone never connects as a chat device, not even for a moment. */
let activeRole: DeviceRole | null = typeof location !== 'undefined' ? ROUTE_ROLE[location.hash.match(/^#\/m\/(\w+)/)?.[1] ?? ''] ?? null : null;
const roleListeners = new Set<() => void>();

export function setActiveRole(role: DeviceRole | null) {
  if (activeRole === role) return;
  activeRole = role;
  roleListeners.forEach((fn) => fn());
}

export function onRoleChange(fn: () => void) {
  roleListeners.add(fn);
  return () => roleListeners.delete(fn);
}

export function activeAudience(): Audience {
  if (activeRole === 'guardian') return 'guardian';
  if (activeRole === 'temp') return useDevice.getState().scope === 'all' ? 'guardian' : 'critical';
  return 'chat';
}

export const isGuardianDevice = () => activeAudience() !== 'chat';

export const ROLE_NAMES: Record<DeviceRole, string> = {
  child: "Meera's phone",
  contact: "Kabir's phone",
  guardian: "Amma's phone",
  temp: 'Temporary guardian',
};
