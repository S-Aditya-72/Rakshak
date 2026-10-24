// Left-hand "Studio" panel: what the presenter can do in the selected mode. Every action that replaces the case
// is an explicit button; merely switching modes never does.

import { motion } from 'framer-motion';
import { BookOpen, CircleAlert, History, Loader2, MessageSquarePlus, PanelLeftClose, Play, RotateCw, SquareX, Theater } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { RECREATION_NOTICE } from '../data/caseStudies';
import { LEVEL_META } from '../data/meta';
import type { ScenarioView } from '../lib/api';
import { MODE_META, ORIGIN_META } from '../lib/flow';
import { cancelHistoryInit, childNameOf, continueLiveFromHere, initHistory, loadHistory, PREVIEW_ID, scriptLength, selectScenario, startFreshConversation, useDemo } from '../store';

export function Studio({ onClose, onOpenCaseStudy }: { onClose: () => void; onOpenCaseStudy: (key: string) => void }) {
  const mode = useDemo((s) => s.data.mode);
  return (
    <motion.aside className="drawer studio" initial={{ opacity: 0, x: -60 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -60, transition: { duration: 0.2 } }} transition={{ type: 'spring', stiffness: 260, damping: 30 }}>
      <div className="drawer-head">
        <div>
          <div className="drawer-title">
            {mode} · {MODE_META[mode].name}
          </div>
          <div className="drawer-sub">{MODE_META[mode].blurb}</div>
        </div>
        <button className="dock-icon" onClick={onClose} aria-label="Close studio panel">
          <PanelLeftClose size={16} />
        </button>
      </div>
      <CaseStatus />
      <div className="drawer-body">
        {mode === 'A' && <GuidedPanel onOpenCaseStudy={onOpenCaseStudy} />}
        {mode === 'B' && <ContinuePanel onOpenCaseStudy={onOpenCaseStudy} />}
        {mode === 'C' && <FreeChatPanel />}
      </div>
    </motion.aside>
  );
}

/** What the current case is, independent of the selected mode. */
function CaseStatus() {
  const d = useDemo((s) => s.data);
  const sc = d.scenarios.find((s) => s.id === d.scenarioId);
  if (!d.origin) return <div className="case-status muted">No case loaded yet.</div>;
  const meta = ORIGIN_META[d.origin];
  return (
    <div className={`case-status tone-${meta.tone}`}>
      <div className="case-status-k">Current case · {meta.label}</div>
      <div className="case-status-v">
        {d.origin === 'preview' ? 'Six days, one stranger' : d.origin === 'fresh' ? 'New conversation' : sc?.title ?? d.scenarioId}
        {sc?.kind === 'case_study' && <span className="studio-tag">fictional recreation</span>}
      </div>
      <div className="case-status-s">
        Protected child: {childNameOf(d)}
        {d.origin === 'history' && d.checkpoint ? ` · history: first ${d.checkpoint} messages, live after that` : ''}
        {d.origin === 'scripted' ? ` · played ${d.cursor}/${scriptLength()}` : ''} · {LEVEL_META[d.level].short} · score {d.score.toFixed(1)}
      </div>
    </div>
  );
}

function ScenarioRow({ s, on, onClick, sub }: { s: ScenarioView; on: boolean; onClick: () => void; sub?: string }) {
  return (
    <button className={`scn-item ${on ? 'on' : ''}`} onClick={onClick}>
      <span className="scn-num">{s.kind === 'case_study' ? <Theater size={13} /> : s.number}</span>
      <span className="scn-text">
        <span className="scn-title">{s.title}</span>
        <span className="scn-sub">{sub ?? s.tests}</span>
      </span>
    </button>
  );
}

function CaseStudyCards({ onOpenCaseStudy, onPick, pickLabel }: { onOpenCaseStudy: (key: string) => void; onPick: (s: ScenarioView) => void; pickLabel: string }) {
  const all = useDemo((s) => s.data.scenarios);
  const scenarios = useMemo(() => all.filter((x) => x.kind === 'case_study'), [all]);
  if (!scenarios.length) return <div className="pop-note">Case studies appear when the inference service is running.</div>;
  return (
    <>
      {scenarios.map((s) => (
        <div key={s.id} className="cs-card">
          <div className="cs-card-t">
            <Theater size={13} /> {s.title}
          </div>
          <div className="cs-card-s">{s.tests}</div>
          <div className="cs-card-n">{RECREATION_NOTICE}</div>
          <div className="pop-inline">
            <button className="chip-btn" onClick={() => onOpenCaseStudy(s.caseStudy ?? '')}>
              <BookOpen size={12} /> Case study
            </button>
            <button className="chip-btn" onClick={() => onPick(s)}>
              <Play size={12} /> {pickLabel}
            </button>
          </div>
        </div>
      ))}
    </>
  );
}

// ---------- A · Guided Demo ----------

function GuidedPanel({ onOpenCaseStudy }: { onOpenCaseStudy: (key: string) => void }) {
  const d = useDemo((s) => s.data);
  const online = d.serverOnline;
  const core = d.scenarios.filter((s) => s.kind === 'core');
  const sc = d.scenarios.find((s) => s.id === d.scenarioId);
  const total = scriptLength();
  const cp = sc?.checkpoints.find((c) => c.after === d.cursor);
  const passed = sc?.checkpoints.filter((c) => c.after < d.cursor).pop();

  return (
    <div className="studio-body">
      {d.origin === 'scripted' && d.cursor > 0 && (
        <div className="studio-box">
          <div className="studio-k">Continue live from here</div>
          {d.playing ? (
            <p className="studio-p">Pause playback to continue live from the current message.</p>
          ) : (
            <>
              <p className="studio-p">
                Keeps everything played so far ({d.cursor} of {total} messages{cp ? ` · checkpoint “${cp.label}”` : passed ? ` · past checkpoint “${passed.label}”` : ''}). Script lines after message {d.cursor} are never sent.
              </p>
              <button className="btn-amber" onClick={() => continueLiveFromHere()}>
                <History size={14} /> Continue live from message {d.cursor}
              </button>
            </>
          )}
        </div>
      )}

      <div className="studio-k">Core examples · scripted, real inference</div>
      <div className="scn-list">
        {core.map((s) => (
          <ScenarioRow key={s.id} s={s} on={d.scenarioId === s.id && d.origin === 'scripted'} onClick={() => selectScenario(s.id)} />
        ))}
        {online === false && core.length === 0 && <div className="pop-note">Inference service offline. Start apps/server to run the live examples.</div>}
      </div>

      <div className="studio-k">Case studies · fictional recreations</div>
      <CaseStudyCards onOpenCaseStudy={onOpenCaseStudy} onPick={(s) => selectScenario(s.id)} pickLabel="Load playback" />

      <div className="studio-k">Predefined preview · not live AI</div>
      <button className={`scn-item scn-preview ${d.scenarioId === PREVIEW_ID ? 'on' : ''}`} onClick={() => selectScenario(PREVIEW_ID)}>
        <span className="scn-num">P</span>
        <span className="scn-text">
          <span className="scn-title">Presentation preview (offline)</span>
          <span className="scn-sub">Precomputed six-day script with hand-made analyses. Not live AI output.</span>
        </span>
      </button>
      {d.origin && d.origin !== 'scripted' && d.origin !== 'preview' && <p className="studio-note">Picking an example replaces the current {ORIGIN_META[d.origin].label.toLowerCase()} case.</p>}
    </div>
  );
}

// ---------- B · Continue the Conversation ----------

function ContinuePanel({ onOpenCaseStudy }: { onOpenCaseStudy: (key: string) => void }) {
  const d = useDemo((s) => s.data);
  const all = d.scenarios;
  const [pick, setPick] = useState<string | null>(d.scenarioId && all.some((s) => s.id === d.scenarioId) ? d.scenarioId : all[0]?.id ?? null);
  const sc = all.find((s) => s.id === pick) ?? null;
  const [cpId, setCpId] = useState<string | null>(sc?.checkpoints[0]?.id ?? null);
  useEffect(() => {
    if (!pick && all[0]) setPick(all[0].id);
  }, [all, pick]);
  useEffect(() => {
    const cur = d.origin === 'history' && d.scenarioId === sc?.id ? sc?.checkpoints.find((c) => c.after === d.checkpoint)?.id : null;
    setCpId(cur ?? sc?.checkpoints[0]?.id ?? null);
  }, [sc?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const cp = sc?.checkpoints.find((c) => c.id === cpId) ?? null;
  const loadedHere = d.origin === 'history' && d.scenarioId === sc?.id && d.checkpoint === cp?.after;
  const names = sc ? Object.fromEntries([[sc.child.id, sc.child.name], ...sc.participants.map((p) => [p.id, p.name])]) : {};
  const startMsg = sc && cp ? sc.messages[cp.after - 1] : null;
  const activeCp = d.origin === 'history' ? all.find((s) => s.id === d.scenarioId)?.checkpoints.find((c) => c.after === d.checkpoint) : null;

  return (
    <div className="studio-body">
      {d.origin === 'scripted' && d.cursor > 0 && (
        <div className="studio-box">
          <div className="studio-k">Current playback</div>
          <p className="studio-p">The Guided Demo case is paused at message {d.cursor}. Continue it live without replaying or losing anything.</p>
          <button className="btn-amber" onClick={() => continueLiveFromHere()}>
            <History size={14} /> Continue live from message {d.cursor}
          </button>
        </div>
      )}

      <HistoryStatus />

      {activeCp && d.origin === 'history' && (
        <div className="studio-box">
          <div className="studio-k">Presenter ideas · not sent to any model</div>
          <p className="studio-p">{activeCp.intro}</p>
          <ul className="studio-ideas">
            {activeCp.suggestions.map((s) => (
              <li key={s}>“{s}”</li>
            ))}
          </ul>
          <p className="studio-note">Type anything, including messages nobody scripted. These are only prompts for the presenter.</p>
        </div>
      )}

      <div className="studio-k">1 · Choose an earlier conversation</div>
      <div className="scn-list">
        {all.map((s) => (
          <ScenarioRow key={s.id} s={s} on={s.id === pick} onClick={() => setPick(s.id)} sub={s.kind === 'case_study' ? 'Fictional case-study recreation' : s.subtitle} />
        ))}
      </div>
      {sc?.kind === 'case_study' && (
        <div className="cs-card">
          <div className="cs-card-n">{RECREATION_NOTICE}</div>
          <button className="chip-btn" onClick={() => onOpenCaseStudy(sc.caseStudy ?? '')}>
            <BookOpen size={12} /> Open case study
          </button>
        </div>
      )}

      {sc && (
        <>
          <p className="studio-p">{sc.intro}</p>
          <div className="studio-k">People</div>
          <p className="studio-p">
            {sc.child.name} (protected child) · {sc.participants.map((p) => `${p.name} (${p.role})`).join(' · ')}
          </p>
          <div className="studio-k">2 · Where the live conversation begins</div>
          <div className="scn-list">
            {sc.checkpoints.map((c) => (
              <button key={c.id} className={`scn-item ${c.id === cpId ? 'on' : ''}`} onClick={() => setCpId(c.id)}>
                <span className="scn-num">{c.after}</span>
                <span className="scn-text">
                  <span className="scn-title">{c.label}</span>
                  <span className="scn-sub">{c.intro}</span>
                </span>
              </button>
            ))}
          </div>
          {cp && startMsg && (
            <p className="studio-note">
              Loads the first {cp.after} of {sc.messages.length} messages (to {names[startMsg.senderId]}’s message on Day {startMsg.day}, {startMsg.time}). Nothing after it is loaded or sent to a model.
            </p>
          )}
          <button className="btn-amber" disabled={!cp || d.serverOnline === false} onClick={() => cp && loadHistory(sc.id, { checkpoint: cp.id })}>
            <History size={14} /> {loadedHere ? 'Loaded · load again (no duplicates)' : 'Load history and continue'}
          </button>
          {d.origin && !loadedHere && <p className="studio-note">Replaces the current {ORIGIN_META[d.origin].label.toLowerCase()} case.</p>}
        </>
      )}
    </div>
  );
}

/** Honest state of the history preload: loaded vs analysed, progress, failure, cancel/resume. */
function HistoryStatus() {
  const d = useDemo((s) => s.data);
  const h = d.historyInit;
  if (d.origin !== 'history' && h.status !== 'loading' && h.status !== 'failed') return null;
  const histGuardian = d.alerts.filter((a) => a.historical && a.level >= 2).length;
  const histNudges = d.alerts.filter((a) => a.historical && a.level === 1).length;
  const live = d.messages.filter((m) => m.kind === 'msg').length - (d.checkpoint ?? 0);
  const b = h.baseline;
  return (
    <div className={`studio-box hs-${h.status}`}>
      <div className="studio-k">History</div>
      {h.status === 'loading' && (
        <p className="studio-p">
          <Loader2 size={13} className="spin" /> Saving the earlier messages…
        </p>
      )}
      {h.status === 'analyzing' && (
        <>
          <p className="studio-p">
            <Loader2 size={13} className="spin" /> Messages loaded. Analysing earlier history with the local models: batch {Math.min(h.done + 1, h.total)} of {h.total}. Typing is paused until this finishes.
          </p>
          <div className="hs-bar">
            <span style={{ width: `${(h.done / Math.max(1, h.total)) * 100}%` }} />
          </div>
          <button className="chip-btn" onClick={() => cancelHistoryInit()}>
            <SquareX size={12} /> Stop after this batch
          </button>
        </>
      )}
      {h.status === 'complete' && (
        <p className="studio-p">
          History analysed ({h.total} batch{h.total === 1 ? '' : 'es'}).
          {b ? (
            <>
              {' '}
              Baseline before any live message: <b style={{ color: LEVEL_META[b.level].color }}>{LEVEL_META[b.level].short} · {LEVEL_META[b.level].label}</b>, score {b.score.toFixed(1)}, {b.findings} finding{b.findings === 1 ? '' : 's'}.
            </>
          ) : null}
          {histGuardian ? ` ${histGuardian} earlier guardian alert${histGuardian === 1 ? '' : 's'} recorded without pop-ups (listed on the guardian phone).` : ''}
          {histNudges ? ` ${histNudges} earlier Level 1 finding${histNudges === 1 ? '' : 's'} (child-nudge level, never shown to the guardian).` : ''}{' '}
          {live > 0 ? (
            <>
              {live} live message{live === 1 ? '' : 's'} since · now <b style={{ color: LEVEL_META[d.level].color }}>{LEVEL_META[d.level].short}</b>, score {d.score.toFixed(1)}.
            </>
          ) : (
            'Now type the next messages.'
          )}
        </p>
      )}
      {h.status === 'messages_only' && (
        <p className="studio-p">
          History loaded, <b>not analysed</b>. ChatGPT · Cloud runs only when you press “Analyze with ChatGPT”. Nothing was sent anywhere and there is no automatic fallback to another backend.
        </p>
      )}
      {h.status === 'failed' && (
        <>
          <p className="studio-p">
            <CircleAlert size={13} /> {h.error ?? 'History setup failed.'} {h.total ? `${h.done} of ${h.total} batches analysed.` : ''}
          </p>
          {d.origin === 'history' && (
            <button className="chip-btn" onClick={() => initHistory()}>
              <RotateCw size={12} /> Retry analysis
            </button>
          )}
        </>
      )}
      {(h.status === 'cancelled' || (h.status === 'idle' && h.total > 0)) && (
        <>
          <p className="studio-p">
            History {h.status === 'cancelled' ? 'analysis stopped' : 'only partly analysed'}: {h.done} of {h.total} batches. Unanalysed messages carry no findings yet.
          </p>
          <button className="chip-btn" onClick={() => initHistory()}>
            <RotateCw size={12} /> Resume analysis
          </button>
        </>
      )}
    </div>
  );
}

// ---------- C · Free Chat ----------

function FreeChatPanel() {
  const d = useDemo((s) => s.data);
  const fresh = d.origin === 'fresh';
  return (
    <div className="studio-body">
      {fresh ? (
        <div className="studio-box">
          <div className="studio-k">Fresh conversation</div>
          <p className="studio-p">No messages were preloaded. Context builds only from what you type here.</p>
          <ul className="studio-ideas">
            <li>Type on either phone. The left phone’s sender picker chooses who is typing in a group.</li>
            <li>The back arrow on {childNameOf(d)}’s phone opens the chat list; ✎ creates private or group chats with new people.</li>
            <li>Settings → Sim clock +1 day tests memory and decay across days.</li>
          </ul>
        </div>
      ) : (
        <div className="studio-box">
          <div className="studio-k">Start a new conversation</div>
          <p className="studio-p">Free Chat starts a new case with no history and one default contact. Judges can type anything at all.</p>
          {d.origin && <p className="studio-note">This replaces the current {ORIGIN_META[d.origin].label.toLowerCase()} case. Switching tabs alone never does.</p>}
        </div>
      )}
      <button className="btn-amber" disabled={d.serverOnline === false} onClick={() => startFreshConversation()}>
        <MessageSquarePlus size={14} /> {fresh ? 'Start another new conversation' : 'Start new conversation'}
      </button>
    </div>
  );
}
