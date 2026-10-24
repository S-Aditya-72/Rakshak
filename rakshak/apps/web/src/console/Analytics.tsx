import { AnimatePresence, motion } from 'framer-motion';
import { Activity, Cloud, Cpu, Eye, ScrollText } from 'lucide-react';
import { useEffect, useMemo, useRef } from 'react';
import { CueChip, NeonBadge, ScoreRing, StageStepper } from '../alerts/primitives';
import { CONTACT, CUE_ACTIVE_P, HALF_LIFE_DAYS, LEVEL_META, SCORE_MAX, THRESHOLDS } from '../data/meta';
import { useDemo } from '../store';

const decay = (score: number, days: number) => score * Math.pow(0.5, days / HALF_LIFE_DAYS);

export function CaseCard() {
  const d = useDemo((s) => s.data);
  const last = d.history[d.history.length - 1];
  const current = last ? decay(last.score, d.simDay - last.day) : 0;
  const cueCount = d.messages.reduce((n, m) => n + (m.analysis?.cues.filter((c) => c.p >= CUE_ACTIVE_P).length ?? 0), 0);

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <div className="panel-title">
            Case · Contact {CONTACT.hash}
          </div>
          <div className="panel-sub">{CONTACT.name} (unsaved) · first seen Day 1</div>
        </div>
        <NeonBadge level={d.level} />
      </div>

      <div className="case-row">
        <ScoreRing score={current} />
        <div className="case-stats">
          <Stat k="Active cues" v={String(cueCount)} />
          <Stat k="Dismissals" v={`${d.dismissals}×`} />
          <Stat k="Alerts fired" v={String(d.alerts.length)} />
          <Stat
            k="Backend"
            v={
              <span className="backend-badge">
                {d.backend === 'gpt' ? <Cloud size={12} /> : <Cpu size={12} />}
                {d.backend === 'gpt' ? 'GPT · cloud' : 'In-house · on-device'}
              </span>
            }
          />
        </div>
      </div>

      <StageStepper stage={d.stage} active={d.history.length > 0} />
    </section>
  );
}

function Stat({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="stat">
      <div className="stat-k">{k}</div>
      <div className="stat-v">{v}</div>
    </div>
  );
}

/** Score over simulated days: decay curves between cue events, jumps at each event, threshold lines at 2 / 5 / 9. */
export function ScoreChart() {
  const history = useDemo((s) => s.data.history);
  const simDay = useDemo((s) => s.data.simDay);

  const W = 520;
  const H = 210;
  const pad = { l: 30, r: 16, t: 14, b: 26 };
  const maxDay = Math.max(7, simDay);
  const x = (day: number) => pad.l + ((day - 1) / (maxDay - 1)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - Math.min(v, SCORE_MAX) / SCORE_MAX) * (H - pad.t - pad.b);

  const { line, area } = useMemo(() => {
    if (!history.length) return { line: '', area: '' };
    const pts: [number, number][] = [[history[0].day, 0], [history[0].day, history[0].score]];
    const sample = (from: { day: number; score: number }, to: number) => {
      for (let t = from.day + 0.1; t <= to + 1e-6; t += 0.1) pts.push([t, decay(from.score, t - from.day)]);
    };
    for (let i = 1; i < history.length; i++) {
      sample(history[i - 1], history[i].day);
      pts.push([history[i].day, history[i].score]);
    }
    sample(history[history.length - 1], simDay);
    const line = pts.map(([d, v], i) => `${i ? 'L' : 'M'}${x(d).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    const lastX = x(pts[pts.length - 1][0]);
    const area = `${line} L${lastX.toFixed(1)},${y(0)} L${x(pts[0][0]).toFixed(1)},${y(0)} Z`;
    return { line, area };
  }, [history, simDay, maxDay]); // eslint-disable-line react-hooks/exhaustive-deps

  const stops = [
    [0, LEVEL_META[3].color],
    [1 - 9 / SCORE_MAX, LEVEL_META[3].color],
    [1 - 8.6 / SCORE_MAX, LEVEL_META[2].color],
    [1 - 5 / SCORE_MAX, LEVEL_META[2].color],
    [1 - 4.6 / SCORE_MAX, LEVEL_META[1].color],
    [1 - 2 / SCORE_MAX, LEVEL_META[1].color],
    [1 - 1.6 / SCORE_MAX, LEVEL_META[0].color],
    [1, LEVEL_META[0].color],
  ] as const;

  const lastPt = history[history.length - 1];

  return (
    <section className="panel">
      <div className="panel-head">
        <div className="panel-title">
          <Activity size={14} /> Case score over time
        </div>
        <div className="panel-sub">t½ = {HALF_LIFE_DAYS} days</div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="chart">
        <defs>
          <linearGradient id="lineGrad" gradientUnits="userSpaceOnUse" x1="0" y1={y(SCORE_MAX)} x2="0" y2={y(0)}>
            {stops.map(([o, c], i) => (
              <stop key={i} offset={o} stopColor={c} />
            ))}
          </linearGradient>
          <linearGradient id="areaGrad" gradientUnits="userSpaceOnUse" x1="0" y1={y(SCORE_MAX)} x2="0" y2={y(0)}>
            <stop offset="0" stopColor="#FF453A" stopOpacity="0.35" />
            <stop offset="0.6" stopColor="#FF9F0A" stopOpacity="0.12" />
            <stop offset="1" stopColor="#64D2FF" stopOpacity="0" />
          </linearGradient>
          <filter id="lineGlow" x="-10%" y="-30%" width="120%" height="160%">
            <feGaussianBlur stdDeviation="3" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {Array.from({ length: maxDay }, (_, i) => i + 1).map((day) => (
          <g key={day}>
            <line x1={x(day)} x2={x(day)} y1={pad.t} y2={y(0)} className="chart-grid" />
            <text x={x(day)} y={H - 8} className="chart-axis" textAnchor="middle">
              D{day}
            </text>
          </g>
        ))}

        {THRESHOLDS.map((t) => (
          <g key={t.level}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t.score)} y2={y(t.score)} stroke={LEVEL_META[t.level].color} className="chart-threshold" />
            <text x={pad.l - 6} y={y(t.score) + 3.5} textAnchor="end" className="chart-axis" fill={LEVEL_META[t.level].color}>
              {t.score}
            </text>
            <text x={W - pad.r - 2} y={y(t.score) - 4} textAnchor="end" className="chart-tlabel" fill={LEVEL_META[t.level].color}>
              L{t.level}
            </text>
          </g>
        ))}

        <AnimatePresence>
          {line && (
            <motion.g key={line} initial={{ opacity: 0.4 }} animate={{ opacity: 1 }}>
              <path d={area} fill="url(#areaGrad)" />
              <motion.path
                d={line}
                fill="none"
                stroke="url(#lineGrad)"
                strokeWidth="2.6"
                strokeLinejoin="round"
                filter="url(#lineGlow)"
                initial={{ pathLength: 0.6 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
              />
            </motion.g>
          )}
        </AnimatePresence>

        {history.map((h, i) => (
          <g key={i}>
            <circle cx={x(h.day)} cy={y(h.score)} r="4" fill="#0b0b10" stroke={LEVEL_META[h.level].color} strokeWidth="2.2" />
            <text x={x(h.day) + 7} y={y(h.score) - 7} className="chart-point">
              {h.score.toFixed(1)}
            </text>
          </g>
        ))}
        {lastPt && <circle cx={x(lastPt.day)} cy={y(lastPt.score)} r="4" fill={LEVEL_META[lastPt.level].color} className="chart-pulse" />}

        {!history.length && (
          <text x={W / 2} y={H / 2} textAnchor="middle" className="chart-empty">
            Waiting for the first cue…
          </text>
        )}
      </svg>
    </section>
  );
}

/** Per-message engine output: cue chips, backend + latency, rule trace. */
export function DebugFeed() {
  const messages = useDemo((s) => s.data.messages);
  const analyzingId = useDemo((s) => s.data.analyzingId);
  const backend = useDemo((s) => s.data.backend);
  const ref = useRef<HTMLDivElement>(null);

  const mounted = useRef(false);
  useEffect(() => {
    // Jump straight to the newest entry on first render, then follow new ones smoothly.
    const behavior = mounted.current ? 'smooth' : 'auto';
    mounted.current = true;
    const id = requestAnimationFrame(() => ref.current?.scrollTo({ top: ref.current.scrollHeight, behavior }));
    return () => cancelAnimationFrame(id);
  }, [messages, analyzingId]);

  const msgs = messages.filter((m) => m.kind === 'msg');

  return (
    <section className="panel panel-feed">
      <div className="panel-head">
        <div className="panel-title">
          <ScrollText size={14} /> Engine trace
        </div>
        <div className="debug-note">
          <Eye size={11} /> Device debug view · in production this never leaves the phone
        </div>
      </div>
      <div className="feed" ref={ref}>
        {msgs.length === 0 && <div className="feed-empty">Press Play (Mode A) or start typing (Mode B).</div>}
        <AnimatePresence initial={false}>
          {msgs.map((m) => (
            <motion.div
              key={m.id}
              className={`feed-row ${m.analysis && m.analysis.level >= 1 ? `feed-l${m.analysis.level}` : ''}`}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ type: 'spring', stiffness: 380, damping: 30 }}
            >
              <div className="feed-meta">
                <span className={`who who-${m.from}`}>{m.from === 'predator' ? 'CONTACT' : 'CHILD'}</span>
                <span className="feed-time">
                  D{m.day} · {m.time}
                </span>
                {m.analysis && (
                  <span className="feed-latency">
                    {backend === 'gpt' ? <Cloud size={10} /> : <Cpu size={10} />} {m.analysis.latency[backend]} ms
                  </span>
                )}
                {m.analysis && m.analysis.level >= 1 && <NeonBadge level={m.analysis.level} size="sm" />}
              </div>
              <div className="feed-text">{m.text}</div>

              {analyzingId === m.id && (
                <div className="analyzing">
                  <span className="shimmer">Classifying with {backend === 'gpt' ? 'GPT (cloud)' : 'in-house model (on-device)'}…</span>
                </div>
              )}

              {m.analysis ? (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} transition={{ duration: 0.35 }}>
                  <div className="feed-cues">
                    {m.analysis.cues.map((c) => (
                      <CueChip key={c.cue} cue={c.cue} p={c.p} />
                    ))}
                  </div>
                  <div className="trace">
                    {m.analysis.trace.map((t, i) => (
                      <motion.div key={i} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.08 * i }}>
                        <span className="trace-arrow">›</span> {t}
                      </motion.div>
                    ))}
                  </div>
                </motion.div>
              ) : (
                analyzingId !== m.id && <div className="feed-clean">no cues</div>
              )}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </section>
  );
}
