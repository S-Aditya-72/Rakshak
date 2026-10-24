import { motion } from 'framer-motion';
import { CUE_ACTIVE_P, CUE_META, LEVEL_META, SCORE_MAX, STAGES, STAGE_META, THRESHOLDS } from '../data/meta';
import { useCountUp } from '../lib/hooks';
import type { Cue, Level, Stage } from '../types';

/** Diagonal hazard band. `soft` is the gentle child-facing variant. */
export function HazardStripe({ tone = 'amber', height = 10, animated = true }: { tone?: 'amber' | 'soft' | 'red'; height?: number; animated?: boolean }) {
  return <div className={`hazard hazard-${tone} ${animated ? 'hazard-anim' : ''}`} style={{ height }} />;
}

/** Neon-outlined level badge ("WARNING" sign style). */
export function NeonBadge({ level, size = 'md' }: { level: Level; size?: 'sm' | 'md' }) {
  const meta = LEVEL_META[level];
  return (
    <span className={`neon-badge neon-${size} ${level === 3 ? 'neon-flicker' : ''}`} style={{ ['--c' as string]: meta.color }}>
      <span className="neon-dot" />
      {meta.short} · {meta.label}
    </span>
  );
}

/** HUD-style cue chip. Cues below the activation threshold render dimmed. */
export function CueChip({ cue, p }: { cue: Cue; p?: number }) {
  const meta = CUE_META[cue];
  const Icon = meta.icon;
  const active = p === undefined || p >= CUE_ACTIVE_P;
  return (
    <span className={`cue-chip ${active ? '' : 'cue-dim'} ${meta.weight >= 3 ? 'cue-hot' : ''}`}>
      <Icon size={12} strokeWidth={2.2} />
      {meta.label}
      {p !== undefined && <span className="cue-p">{p.toFixed(2)}</span>}
    </span>
  );
}

const levelFor = (score: number): Level => (score >= 9 ? 3 : score >= 5 ? 2 : score >= 2 ? 1 : 0);

/** Radial score meter with tick marks at the 2 / 5 / 9 thresholds. */
export function ScoreRing({ score, size = 132 }: { score: number; size?: number }) {
  const shown = useCountUp(score);
  const r = 52;
  const circ = 2 * Math.PI * r;
  const frac = Math.min(1, shown / SCORE_MAX);
  const color = LEVEL_META[levelFor(shown)].color;

  return (
    <div className="score-ring" style={{ width: size, height: size }}>
      <svg viewBox="0 0 132 132" width={size} height={size}>
        <defs>
          <filter id="ringGlow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="3.5" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <circle cx="66" cy="66" r={r} fill="none" stroke="rgba(255,255,255,.07)" strokeWidth="10" />
        <circle
          cx="66"
          cy="66"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={`${circ * frac} ${circ}`}
          opacity={frac > 0.005 ? 1 : 0}
          transform="rotate(-90 66 66)"
          filter="url(#ringGlow)"
          style={{ transition: 'stroke .4s' }}
        />
        {THRESHOLDS.map((t) => {
          const a = (t.score / SCORE_MAX) * Math.PI * 2 - Math.PI / 2;
          return (
            <line
              key={t.level}
              x1={66 + Math.cos(a) * 41}
              y1={66 + Math.sin(a) * 41}
              x2={66 + Math.cos(a) * 46}
              y2={66 + Math.sin(a) * 46}
              stroke={LEVEL_META[t.level].color}
              strokeWidth="2.5"
              strokeLinecap="round"
              opacity="0.8"
            />
          );
        })}
      </svg>
      <div className="score-ring-center">
        <div className="score-ring-value" style={{ color, fontSize: size * 0.23 }}>
          {shown.toFixed(1)}
        </div>
        <div className="score-ring-label" style={{ fontSize: Math.max(7.5, size * 0.072) }}>
          {size >= 120 ? 'case score' : 'score'}
        </div>
      </div>
    </div>
  );
}

/** Rapport → Secrecy/Isolation → Request → Coercion progress. */
export function StageStepper({ stage, active = true, compact = false }: { stage: Stage; active?: boolean; compact?: boolean }) {
  const idx = active ? STAGES.indexOf(stage) : -1;
  return (
    <div className={`stepper ${compact ? 'stepper-compact' : ''}`}>
      <div className="stepper-track">
        <motion.div
          className="stepper-fill"
          initial={false}
          animate={{ width: `${(Math.max(0, idx) / (STAGES.length - 1)) * 100}%` }}
          transition={{ type: 'spring', stiffness: 120, damping: 20 }}
          style={{ background: `linear-gradient(90deg, ${STAGES.slice(0, idx + 1).map((s) => STAGE_META[s].color).join(', ')}${idx === 0 ? ', ' + STAGE_META.rapport.color : ''})` }}
        />
      </div>
      {STAGES.map((s, i) => {
        const meta = STAGE_META[s];
        const Icon = meta.icon;
        const reached = i <= idx;
        return (
          <div key={s} className="stepper-node">
            <motion.div
              className={`stepper-dot ${reached ? 'reached' : ''} ${i === idx ? 'current' : ''}`}
              style={{ ['--c' as string]: meta.color }}
              initial={false}
              animate={{ scale: i === idx ? 1.12 : 1 }}
            >
              <Icon size={compact ? 12 : 14} strokeWidth={2.4} />
            </motion.div>
            <div className="stepper-label">{meta.label}</div>
          </div>
        );
      })}
    </div>
  );
}
