import {
  Banknote,
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
import type { Cue, Level, Stage } from '../types';

export const CUE_META: Record<Cue, { label: string; weight: number; icon: LucideIcon }> = {
  flattery_age: { label: 'Flattery / age', weight: 1, icon: Sparkles },
  secrecy: { label: 'Secrecy', weight: 2, icon: EyeOff },
  isolation: { label: 'Isolation', weight: 2, icon: UserX },
  platform_move: { label: 'Platform move', weight: 2, icon: Repeat },
  image_request: { label: 'Image request', weight: 3, icon: Camera },
  meeting_request: { label: 'Meeting request', weight: 3, icon: MapPin },
  disable_protection: { label: 'Disable protection', weight: 4, icon: ShieldOff },
  threat_payment: { label: 'Threat / payment', weight: 4, icon: Banknote },
  insult_harassment: { label: 'Insult / harassment', weight: 1, icon: MessageSquareWarning },
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
  { level: 1 as const, score: 2 },
  { level: 2 as const, score: 5 },
  { level: 3 as const, score: 9 },
];

export const CUE_ACTIVE_P = 0.5;
export const HALF_LIFE_DAYS = 7;
export const SCORE_MAX = 12;

export const WEEKDAYS = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export const CONTACT = { name: 'Kabir', hash: '#a3f9', initials: 'K' };
export const CHILD = { name: 'Meera', initials: 'M' };
export const GUARDIAN = { name: 'Amma' };
