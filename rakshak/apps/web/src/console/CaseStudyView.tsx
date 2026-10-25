// Case study page, demo first: the real case's name, one sourced sentence, the reconstruction label, then Play.
// Background, attribution details and sources sit in a collapsed "Case background & sources" section. Documented
// facts are UI-only and never reach a model. "Observed in this run" reports what the live pipeline actually did on
// the reconstruction, including misses. CaseStudyStrip keeps the label (and the intervention callout) on screen
// during playback and live continuation.

import { motion } from 'framer-motion';
import { ArrowRight, BookOpen, ChevronDown, CircleAlert, ExternalLink, History, Loader2, Play, RotateCw, ShieldCheck, Theater, X } from 'lucide-react';
import { useState } from 'react';
import { CASE_STUDIES, caseStudyFor, INTERVENTION_HEADLINE, RECONSTRUCTION_LABEL, RECONSTRUCTION_NOTE, type CaseStudy, type Sourced } from '../data/caseStudies';
import { CUE_META, LEVEL_META } from '../data/meta';
import { loadHistory, play, playCaseStudy, scriptLength, useDemo } from '../store';

function Refs({ cs, s }: { cs: CaseStudy; s: Sourced }) {
  return (
    <>
      {s.sources.map((i) => (
        <a key={i} className="cs-ref" href={cs.sources[i].url} target="_blank" rel="noopener noreferrer">
          [{i + 1}]
        </a>
      ))}
    </>
  );
}

/** Loads the case study and starts Mode A playback; shows an honest error with Retry if loading fails. */
export function PlayReconstruction({ scenarioId, onStarted, small }: { scenarioId: string; onStarted?: () => void; small?: boolean }) {
  const online = useDemo((s) => s.data.serverOnline);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const start = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const err = await playCaseStudy(scenarioId);
    setBusy(false);
    if (err) setError(err);
    else onStarted?.();
  };
  return (
    <>
      <button className={small ? 'chip-btn' : 'btn-amber'} disabled={busy || online === false} onClick={() => void start()}>
        {busy ? <Loader2 size={small ? 12 : 14} className="spin" /> : error ? <RotateCw size={small ? 12 : 14} /> : <Play size={small ? 12 : 14} />}
        {busy ? 'Loading…' : error ? 'Retry' : 'Play reconstruction'}
      </button>
      {error && (
        <div className="cs-error" role="alert">
          <CircleAlert size={12} /> {error}
        </div>
      )}
      {online === false && !error && <div className="help-note">The inference service is offline. Start it to play the reconstruction.</div>}
    </>
  );
}

export function CaseStudyView({ caseKey, onClose }: { caseKey: string; onClose: () => void }) {
  const cs = CASE_STUDIES.find((c) => c.key === caseKey);
  const scenarios = useDemo((s) => s.data.scenarios);
  const d = useDemo((s) => s.data);
  const [live, setLive] = useState(false);
  if (!cs) return null;
  const sc = scenarios.find((s) => s.id === cs.scenarioId);
  const active = d.scenarioId === cs.scenarioId && (d.origin === 'scripted' || d.origin === 'history');
  const names = Object.fromEntries([...(sc ? [[sc.child.id, sc.child.name]] : []), ...(sc?.participants ?? []).map((p) => [p.id, p.name])]);

  return (
    <motion.div className="help-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.div className="help cs" role="dialog" aria-label={`Case study: ${cs.person}`} initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 20, opacity: 0 }} onClick={(e) => e.stopPropagation()}>
        <div className="help-head">
          <div>
            <div className="help-kicker">
              <BookOpen size={13} /> Case study
            </div>
            <div className="help-title">{cs.person}</div>
            <div className="help-sub">
              {cs.context.text} <Refs cs={cs} s={cs.context} />
            </div>
          </div>
          <button className="sheet-x" onClick={onClose} aria-label="Close">
            <X size={15} strokeWidth={2.6} />
          </button>
        </div>

        <div className="help-body">
          <section className="help-card wide cs-hero">
            <div className="cs-notice">
              <Theater size={14} /> {RECONSTRUCTION_LABEL}
            </div>
            <h3>{INTERVENTION_HEADLINE}</h3>
            <div className="cs-flow" aria-label="What the demonstration shows">
              <span>Concerning messages</span>
              <ArrowRight size={12} />
              <span>Actual engine finding</span>
              <ArrowRight size={12} />
              <span>Guardian alert</span>
              <ArrowRight size={12} />
              <span>Get help</span>
            </div>
            <div className="cs-actions">
              {sc ? <PlayReconstruction scenarioId={cs.scenarioId} onStarted={onClose} /> : <p className="help-p muted">The inference service is offline, so the reconstruction could not be listed.</p>}
              {sc && sc.checkpoints.length > 0 && (
                <button className="chip-btn" aria-expanded={live} onClick={() => setLive((v) => !v)}>
                  <History size={12} /> Continue live <ChevronDown size={12} className={live ? 'cs-rot' : ''} />
                </button>
              )}
            </div>
            {live &&
              sc?.checkpoints.map((cp) => (
                <button
                  key={cp.id}
                  className="cs-cp"
                  onClick={() => {
                    void loadHistory(cs.scenarioId, { checkpoint: cp.id });
                    onClose();
                  }}
                >
                  <b>Continue live from here</b> · {cp.label}
                  <span>
                    Loads the first {cp.after} reconstructed messages; what you type next is a hypothetical continuation. {cp.intro}
                  </span>
                </button>
              ))}
            <p className="help-note">
              {cs.attribution.text} <Refs cs={cs} s={cs.attribution} />
            </p>
          </section>

          <section className="help-card wide">
            <h3>Observed in this run</h3>
            {!active ? (
              <p className="help-p muted">Play the reconstruction (or continue it live) to see what the live pipeline actually flags on its key moments. Nothing is forced.</p>
            ) : (
              <ul className="help-list">
                {cs.keyMoments.map((k) => {
                  const m = sc?.messages[k.at - 1];
                  const shown = m && d.messages.find((x) => x.id === m.id);
                  const ev = m ? d.evidence.filter((e) => e.messageId === m.id && (e.status === 'active' || e.status === 'needs_review')) : [];
                  const level = shown?.analysis?.level;
                  return (
                    <li key={k.at}>
                      <b>Message {k.at}</b> ({names[m?.senderId ?? ''] ?? m?.senderId}: {k.why}) ·{' '}
                      {!shown
                        ? 'not reached yet'
                        : !shown.analysis
                          ? 'saved, not analysed yet'
                          : ev.length
                            ? `flagged: ${ev.map((e) => `${CUE_META[e.cue].label}${e.status === 'needs_review' ? ' (pending confirmation)' : ''}`).join(', ')} · case ${LEVEL_META[level ?? 0].short}`
                            : `not flagged in this run (a model miss or a different judgement) · case ${LEVEL_META[level ?? 0].short}`}
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="help-note">Key moments are the team’s own reading of the reconstruction. They are shown only here and never steer the models.</p>
          </section>

          <details className="help-card wide cs-more">
            <summary>
              <ChevronDown size={14} /> Case background & sources
            </summary>
            <p className="help-p">
              <b>{RECONSTRUCTION_NOTE}</b> {cs.labelling} The models see only neutral names (“Child”, “Account 1”), never the real ones, and the case’s outcome is never given to them.
            </p>
            <h4>Documented background</h4>
            <ul className="help-list">
              {cs.documented.map((f, i) => (
                <li key={i}>
                  {f.text} <Refs cs={cs} s={f} />
                </li>
              ))}
            </ul>
            <h4>
              <ShieldCheck size={13} /> Possible support with RAKSHAK
            </h4>
            <ul className="help-list">
              {cs.support.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
            <p className="help-note">
              What the prototype makes available during the reconstruction. RAKSHAK did not exist then and never analysed the real conversations; this does not show that it would have detected the real case or prevented any outcome.
            </p>
            <h4>Sources</h4>
            <ol className="help-list">
              {cs.sources.map((s, i) => (
                <li key={i}>
                  <a href={s.url} target="_blank" rel="noopener noreferrer">
                    {s.title} <ExternalLink size={10} />
                  </a>{' '}
                  · {s.publisher} · {s.date}
                  {s.note ? <div className="help-note">{s.note}</div> : null}
                </li>
              ))}
            </ol>
            <p className="help-note">If you or someone you know is struggling: in India, Tele-MANAS (14416) offers free 24×7 support; in the US and Canada, call or text 988.</p>
          </details>
        </div>
      </motion.div>
    </motion.div>
  );
}

/**
 * Shown on the simulation page while a case study is the current case: the reconstruction label, and, once the real
 * pipeline raises a guardian-level alert in this case, the intervention callout tied to the existing Get help view.
 * If playback finishes with no guardian alert, it says so.
 */
export function CaseStudyStrip({ onOpenCaseStudy }: { onOpenCaseStudy: (key: string) => void }) {
  const d = useDemo((s) => s.data);
  const dispatch = useDemo((s) => s.dispatch);
  const sc = d.scenarios.find((s) => s.id === d.scenarioId);
  const cs = caseStudyFor(sc?.caseStudy);
  if (!sc || sc.kind !== 'case_study' || !cs || (d.origin !== 'scripted' && d.origin !== 'history')) return null;
  const guardian = d.alerts.filter((a) => a.level >= 2);
  // The alert playback paused at; otherwise the first live one (after the loaded history), then any.
  const alert = guardian.find((a) => a.id === d.csHold) ?? guardian.find((a) => !a.withdrawn && !a.historical) ?? guardian.find((a) => !a.withdrawn) ?? guardian[0];
  const liveCount = d.origin === 'history' ? d.messages.filter((m) => m.kind === 'msg').length - (d.checkpoint ?? 0) : 0;
  const finished = d.origin === 'scripted' && !d.playing && d.cursor >= scriptLength() && !d.analyzingId;

  return (
    <div className="cs-strip">
      <div className="cs-strip-row">
        <Theater size={13} />
        <b>{RECONSTRUCTION_LABEL}</b>
        <span>· {cs.person}</span>
        {d.origin === 'history' && <span>· messages after #{d.checkpoint} are a hypothetical continuation{liveCount > 0 ? ` (${liveCount} so far)` : ''}</span>}
        <button className="chip-btn" onClick={() => onOpenCaseStudy(cs.key)}>
          <BookOpen size={11} /> Case background
        </button>
      </div>
      {alert ? (
        <motion.div className="cs-callout" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
          <div className="cs-callout-t">
            <ShieldCheck size={14} /> An opportunity to intervene.
          </div>
          <p>Rakshak could bring the escalating threat to a trusted adult’s attention, so support can begin.</p>
          <p className="cs-callout-n">
            Actual {LEVEL_META[alert.level].short} guardian alert from this run, Day {alert.day} · {alert.time}
            {alert.historical ? ' · found while analysing the loaded history' : ''}
            {alert.withdrawn ? ' · later withdrawn by the pipeline on a fuller reading' : ''}
          </p>
          <div className="pop-inline">
            <button className="chip-btn" onClick={() => dispatch({ type: 'openHelp', alert, tab: 'understand' })}>
              <ShieldCheck size={12} /> Review guardian alert
            </button>
            {d.csHold === alert.id && d.origin === 'scripted' && !d.playing && (
              <button className="chip-btn" onClick={() => void play()}>
                <Play size={12} /> Continue reconstruction
              </button>
            )}
          </div>
        </motion.div>
      ) : finished ? (
        <div className="cs-callout cs-callout-none">No guardian-level alert in this run. This is the pipeline’s actual result on the reconstruction; nothing is forced.</div>
      ) : null}
    </div>
  );
}
