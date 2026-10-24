import {
  Banknote,
  Gift,
  House,
  Laugh,
  ShieldAlert,
  UserMinus,
  Camera,
  EyeOff,
  Handshake,
  Lock,
  MapPin,
  MessageSquareWarning,
  Repeat,
  ShieldOff,
  Siren,
  Sparkles,
  UserX,
  type LucideIcon,
} from 'lucide-react';
import { DEFAULT_CONFIG } from '@rakshak/engine';
import type { Cue, Level, Stage } from '../types';

// Weights come from the engine config so the UI always shows the numbers the engine actually uses.
const W = DEFAULT_CONFIG.weights;
export const CUE_META: Record<Cue, { label: string; weight: number; icon: LucideIcon; kind: 'grooming' | 'bullying' }> = {
  flattery_age: { label: 'Flattery / age', weight: W.flattery_age, icon: Sparkles, kind: 'grooming' },
  secrecy: { label: 'Secrecy', weight: W.secrecy, icon: EyeOff, kind: 'grooming' },
  isolation: { label: 'Isolation', weight: W.isolation, icon: UserX, kind: 'grooming' },
  platform_move: { label: 'Platform move', weight: W.platform_move, icon: Repeat, kind: 'grooming' },
  manipulation: { label: 'Manipulation', weight: W.manipulation, icon: Gift, kind: 'grooming' },
  personal_info_request: { label: 'Personal-info request', weight: W.personal_info_request, icon: House, kind: 'grooming' },
  image_request: { label: 'Image request', weight: W.image_request, icon: Camera, kind: 'grooming' },
  meeting_request: { label: 'Meeting request', weight: W.meeting_request, icon: MapPin, kind: 'grooming' },
  disable_protection: { label: 'Disable protection', weight: W.disable_protection, icon: ShieldOff, kind: 'grooming' },
  threat_payment: { label: 'Threat / coercion', weight: W.threat_payment, icon: Banknote, kind: 'grooming' },
  insult_harassment: { label: 'Insult / harassment', weight: W.insult_harassment, icon: MessageSquareWarning, kind: 'bullying' },
  humiliation: { label: 'Humiliation', weight: W.humiliation, icon: Laugh, kind: 'bullying' },
  exclusion: { label: 'Exclusion', weight: W.exclusion, icon: UserMinus, kind: 'bullying' },
  intimidation: { label: 'Intimidation', weight: W.intimidation, icon: ShieldAlert, kind: 'bullying' },
};

export const STAGES: Stage[] = ['rapport', 'secrecy_isolation', 'request', 'coercion'];

export const STAGE_META: Record<Stage, { label: string; icon: LucideIcon; color: string }> = {
  rapport: { label: 'Rapport', icon: Handshake, color: '#64D2FF' },
  secrecy_isolation: { label: 'Secrecy / Isolation', icon: Lock, color: '#FFD60A' },
  request: { label: 'Request', icon: Camera, color: '#FF9F0A' },
  coercion: { label: 'Coercion', icon: Siren, color: '#FF453A' },
};

export const LEVEL_META: Record<Level, { label: string; short: string; color: string }> = {
  0: { label: 'Monitoring', short: 'L0', color: '#64D2FF' },
  1: { label: 'Child nudge', short: 'L1', color: '#FFD60A' },
  2: { label: 'Guardian alert', short: 'L2', color: '#FF9F0A' },
  3: { label: 'Critical', short: 'L3', color: '#FF453A' },
};

export const THRESHOLDS = [
  { level: 1 as const, score: DEFAULT_CONFIG.thresholds.l1 },
  { level: 2 as const, score: DEFAULT_CONFIG.thresholds.l2 },
  { level: 3 as const, score: DEFAULT_CONFIG.thresholds.l3 },
];

export const CUE_ACTIVE_P = DEFAULT_CONFIG.cueThreshold;
export const HALF_LIFE_DAYS = DEFAULT_CONFIG.halfLifeDays;
export const SCORE_MAX = 12;

const WEEK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
/** Weekday labels by simulated day; Day 1 is a Monday. */
export const WEEKDAYS = ['', ...Array.from({ length: 90 }, (_, i) => WEEK[(i + 1) % 7])];

export const CONTACT = { name: 'Kabir', hash: '#a3f9', initials: 'K' };
export const CHILD = { id: 'p-meera', name: 'Meera', initials: 'M' };

export const BACKEND_META = {
  inhouse: { label: 'RAKSHAK Hybrid', short: 'Hybrid · Local', where: 'local', api: 'local_hybrid' as const },
  gpt: { label: 'ChatGPT', short: 'ChatGPT · Cloud', where: 'cloud', api: 'chatgpt_cloud' as const },
};
export const GUARDIAN = { name: 'Amma' };
