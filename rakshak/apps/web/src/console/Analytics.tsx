import { AnimatePresence, motion } from 'framer-motion';
import { Activity, AlertTriangle, BrainCircuit, Cloud, Cpu, Database, Eye, Link2, ScrollText, Users } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { CueChip, NeonBadge, ScoreRing, StageStepper } from '../alerts/primitives';
import { BACKEND_META, HALF_LIFE_DAYS, LEVEL_META, SCORE_MAX, THRESHOLDS } from '../data/meta';
import { trackLabel } from '../lib/case';
import { PREVIEW_ID, useDemo } from '../store';
import type { Level } from '../types';

const decay = (score: number, days: number) => score * Math.pow(0.5, days / HALF_LIFE_DAYS);

/** Ask the engine drawer to show one evidence row (trace → evidence inspection). */
export const EVIDENCE_EVENT = 'rakshak:evidence';
let lastEvidence: string | null = null;
export function showEvidence(key: string) {
  lastEvidence = key; // the evidence tab may mount after the event fires
  window.dispatchEvent(new CustomEvent(EVIDENCE_EVENT, { detail: key }));
}

function useNames() {
  const participants = useDemo((s) => s.data.participants);
  const conversations = useDemo((s) => s.data.conversations);
  return useMemo(
    () => ({
      person: Object.fromEntries(participants.map((p) => [p.id, p.displayName])) as Record<string, string>,
      chat: Object.fromEntries(conversations.map((c) => [c.id, c.title])) as Record<string, string>,
    }),
    [participants, conversations],
  );
}

export function CaseCard() {
  const d = useDemo((s) => s.data);
  const names = useNames();
  const risk = d.risk;
  const top = risk?.tracks[0];
  const preview = d.scenarioId === PREVIEW_ID;
  // Only confirmed evidence is scored; pending findings are recorded but take no step.
  const scored = d.evidence.filter((e) => e.status === 'active' && e.senderId !== d.childId).length;
  const current = risk ? risk.score : preview && d.history.length ? decay(d.history[d.history.length - 1].score, d.simDay - d.history[d.history.length - 1].day) : 0;
  const level = (risk?.level ?? d.level) as Level;

  let title = `Case · ${names.person[d.childId] ?? 'child'}`;
  let sub = 'No active evidence · monitoring';
  if (preview) {
    title = 'Case · Contact Kabir';
    sub = 'Presentation preview · precomputed';
  } else if (top?.kind === 'grooming' && top.contactId) {
    title = `Case · Contact ${names.person[top.contactId] ?? top.contactId}`;
    sub = `first seen Day ${d.firstSeen[top.contactId] ?? '?'} · potential safeguarding concern`;
  } else if (top?.kind === 'bullying') {
    title = `Case · Bullying of ${names.person[d.childId] ?? 'child'}`;
    sub = `${top.senders.length} sender${top.senders.length === 1 ? '' : 's'} across ${top.conversations.length} chat${top.conversations.length === 1 ? '' : 's'}`;
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <div className="panel-title">{title}</div>
          <div className="panel-sub">{sub}</div>
        </div>
        <NeonBadge level={level} />
      </div>

      <div className="case-row">
        <ScoreRing score={current} />
        <div className="case-stats">
          <Stat k="Scored evidence" v={String(preview ? d.messages.filter((m) => m.analysis).length : scored)} />
          <Stat k="Dismissals" v={`${d.dismissals}×`} />
          <Stat k="Alerts fired" v={String(d.alerts.filter((a) => !a.preview || preview).length)} />
          <Stat
            k="Backend"
            v={
              <span className="backend-badge">
                {d.backend === 'gpt' ? <Cloud size={12} /> : <Cpu size={12} />}
                {BACKEND_META[d.backend].short}
              </span>
            }
          />
        </div>
      </div>

      {top?.kind === 'bullying' ? (
        <div className="track-chips">
          <span className="track-k">
            <Users size={12} /> Senders
          </span>
          {top.senders.map((s) => (
            <span key={s} className="track-chip">
              {names.person[s] ?? s}
            </span>
          ))}
          <span className="track-k">
            <Link2 size={12} /> Chats
          </span>
          {top.conversations.map((c) => (
            <span key={c} className="track-chip">
              {names.chat[c] ?? c}
            </span>
          ))}
        </div>
      ) : (
        <StageStepper stage={d.stage} active={d.history.length > 0 || !!top} />
      )}

      {risk && risk.tracks.length > 1 && (
        <div className="tracks">
          {risk.tracks.map((t) => (
            <div key={t.key} className="track-row">
              <span className="track-dot" style={{ background: LEVEL_META[t.level].color }} />
              <span className="track-name">{trackLabel(t, names.person)}</span>
              <span className="track-score">
                {t.score.toFixed(1)} · L{t.level}
              </span>
            </div>
          ))}
        </div>
      )}
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

/** Score over simulated days: decay curves between engine snapshots, threshold lines at 2 / 5 / 9. */
export function ScoreChart() {
  const history = useDemo((s) => s.data.history);
  const simDay = useDemo((s) => s.data.simDay);

  const W = 520;
  const H = 210;
  const pad = { l: 30, r: 16, t: 14, b: 26 };
  const maxDay = Math.max(7, simDay, ...history.map((h) => h.day));
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
        <div className="panel-sub">t½ = {HALF_LIFE_DAYS} days · prototype thresholds</div>
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
            {(i === history.length - 1 || history[i + 1].day !== h.day) && (
              <text x={x(h.day) + 7} y={y(h.score) - 7} className="chart-point">
                {h.score.toFixed(1)}
              </text>
            )}
          </g>
        ))}
        {lastPt && <circle cx={x(lastPt.day)} cy={y(lastPt.score)} r="4" fill={LEVEL_META[lastPt.level].color} className="chart-pulse" />}

        {!history.length && (
          <text x={W / 2} y={H / 2} textAnchor="middle" className="chart-empty">
            Waiting for the first analysis…
          </text>
        )}
      </svg>
    </section>
  );
}

const AGREE_LABEL: Record<string, string> = {
  agree: 'both models',
  contextual_only: 'context only',
  context_override: 'context override',
  needs_review: 'pending confirmation',
  single_model: 'single model',
};

/** Per-message engine output: real cues, fusion agreement, latency, rule trace. */
export function DebugFeed() {
  const messages = useDemo((s) => s.data.messages);
  const pending = useDemo((s) => s.data.pending);
  const backend = useDemo((s) => s.data.backend);
  const childId = useDemo((s) => s.data.childId);
  const evidence = useDemo((s) => s.data.evidence);
  const runError = useDemo((s) => s.data.runError);
  const names = useNames();
  const ref = useRef<HTMLDivElement>(null);
  const keyOf = (messageId: string, cue: string) => evidence.find((e) => e.messageId === messageId && e.cue === cue)?.key;

  const mounted = useRef(false);
  useEffect(() => {
    // Jump straight to the newest entry on first render, then follow new ones smoothly.
    const behavior = mounted.current ? 'smooth' : 'auto';
    mounted.current = true;
    const id = requestAnimationFrame(() => ref.current?.scrollTo({ top: ref.current.scrollHeight, behavior }));
    return () => cancelAnimationFrame(id);
  }, [messages, pending]);

  const msgs = messages.filter((m) => m.kind === 'msg');

  return (
    <section className="panel panel-feed">
      <div className="panel-head">
        <div className="panel-title">
          <ScrollText size={14} /> Engine trace
        </div>
        <div className="debug-note">
          <Eye size={11} /> Debug view · message text never goes to the guardian
        </div>
      </div>
      <div className="feed" ref={ref}>
        {msgs.length === 0 && <div className="feed-empty">Play a test case (Mode A) or start typing (Mode B).</div>}
        <AnimatePresence initial={false}>
          {msgs.map((m) => {
            const a = m.analysis;
            const lat = a ? a.latency[backend] ?? Object.values(a.latency)[0] : undefined;
            const isChild = m.senderId ? m.senderId === childId : m.from === 'victim';
            return (
              <motion.div
                key={m.id}
                className={`feed-row ${a && a.level >= 1 ? `feed-l${a.level}` : ''}`}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ type: 'spring', stiffness: 380, damping: 30 }}
              >
                <div className="feed-meta">
                  <span className={`who who-${isChild ? 'victim' : 'predator'}`}>{(m.senderId && names.person[m.senderId]) || (isChild ? 'CHILD' : 'CONTACT')}</span>
                  <span className="feed-time">
                    D{m.day} · {m.time}
                  </span>
                  {a && lat !== undefined && (
                    <span className="feed-latency">
                      {backend === 'gpt' ? <Cloud size={10} /> : <Cpu size={10} />} {lat} ms
                    </span>
                  )}
                  {a?.preview && <span className="feed-tag">preview</span>}
                  {a && a.level >= 1 && <NeonBadge level={a.level} size="sm" />}
                </div>
                {m.conversationId && names.chat[m.conversationId] && <div className="feed-conv">{names.chat[m.conversationId]}</div>}
                <div className="feed-text">{m.text}</div>

                {pending.includes(m.id) && (
                  <div className="analyzing">
                    <span className="shimmer">message saved · analysing conversation {backend === 'gpt' ? 'with ChatGPT (cloud)' : 'locally (RoBERTa + Qwen3.5)'}…</span>
                  </div>
                )}

                {a ? (
                  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} transition={{ duration: 0.35 }}>
                    {a.cues.length > 0 && (
                      <div className="feed-cues">
                        {a.cues.map((c) => (
                          <span
                            key={`${c.cue}-${c.targetId ?? ''}`}
                            className={`cue-wrap ${keyOf(m.id, c.cue) ? 'cue-link' : ''}`}
                            title={keyOf(m.id, c.cue) ? 'Show this evidence in case memory' : c.agreement ? AGREE_LABEL[c.agreement] : undefined}
                            onClick={() => {
                              const k = keyOf(m.id, c.cue);
                              if (k) showEvidence(k);
                            }}
                          >
                            <CueChip cue={c.cue} p={c.p} status={c.status} />
                            {c.modifier && c.modifier !== 'none' && <span className="cue-mod">{c.modifier}</span>}
                            {c.agreement && <span className={`cue-agree ag-${c.agreement}`}>{AGREE_LABEL[c.agreement]}</span>}
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="trace">
                      {a.trace.map((t, i) => (
                        <motion.div key={i} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.05 * i }}>
                          <span className="trace-arrow">›</span> {t}
                        </motion.div>
                      ))}
                    </div>
                  </motion.div>
                ) : (
                  !pending.includes(m.id) && (
                    <div className="feed-clean">
                      {a === undefined && m.id.startsWith('preview-')
                        ? 'preview message'
                        : backend === 'gpt'
                          ? 'message saved · not analysed · owner action required'
                          : runError
                            ? 'message saved · analysis failed or did not run (see the caption)'
                            : isChild
                              ? 'message saved · will be assessed in the next analysis of this chat'
                              : 'message saved · not analysed yet'}
                    </div>
                  )
                )}
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </section>
  );
}

/** Child-centric case memory: every evidence reference, grouped by conversation, with its provenance. */
export function EvidencePanel() {
  const evidence = useDemo((s) => s.data.evidence);
  const messages = useDemo((s) => s.data.messages);
  const risk = useDemo((s) => s.data.risk);
  const childId = useDemo((s) => s.data.childId);
  const names = useNames();
  const text = useMemo(() => Object.fromEntries(messages.map((m) => [m.id, m.text])), [messages]);
  const byConv = useMemo(() => {
    const g = new Map<string, typeof evidence>();
    for (const e of evidence) g.set(e.conversationId, [...(g.get(e.conversationId) ?? []), e]);
    return [...g.entries()];
  }, [evidence]);
  const other = new Set(risk?.otherTargets.map((o) => o.evidenceKey));
  const [focus, setFocus] = useState<string | null>(lastEvidence);
  useEffect(() => {
    const on = (e: Event) => setFocus((e as CustomEvent<string>).detail);
    window.addEventListener(EVIDENCE_EVENT, on);
    return () => window.removeEventListener(EVIDENCE_EVENT, on);
  }, []);
  useEffect(() => {
    if (focus) document.getElementById(`ev-${focus}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [focus]);

  return (
    <section className="panel panel-feed">
      <div className="panel-head">
        <div className="panel-title">
          <Database size={14} /> Case memory
        </div>
        <div className="debug-note">{evidence.length} evidence references · SQLite, survives reloads</div>
      </div>
      <div className="feed">
        {evidence.length === 0 && <div className="feed-empty">No evidence yet. Evidence appears once a model run finds something, with a stable ID per message, cue and target.</div>}
        {byConv.map(([conv, list]) => (
          <div key={conv} className="ev-group">
            <div className="ev-conv">{names.chat[conv] ?? conv}</div>
            {list.map((e) => (
              <div key={e.key} id={`ev-${e.key}`} className={`ev-row ev-${e.status} ${focus === e.key ? 'ev-focus' : ''}`}>
                <div className="ev-top">
                  <CueChip cue={e.cue} p={e.p} status={e.status} />
                  <span className="ev-who">
                    D{e.day} · {names.person[e.senderId] ?? e.senderId} → {e.targetId ? names.person[e.targetId] ?? e.targetId : 'target unknown'}
                  </span>
                </div>
                <div className="ev-meta">
                  <span className={`cue-agree ag-${e.agreement}`}>{AGREE_LABEL[e.agreement]}</span>
                  <span>{e.sources.join(' + ')}</span>
                  <span>{e.status.replace('_', ' ')}</span>
                  {e.modifier !== 'none' && <span>{e.modifier}</span>}
                  {e.senderId === childId && <span>child's own message · not scored</span>}
                  {other.has(e.key) && <span>aimed at someone else · not scored for {names.person[childId]}</span>}
                  {e.targetBasis === 'private_chat' && <span>target from 1:1 chat</span>}
                </div>
                {text[e.messageId] && <div className="ev-text">“{text[e.messageId]}”</div>}
                {e.rationale && <div className="ev-why">{e.rationale}</div>}
                <div className="ev-key">{e.key} · message {e.messageId} · run {e.runId}</div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

/** Real model status and the latest run, exactly as returned by the server (validated). */
export function ModelsPanel() {
  const health = useDemo((s) => s.data.health);
  const online = useDemo((s) => s.data.serverOnline);
  const run = useDemo((s) => s.data.lastRun);
  const runError = useDemo((s) => s.data.runError);
  const names = useNames();
  const messages = useDemo((s) => s.data.messages);
  const msgText = useMemo(() => Object.fromEntries(messages.map((m) => [m.id, m.text])) as Record<string, string>, [messages]);
  const label = (id: string) => (msgText[id] ? `“${msgText[id].slice(0, 46)}${msgText[id].length > 46 ? '…' : ''}”` : id);

  return (
    <section className="panel panel-feed">
      <div className="panel-head">
        <div className="panel-title">
          <BrainCircuit size={14} /> Models
        </div>
        <div className="debug-note">Pretrained RoBERTa and Qwen weights are third-party; fusion, memory and scoring are RAKSHAK's</div>
      </div>
      <div className="feed">
        {online === false && <div className="mdl-err"><AlertTriangle size={13} /> Inference service offline. Start it with <code>npm run server</code> (see README).</div>}
        {health && (
          <div className="mdl-grid">
            <ModelCard
              name="RoBERTa"
              role="per-message bullying classifier (binary)"
              ok={health.roberta.ready}
              lines={[health.roberta.model, health.roberta.ready ? `device ${health.roberta.device} · loaded in ${health.roberta.loadMs} ms` : health.roberta.error ?? 'loading…']}
            />
            <ModelCard
              name="Qwen3.5 4B"
              role="contextual analyser via Ollama"
              ok={health.qwen.reachable && health.qwen.modelPresent}
              lines={[
                health.qwen.model,
                !health.qwen.reachable ? 'Ollama not reachable' : !health.qwen.modelPresent ? 'model not pulled' : health.qwen.loaded ? `in memory · ${((health.qwen.vramBytes ?? 0) / 1e9).toFixed(1)} GB VRAM · ctx ${health.qwen.contextLength}` : `ready · loads on first request · ctx ${health.qwen.numCtx}`,
              ]}
            />
            <ModelCard
              name="ChatGPT"
              role="cloud contextual analyser (owner-initiated)"
              ok={health.chatgpt.reachable && health.chatgpt.status === 'connected' && health.chatgpt.sharing}
              lines={[!health.chatgpt.reachable ? health.chatgpt.reason ?? 'companion offline' : `status: ${health.chatgpt.status}${health.chatgpt.sharing ? ' · plan usage granted' : ''}`]}
            />
          </div>
        )}

        {runError && (
          <div className="mdl-err">
            <AlertTriangle size={13} /> {runError.code}: {runError.message}
          </div>
        )}

        {!run && <div className="feed-empty">No model run yet.</div>}
        {run && (
          <div className="mdl-run">
            <div className="mdl-run-head">
              <span className="backend-badge">{run.backend === 'local_hybrid' ? <Cpu size={12} /> : <Cloud size={12} />} {run.backend === 'local_hybrid' ? 'RAKSHAK Hybrid · local' : 'ChatGPT · cloud'}</span>
              <span className={`mdl-assess as-${run.assessment}`}>{run.assessment}</span>
              <span className="mdl-conv">{names.chat[run.conversationId] ?? run.conversationId}</span>
            </div>
            <div className="mdl-kv">
              <span>Models</span>
              <span>{[run.models.classifier, run.models.contextual].filter(Boolean).join(' + ')}</span>
              <span>Latency</span>
              <span>
                total {Math.round(run.latency.totalMs)} ms{run.latency.robertaMs != null ? ` · RoBERTa ${Math.round(run.latency.robertaMs)} ms` : ''}
                {run.latency.contextualMs != null ? ` · ${run.backend === 'local_hybrid' ? 'Qwen' : 'ChatGPT'} ${Math.round(run.latency.contextualMs)} ms` : ''} (measured)
              </span>
              <span>Context</span>
              <span>
                {run.contextStats.messages} messages · {run.contextStats.relatedEvidence} cross-chat evidence refs · ~{run.contextStats.approxTokens} tokens{run.contextStats.truncated ? ' · older chatter omitted' : ''}
              </span>
              <span>Target</span>
              <span>{run.targetParticipantId ? names.person[run.targetParticipantId] ?? run.targetParticipantId : 'not established'}</span>
            </div>
            {run.conversationReading && (
              <>
                <div className="mdl-k">Whole-chat reading (written before any finding)</div>
                <div className="mdl-expl">{run.conversationReading}</div>
              </>
            )}
            {run.explanation && <div className="mdl-expl">{run.explanation}</div>}
            {run.uncertainReason && <div className="mdl-unc">Uncertain: {run.uncertainReason}</div>}

            {run.roberta.length > 0 && (
              <>
                <div className="mdl-k">RoBERTa (raw softmax, not a calibrated probability)</div>
                {run.roberta.map((r) => (
                  <div key={r.messageId} className="mdl-line">
                    <span className={`mdl-pill ${r.predicted === 'bullying' ? 'hot' : ''}`}>{r.bullying.toFixed(2)}</span> {label(r.messageId)} <span className="feed-time">{r.latencyMs} ms</span>
                  </div>
                ))}
              </>
            )}
            <div className="mdl-k">{run.backend === 'local_hybrid' ? 'Qwen' : 'ChatGPT'} findings (validated against supplied message IDs)</div>
            {run.findings.length === 0 && <div className="mdl-line">none</div>}
            {run.findings.map((f, i) => (
              <div key={i} className="mdl-line">
                <CueChip cue={f.cue} /> {f.modifier !== 'none' && <span className="cue-mod">{f.modifier}</span>} <span className="feed-time">{f.confidence}{f.verification ? ` · ${f.verification}` : ''}</span> {label(f.messageId)}
                {f.targetId && <span className="feed-time"> → {names.person[f.targetId] ?? f.targetId}</span>}
                {f.rationale && <div className="ev-why">{f.rationale}</div>}
                {f.contextBasis && <div className="ev-why">Context: {f.contextBasis}</div>}
              </div>
            ))}
            {run.patterns.length > 0 && (
              <>
                <div className="mdl-k">Patterns</div>
                {run.patterns.map((p, i) => (
                  <div key={i} className="mdl-line">
                    <b>{p.type.replace(/_/g, ' ')}</b> · {p.summary}
                  </div>
                ))}
              </>
            )}
            <div className="mdl-k">Fusion</div>
            {run.fusion.length === 0 && <div className="mdl-line">no evidence written for the new messages</div>}
            {run.fusion.map((f, i) => (
              <div key={i} className="mdl-line">
                <span className={`cue-agree ag-${f.agreement}`}>{AGREE_LABEL[f.agreement]}</span> {f.cue} → {f.status.replace('_', ' ')} · {f.note}
              </div>
            ))}
            {run.supersededEvidence.length > 0 && <div className="mdl-line">Reconciled: {run.supersededEvidence.length} earlier reading(s) superseded</div>}
            {run.warnings.length > 0 && (
              <>
                <div className="mdl-k">Validation warnings</div>
                {run.warnings.map((w, i) => (
                  <div key={i} className="mdl-line mdl-warn">
                    {w}
                  </div>
                ))}
              </>
            )}
            {run.error && (
              <div className="mdl-err">
                <AlertTriangle size={13} /> {run.error.code}: {run.error.message}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function ModelCard({ name, role, ok, lines }: { name: string; role: string; ok: boolean; lines: string[] }) {
  return (
    <div className={`mdl-card ${ok ? 'ok' : 'off'}`}>
      <div className="mdl-name">
        <span className="status-dot" /> {name}
      </div>
      <div className="mdl-role">{role}</div>
      {lines.map((l, i) => (
        <div key={i} className="mdl-sub">
          {l}
        </div>
      ))}
    </div>
  );
}
