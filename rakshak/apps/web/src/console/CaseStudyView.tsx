// Case study page: 1 Documented background · 2 Fictional recreation · 3 Guided playback · 4 Continue live ·
// 5 Possible support · 6 Sources. Documented facts are UI-only and never reach a model. The "observed in this run"
// panel reports what the live pipeline actually did on the recreation, including misses.

import { motion } from 'framer-motion';
import { BookOpen, ExternalLink, Play, ShieldCheck, Theater, X } from 'lucide-react';
import { CASE_STUDIES, RECREATION_NOTICE } from '../data/caseStudies';
import { CUE_META, LEVEL_META } from '../data/meta';
import { loadHistory, selectScenario, setMode, useDemo } from '../store';

export function CaseStudyView({ caseKey, onClose }: { caseKey: string; onClose: () => void }) {
  const cs = CASE_STUDIES.find((c) => c.key === caseKey);
  const scenarios = useDemo((s) => s.data.scenarios);
  const d = useDemo((s) => s.data);
  if (!cs) return null;
  const sc = scenarios.find((s) => s.id === cs.scenarioId);
  const active = d.scenarioId === cs.scenarioId && (d.origin === 'scripted' || d.origin === 'history');
  const names = Object.fromEntries((sc?.participants ?? []).map((p) => [p.id, p.name]));

  return (
    <motion.div className="help-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.div className="help cs" role="dialog" aria-label={`Case study: ${cs.person}`} initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 20, opacity: 0 }} onClick={(e) => e.stopPropagation()}>
        <div className="help-head">
          <div>
            <div className="help-kicker">
              <BookOpen size={13} /> Case study
            </div>
            <div className="help-title">{cs.person}</div>
            <div className="help-sub">{cs.pattern}</div>
          </div>
          <button className="sheet-x" onClick={onClose} aria-label="Close">
            <X size={15} strokeWidth={2.6} />
          </button>
        </div>

        <div className="help-body">
          <section className="help-card wide">
            <h3>1 · Documented background</h3>
            <ul className="help-list">
              {cs.documented.map((f, i) => (
                <li key={i}>
                  {f.text}{' '}
                  {f.sources.map((s) => (
                    <a key={s} className="cs-ref" href={cs.sources[s].url} target="_blank" rel="noopener noreferrer">
                      [{s + 1}]
                    </a>
                  ))}
                </li>
              ))}
            </ul>
            <p className="help-note">Summarised from the sources below. If you or someone you know is struggling, Tele-MANAS (14416) offers free 24×7 support in India.</p>
          </section>

          <section className="help-card wide cs-fiction">
            <h3>
              <Theater size={15} /> 2 · Fictional recreation
            </h3>
            <div className="cs-notice">{RECREATION_NOTICE}</div>
            {sc ? (
              <>
                <p className="help-p">{sc.intro}</p>
                <p className="help-note">
                  Fictional people: {sc.child.name} (the protected child), {sc.participants.map((p) => `${p.name} (${p.role})`).join(', ')}. {sc.messages.length} synthetic messages across {sc.conversations.length} chat
                  {sc.conversations.length === 1 ? '' : 's'}. The real case’s outcome is never given to the models.
                </p>
              </>
            ) : (
              <p className="help-p muted">The inference service is offline, so the recreation could not be listed.</p>
            )}
          </section>

          <section className="help-card">
            <h3>3 · Guided playback</h3>
            <p className="help-p">Plays the fictional messages one by one through the real pipeline. Whatever the models find decides the alerts; nothing is forced.</p>
            <button
              className="btn-amber"
              disabled={!sc}
              onClick={() => {
                setMode('A');
                void selectScenario(cs.scenarioId);
                onClose();
              }}
            >
              <Play size={14} /> Load in Guided Demo
            </button>
          </section>

          <section className="help-card">
            <h3>4 · Continue live</h3>
            <p className="help-p">Load the recreation up to a point, then type what happens next as any participant.</p>
            {(sc?.checkpoints ?? []).map((cp) => (
              <button
                key={cp.id}
                className="cs-cp"
                onClick={() => {
                  void loadHistory(cs.scenarioId, { checkpoint: cp.id });
                  onClose();
                }}
              >
                <b>Continue live from here</b> · {cp.label}
                <span>{cp.intro}</span>
              </button>
            ))}
          </section>

          <section className="help-card">
            <h3>5a · Documented events</h3>
            <ul className="help-list">
              {cs.documented.slice(1, 4).map((f, i) => (
                <li key={i}>
                  {f.text} {f.sources.map((s) => `[${s + 1}]`).join('')}
                </li>
              ))}
            </ul>
            <p className="help-note">Sourced facts about the real case. RAKSHAK did not exist then and could not have analysed the real conversations.</p>
          </section>

          <section className="help-card">
            <h3>
              <ShieldCheck size={15} /> 5b · Possible support with RAKSHAK
            </h3>
            <ul className="help-list">
              {cs.support.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
            <p className="help-note">What the prototype makes available during the fictional recreation. It does not show that RAKSHAK would have detected the real case, or that any outcome would have been prevented.</p>
          </section>

          <section className="help-card wide">
            <h3>Observed in this run</h3>
            {!active ? (
              <p className="help-p muted">Load the recreation (playback or continue live) to see what the live pipeline actually flags on its key moments.</p>
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
                            ? `flagged: ${ev.map((e) => `${CUE_META[e.cue].label}${e.status === 'needs_review' ? ' (needs review)' : ''}`).join(', ')} · case ${LEVEL_META[level ?? 0].short}`
                            : `not flagged in this run (a model miss or a different judgement) · case ${LEVEL_META[level ?? 0].short}`}
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="help-note">Key moments are the team’s own reading of the recreation. They are shown only here and never steer the models.</p>
          </section>

          <section className="help-card wide">
            <h3>6 · Sources</h3>
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
          </section>
        </div>
      </motion.div>
    </motion.div>
  );
}
