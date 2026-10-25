import { AnimatePresence, motion } from 'framer-motion';
import {
  ChevronLeft,
  Cloud,
  Cpu,
  ExternalLink,
  FastForward,
  Gauge,
  History,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Settings2,
  ShieldCheck,
  SkipForward,
  Sparkles,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { GetHelp } from '../alerts/GetHelp';
import { GuardianPhone } from '../alerts/GuardianPhone';
import { NudgeCard } from '../alerts/NudgeCard';
import { ChatScreen } from '../chat/ChatScreen';
import { PhoneFrame } from '../chat/PhoneFrame';
import { CaseCard, DebugFeed, EVIDENCE_EVENT, EvidencePanel, ModelsPanel, ScoreChart } from '../console/Analytics';
import { CaseStudyStrip, CaseStudyView } from '../console/CaseStudyView';
import { ChatGPTPanel } from '../console/ChatGPTPanel';
import { Segmented } from '../console/Segmented';
import { ServerSettings } from '../console/ServerSettings';
import { Studio } from '../console/Studio';
import { BACKEND_META, CUE_ACTIVE_P, CUE_META, GUARDIAN, LEVEL_META, WEEKDAYS } from '../data/meta';
import { ConnectButton, DevicesPanel } from './Engine';
import { SCENARIO as PREVIEW_SCRIPT } from '../data/scenario';
import { canCompose, MODE_META, ORIGIN_META } from '../lib/flow';
import { usePhoneScale } from '../lib/hooks';
import {
  analyzeAllChats,
  analyzeWithChatGPT,
  bootstrap,
  childNameOf,
  continueLiveFromHere,
  pause,
  play,
  PREVIEW_ID,
  previewAlert,
  refreshHealth,
  resetDemo,
  scriptLength,
  setBackend,
  setMode,
  stepOnce,
  useDemo,
} from '../store';
import type { Level, Mode } from '../types';

type Spot = 'predator' | 'victim' | 'guardian';

/** Briefly lights up the phone(s) an alert lands on, and dims the rest. */
function useSpotlight() {
  const nudge = useDemo((s) => s.data.victimNudge?.id);
  const banner = useDemo((s) => s.data.guardianBanner?.id);
  const critical = useDemo((s) => s.data.critical?.id);
  const [spot, setSpot] = useState<Spot[]>([]);
  const timer = useRef<number>();

  const flash = (keys: Spot[], ms: number) => {
    setSpot(keys);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setSpot([]), ms);
  };

  useEffect(() => {
    if (nudge) flash(['victim'], 3200);
  }, [nudge]);
  useEffect(() => {
    if (banner) flash(['victim', 'guardian'], 4500);
  }, [banner]);
  useEffect(() => {
    if (critical) flash(['victim', 'guardian'], 6000);
  }, [critical]);

  return spot;
}

const outcome = (level: Level, child: string) =>
  ({ 0: 'logged quietly', 1: `private nudge to ${child}`, 2: `${GUARDIAN.name} alerted`, 3: 'critical alert + Get help' })[level];

/** Default caption when nothing more specific is happening, per mode and case origin. */
function idleCaption(d: ReturnType<typeof useDemo.getState>['data']): string {
  if (d.mode === 'A') return d.origin === 'scripted' || d.origin === 'preview' ? 'Press Play to run the example through the real pipeline' : 'Pick an example or case study in the Studio panel';
  if (d.mode === 'B') {
    if (d.origin === 'scripted') return 'This is the Guided Demo case. Continue it live, or load an earlier conversation';
    if (d.origin !== 'history') return 'Choose an earlier conversation in the Studio panel and load it';
    return 'Type the next message on either phone';
  }
  if (d.origin !== 'fresh') return 'Press “Start new conversation” to begin a fresh case';
  return 'Type on either phone. Open the chat list to switch or create chats';
}

/** One-line narration of what the engine just did. */
function Caption() {
  const d = useDemo((s) => s.data);
  let key = 'idle';
  let content: React.ReactNode = idleCaption(d);
  let level: Level | null = null;
  const h = d.historyInit;

  const last = [...d.messages].reverse().find((m) => m.analysis && (!d.activeConv || m.conversationId === d.activeConv || !m.conversationId));
  if (d.runError) {
    key = `err-${d.runError.code}`;
    content = <span style={{ color: LEVEL_META[2].color }}>{d.runError.message}</span>;
  } else if (h.status === 'loading') {
    key = 'h-loading';
    content = <span className="shimmer">Saving the earlier conversation…</span>;
  } else if (h.status === 'analyzing') {
    key = `h-an-${h.done}`;
    content = (
      <span className="shimmer">
        Analysing earlier history locally · batch {Math.min(h.done + 1, h.total)} of {h.total} · alerts from history are recorded, not popped up
      </span>
    );
  } else if (d.analyzingId) {
    key = `an-${d.analyzingId}`;
    content = <span className="shimmer">{d.backend === 'gpt' ? 'Analysing with ChatGPT (cloud)…' : 'Analysing the conversation locally (RoBERTa + Qwen3.5)…'}</span>;
  } else if (d.mode === 'B' && d.origin === 'history' && h.status === 'messages_only') {
    key = 'h-msgs';
    content = 'History loaded, not analysed · press “Analyze with ChatGPT” to run cloud analysis';
  } else if (d.mode !== 'A' && d.origin === 'history' && h.status === 'complete' && d.messages.filter((m) => m.kind === 'msg').length <= (d.checkpoint ?? 0)) {
    key = `h-done-${d.level}`;
    level = d.level;
    content = (
      <>
        <b>History analysed</b>
        <span className="cap-sep">·</span>
        baseline <span style={{ color: LEVEL_META[d.level].color }}>{LEVEL_META[d.level].short} · {LEVEL_META[d.level].label}</span>
        <span className="cap-arrow">→</span> now type the next message
      </>
    );
  } else if (last?.analysis) {
    const a = last.analysis;
    level = a.level;
    key = `a-${last.id}-${a.level}`;
    // Only confirmed cues are reported as detected; pending ones are shown as waiting, never as harm.
    const cues = a.cues.filter((c) => c.p >= CUE_ACTIVE_P && (c.status === undefined || c.status === 'active')).map((c) => CUE_META[c.cue].label);
    const waiting = a.cues.filter((c) => c.p >= CUE_ACTIVE_P && c.status === 'needs_review').map((c) => CUE_META[c.cue].label);
    content = (
      <>
        <b>
          Day {last.day} · {WEEKDAYS[last.day]}
        </b>
        <span className="cap-sep">·</span>
        {cues.length
          ? `${[...new Set(cues)].join(' + ')} detected`
          : waiting.length
            ? `possible ${[...new Set(waiting)].join(' + ')} · waiting for confirmation`
            : a.run?.assessment === 'uncertain'
              ? 'model uncertain · waiting for more context'
              : 'no harmful cues on this message'}
        <span className="cap-arrow">→</span>
        <span style={{ color: LEVEL_META[a.level].color }}>{outcome(a.level, childNameOf(d))}</span>
        {a.preview && <span className="cap-sep">· preview, not live AI</span>}
      </>
    );
  } else if (d.caption && d.mode === 'A') {
    key = `cap-${d.caption}`;
    content = d.caption;
  } else if (d.messages.length) {
    key = `day-${d.simDay}`;
    content = (
      <>
        <b>
          Day {d.simDay} · {WEEKDAYS[d.simDay] ?? ''}
        </b>
        <span className="cap-sep">·</span>
        {d.backend === 'gpt' ? 'press “Analyze with ChatGPT” to run cloud analysis' : 'no warning cues yet'}
      </>
    );
  }

  return (
    <div className="caption-wrap">
      <AnimatePresence mode="wait">
        <motion.div
          key={key}
          className="caption"
          style={level !== null ? { ['--c' as string]: LEVEL_META[level].color } : undefined}
          initial={{ opacity: 0, y: -8, filter: 'blur(4px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          exit={{ opacity: 0, y: 6, filter: 'blur(4px)' }}
          transition={{ duration: 0.35 }}
        >
          {level !== null && <span className="cap-dot" />}
          {content}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function Progress() {
  const cursor = useDemo((s) => s.data.cursor);
  const scenarioId = useDemo((s) => s.data.scenarioId);
  const scenarios = useDemo((s) => s.data.scenarios);
  const messages = useDemo((s) => s.data.messages);
  const preview = scenarioId === PREVIEW_ID;
  const steps = preview ? PREVIEW_SCRIPT.map((p, i) => ({ id: `preview-m${i}`, day: p.day })) : scenarios.find((s) => s.id === scenarioId)?.messages ?? [];
  const total = Math.max(1, steps.length);
  // Markers show where the live engine actually alerted, not where a script says it should.
  const levelOf = new Map(messages.filter((m) => m.analysis && m.analysis.level >= 1).map((m) => [m.id, m.analysis!.level]));
  const markers = steps.map((s, i) => ({ i, level: levelOf.get(s.id) })).filter((x) => x.level);
  const dayStarts = steps.map((s, i) => ({ i, day: s.day })).filter(({ i, day }) => i === 0 || steps[i - 1].day !== day);
  const pct = (i: number) => (i / total) * 100;

  return (
    <div className="progress">
      <div className="progress-track">
        <motion.div className="progress-fill" initial={false} animate={{ width: `${pct(cursor)}%` }} transition={{ type: 'spring', stiffness: 120, damping: 24 }} />
        {markers.map(({ i, level }) => (
          <span key={i} className="progress-marker hit" style={{ left: `${pct(i + 0.5)}%`, ['--c' as string]: LEVEL_META[level as Level].color }} />
        ))}
      </div>
      <div className="progress-days">
        {dayStarts.map(({ i, day }) => (
          <span key={`${day}-${i}`} style={{ left: `${pct(i)}%` }}>
            D{day}
          </span>
        ))}
      </div>
    </div>
  );
}

function SettingsPopover({ onClose }: { onClose: () => void }) {
  const d = useDemo((s) => s.data);
  const dispatch = useDemo((s) => s.dispatch);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node) && !(e.target as HTMLElement).closest('.dock-settings-btn')) onClose();
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [onClose]);

  const open = (route: string) => window.open(`${location.pathname}#/${route}`, `rakshak-${route}`, 'width=440,height=900');

  return (
    <motion.div
      ref={ref}
      className="popover popover-wide"
      initial={{ opacity: 0, y: 12, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      // Clicks stop the moment it starts closing: a stalled exit (hidden tab) must not leave an invisible layer over the phones.
      exit={{ opacity: 0, y: 8, scale: 0.98, pointerEvents: 'none', transition: { duration: 0.15 } }}
      transition={{ type: 'spring', stiffness: 420, damping: 32 }}
    >
      <div className="pop-row">
        <span className="pop-k">Analysis backend</span>
        <Segmented
          id="pbackend"
          value={d.backend}
          onChange={(b) => setBackend(b)}
          options={[
            { value: 'inhouse', label: <><Cpu size={13} /> {BACKEND_META.inhouse.short}</> },
            { value: 'gpt', label: <><Cloud size={13} /> {BACKEND_META.gpt.short}</> },
          ]}
        />
      </div>
      <div className="pop-note">
        {d.backend === 'inhouse'
          ? 'RoBERTa (per message) + Qwen3.5 4B via Ollama (whole conversation) + RAKSHAK fusion, memory and scoring. Runs on the host laptop (127.0.0.1), not on the simulated phones.'
          : 'Your connected ChatGPT account analyses the conversation in the cloud. Runs only when you press “Analyze with ChatGPT”.'}
      </div>
      {d.backend === 'gpt' && <ChatGPTPanel />}
      <div className="pop-k">Server</div>
      <ServerSettings />
      <div className="pop-row">
        <span className="pop-k">Phones</span>
        <ConnectButton />
      </div>

      {d.mode === 'A' && (
        <>
          <div className="pop-divider" />
          <div className="pop-row">
            <span className="pop-k">Speed</span>
            <Segmented
              id="pspeed"
              value={d.speed}
              onChange={(s) => dispatch({ type: 'setSpeed', speed: s })}
              options={[
                { value: 1, label: '1×' },
                { value: 2, label: '2×' },
                { value: 4, label: '4×' },
              ]}
            />
          </div>
        </>
      )}
      <div className="pop-divider" />
      <div className="pop-row">
        <span className="pop-k">Sim clock</span>
        <div className="pop-inline">
          <span className="pop-v">Day {d.simDay}</span>
          <button className="chip-btn" onClick={() => dispatch({ type: 'setDay', day: d.simDay + 1 })} disabled={d.mode === 'A' && d.playing}>
            <FastForward size={12} /> +1 day
          </button>
        </div>
      </div>
      <div className="pop-row">
        <span className="pop-k">Sound</span>
        <button className="chip-btn" onClick={() => dispatch({ type: 'setSound', sound: !d.sound })}>
          {d.sound ? <Volume2 size={13} /> : <VolumeX size={13} />} {d.sound ? 'On' : 'Off'}
        </button>
      </div>
      <div className="pop-row">
        <span className="pop-k">Preview alert (design)</span>
        <div className="pop-inline">
          {([1, 2, 3] as const).map((l) => (
            <button key={l} className={`lvl-btn lvl-${l}`} onClick={() => previewAlert(l)}>
              L{l}
            </button>
          ))}
        </div>
      </div>
      <div className="pop-row">
        <span className="pop-k">Separate windows</span>
        <div className="pop-inline">
          {['predator', 'victim', 'console'].map((r) => (
            <button key={r} className="chip-btn" onClick={() => open(r)}>
              {r} <ExternalLink size={11} />
            </button>
          ))}
        </div>
      </div>

      <div className="pop-hint">
        <kbd>Space</kbd> play/pause · <kbd>→</kbd> step · <kbd>S</kbd> studio · <kbd>E</kbd> engine · <kbd>R</kbd> reset
      </div>
    </motion.div>
  );
}

function Dock({ engineOpen, onToggleEngine, onOpenStudio }: { engineOpen: boolean; onToggleEngine: () => void; onOpenStudio: () => void }) {
  const d = useDemo((s) => s.data);
  const playable = d.origin === 'scripted' || d.origin === 'preview';
  const live = canCompose(d.mode, d.origin, d.historyInit);
  const [settings, setSettings] = useState(false);
  const length = scriptLength();
  const finished = length > 0 && d.cursor >= length;
  const meta = LEVEL_META[d.level];
  const cg = d.chatgpt.status;
  const cgReady = !!cg && cg.status === 'connected' && cg.sharing && cg.consent && !!d.chatgpt.model;

  const onPlay = () => {
    if (!d.scenarioId || !playable) return onOpenStudio();
    if (d.playing) pause();
    else if (finished) {
      void resetDemo().then(() => setTimeout(play, 50));
    } else play();
  };

  return (
    <motion.div className="dock" initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ type: 'spring', stiffness: 260, damping: 28, delay: 0.3 }}>
      <AnimatePresence>{settings && <SettingsPopover onClose={() => setSettings(false)} />}</AnimatePresence>

      {d.mode === 'A' && playable ? (
        <>
          <button className="dock-play" onClick={onPlay} aria-label={d.playing ? 'Pause' : 'Play'}>
            <AnimatePresence mode="wait" initial={false}>
              <motion.span key={d.playing ? 'pause' : 'play'} initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.5, opacity: 0 }} transition={{ duration: 0.15 }}>
                {d.playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" style={{ marginLeft: 2 }} />}
              </motion.span>
            </AnimatePresence>
          </button>
          <button className="dock-icon" onClick={() => stepOnce()} disabled={d.playing || finished || !d.scenarioId} title="Next message (→)">
            <SkipForward size={16} />
          </button>
          <Progress />
          {d.origin === 'scripted' && d.cursor > 0 && !d.playing && !finished && (
            <button className="dock-engine" onClick={() => continueLiveFromHere()} title="Keep the case played so far and continue it live (Mode B)">
              <History size={14} /> Continue live
            </button>
          )}
        </>
      ) : (
        <button className="dock-live" onClick={live ? undefined : onOpenStudio}>
          {live ? (
            <>
              <span className="live-dot" /> {MODE_META[d.mode].name} · type on either phone
            </>
          ) : d.historyInit.status === 'analyzing' || d.historyInit.status === 'loading' ? (
            'Setting up history… typing resumes when it is ready'
          ) : (
            <>
              <PanelLeftOpen size={14} /> {d.mode === 'A' ? 'Pick an example in the Studio panel' : d.mode === 'B' ? 'Load an earlier conversation in the Studio panel' : 'Start a new conversation in the Studio panel'}
            </>
          )}
        </button>
      )}

      {d.backend === 'gpt' && d.scenarioId !== PREVIEW_ID && (
        <>
          <div className="dock-sep" />
          <button
            className="dock-engine dock-cloud"
            onClick={() => (cgReady ? analyzeWithChatGPT() : setSettings(true))}
            disabled={!!d.analyzingId || !d.activeConv}
            title={cgReady ? 'Send the open conversation to your ChatGPT account for analysis' : 'Connect ChatGPT and accept the cloud disclosure first'}
          >
            <Sparkles size={14} /> {d.analyzingId ? 'Analysing…' : 'Analyze with ChatGPT'}
          </button>
        </>
      )}

      <div className="dock-sep" />

      <div className="dock-level" style={{ ['--c' as string]: meta.color }}>
        <span className="dock-level-dot" />
        <div>
          <div className="dock-level-k">
            {meta.short} · {meta.label}
          </div>
          <div className="dock-level-v">
            <Gauge size={11} /> score {d.score.toFixed(1)}
            {d.risk && d.risk.category !== 'none' ? ` · ${d.risk.category}` : ''}
          </div>
        </div>
      </div>

      <div className="dock-sep" />

      <button className="dock-icon" onClick={() => resetDemo()} disabled={!d.origin} title="Reset (R): restart this case from its own starting point and clear its memory">
        <RotateCcw size={16} />
      </button>
      <button className={`dock-icon dock-settings-btn ${settings ? 'on' : ''}`} onClick={() => setSettings((v) => !v)} title="Settings">
        <Settings2 size={16} />
      </button>
      <button className={`dock-engine ${engineOpen ? 'on' : ''}`} onClick={onToggleEngine} title="Engine panel (E)">
        {engineOpen ? <PanelRightClose size={15} /> : <PanelRightOpen size={15} />} Engine
      </button>
    </motion.div>
  );
}

type DrawerTab = 'case' | 'evidence' | 'trace' | 'models';

function EngineDrawer({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<DrawerTab>('case');
  useEffect(() => {
    // A cue clicked in the trace opens the referenced evidence row.
    const on = () => setTab('evidence');
    window.addEventListener(EVIDENCE_EVENT, on);
    return () => window.removeEventListener(EVIDENCE_EVENT, on);
  }, []);
  const backend = useDemo((s) => s.data.backend);
  const busy = useDemo((s) => !!s.data.analyzingId);
  const hasChats = useDemo((s) => s.data.conversations.length > 0 && s.data.scenarioId !== PREVIEW_ID);
  return (
    <motion.aside
      className="drawer"
      initial={{ opacity: 0, x: 60 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 60, pointerEvents: 'none', transition: { duration: 0.2 } }}
      transition={{ type: 'spring', stiffness: 260, damping: 30 }}
    >
      <div className="drawer-head">
        <div>
          <div className="drawer-title">Engine</div>
          <div className="drawer-sub">
            {backend === 'inhouse' ? 'RAKSHAK Hybrid · local models' : 'ChatGPT · cloud analysis'} → deterministic RAKSHAK engine
          </div>
        </div>
        <div className="pop-inline">
          {backend === 'inhouse' && hasChats && (
            <button className="dock-icon" onClick={() => analyzeAllChats()} disabled={busy} title="Re-analyse every chat with the local models (idempotent: unchanged evidence never inflates the score)">
              <RefreshCw size={15} />
            </button>
          )}
          <button className="dock-icon" onClick={onClose} aria-label="Close engine panel">
            <PanelRightClose size={16} />
          </button>
        </div>
      </div>
      <Segmented
        id="drawer-tab"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'case', label: 'Case' },
          { value: 'evidence', label: 'Evidence' },
          { value: 'trace', label: 'Trace' },
          { value: 'models', label: 'Models' },
        ]}
      />
      <div className="drawer-body">
        <AnimatePresence mode="wait">
          <motion.div
            key={tab}
            className="drawer-tab"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.2 }}
          >
            {tab === 'case' && (
              <>
                <CaseCard />
                <ScoreChart />
              </>
            )}
            {tab === 'evidence' && <EvidencePanel />}
            {tab === 'trace' && <DebugFeed />}
            {tab === 'models' && <ModelsPanel />}
          </motion.div>
        </AnimatePresence>
      </div>
    </motion.aside>
  );
}

function StatusPill() {
  const online = useDemo((s) => s.data.serverOnline);
  const health = useDemo((s) => s.data.health);
  const backend = useDemo((s) => s.data.backend);
  const preview = useDemo((s) => s.data.scenarioId === PREVIEW_ID);
  let text = 'connecting…';
  let tone = 'idle';
  if (preview) {
    text = 'Presentation preview · precomputed, not live AI';
    tone = 'warn';
  } else if (online === false) {
    text = 'Inference service offline';
    tone = 'bad';
  } else if (health) {
    if (backend === 'inhouse') {
      const ok = health.roberta.ready && health.qwen.reachable && health.qwen.modelPresent;
      text = ok ? `Local AI ready · RoBERTa (${health.roberta.device}) + ${health.qwen.model}` : !health.qwen.reachable ? 'Ollama not running · rules fallback (not AI)' : !health.qwen.modelPresent ? `${health.qwen.model} not pulled` : 'RoBERTa loading…';
      tone = ok ? 'ok' : 'warn';
    } else {
      const c = health.chatgpt;
      text = !c.reachable ? 'ChatGPT companion offline' : c.status === 'connected' && c.sharing ? 'ChatGPT connected · owner-initiated only' : 'ChatGPT not connected';
      tone = c.reachable && c.status === 'connected' && c.sharing ? 'ok' : 'warn';
    }
  }
  return (
    <button className={`sim-note status-${tone}`} onClick={() => refreshHealth()} title="Refresh model status">
      <span className="status-dot" /> {text}
    </button>
  );
}

function ModeSwitch() {
  const mode = useDemo((s) => s.data.mode);
  const origin = useDemo((s) => s.data.origin);
  const title = useDemo((s) => (s.data.origin === 'preview' ? 'Six days, one stranger' : s.data.origin === 'fresh' ? 'New conversation' : s.data.scenarios.find((x) => x.id === s.data.scenarioId)?.title));
  return (
    <div className="mode-wrap">
      <Segmented
        id="mode-switch"
        value={mode}
        onChange={(m: Mode) => setMode(m)}
        options={(['A', 'B', 'C'] as const).map((m) => ({
          value: m,
          label: (
            <>
              <span className="mode-letter">{m}</span> {MODE_META[m].name}
            </>
          ),
        }))}
      />
      <span className={`origin-chip tone-${origin ? ORIGIN_META[origin].tone : 'none'}`} title="The current case. Switching modes does not change it.">
        {origin ? `${ORIGIN_META[origin].label}${title ? ` · ${title}` : ''}` : 'No case loaded'}
      </span>
    </div>
  );
}

export function SimulationPage({ initialView = 'phones' }: { initialView?: 'phones' | 'engine' }) {
  // phones: the three drawn phones (no real phones needed) · engine: the projector view while real phones carry the story
  const [view, setView] = useState(initialView);
  const [params] = useSearchParams();
  const childName = useDemo((s) => childNameOf(s.data));
  const [engineOpen, setEngineOpen] = useState(false);
  const [studioOpen, setStudioOpen] = useState(true);
  const [caseStudy, setCaseStudy] = useState<string | null>(null);
  const spot = useSpotlight();

  usePhoneScale(3, (engineOpen ? 470 : 0) + (studioOpen ? 380 : 0), 240);
  useEffect(() => setView(initialView), [initialView]);

  useEffect(() => {
    const m = params.get('mode');
    const run = async () => {
      // A mode in the URL only selects the view; it never resets the case the server holds.
      if ((m === 'A' || m === 'B' || m === 'C') && m !== useDemo.getState().data.mode) setMode(m);
      await bootstrap();
    };
    void run();
    const t = window.setInterval(() => refreshHealth(), 15000);
    return () => window.clearInterval(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || useDemo.getState().data.helpFor) return;
      const d = useDemo.getState().data;
      if (e.code === 'Space' && d.mode === 'A') {
        e.preventDefault();
        if (!d.scenarioId || (d.origin !== 'scripted' && d.origin !== 'preview')) return;
        if (d.playing) pause();
        else if (d.cursor >= scriptLength()) {
          void resetDemo().then(() => setTimeout(play, 50));
        } else play();
      } else if (e.key === 'ArrowRight') stepOnce();
      else if (e.key.toLowerCase() === 'e') setEngineOpen((v) => !v);
      else if (e.key.toLowerCase() === 's') setStudioOpen((v) => !v);
      else if (e.key.toLowerCase() === 'r') void resetDemo();
      else if (e.key.toLowerCase() === 'v') setView((v) => (v === 'phones' ? 'engine' : 'phones'));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const cls = (k: Spot) => (spot.length === 0 ? '' : spot.includes(k) ? 'lit' : 'dimmed');

  return (
    <div className="sim">
      <div className="sim-bg" aria-hidden />

      <header className="sim-top">
        <Link to="/" className="sim-back">
          <ChevronLeft size={18} />
          <span className="brand-mark sm">
            <ShieldCheck size={14} strokeWidth={2.6} />
          </span>
          RAKSHAK
        </Link>
        <ModeSwitch />
        <div className="sim-top-right">
          <div className="view-toggle" role="tablist" aria-label="View">
            <button className={view === 'phones' ? 'on' : ''} onClick={() => setView('phones')}>
              Drawn phones
            </button>
            <button className={view === 'engine' ? 'on' : ''} onClick={() => setView('engine')}>
              Real phones · engine
            </button>
          </div>
          <ConnectButton />
          <StatusPill />
        </div>
      </header>

      <Caption />
      <CaseStudyStrip onOpenCaseStudy={setCaseStudy} />

      <main className="sim-main">
        <AnimatePresence>{studioOpen && <Studio onClose={() => setStudioOpen(false)} onOpenCaseStudy={setCaseStudy} />}</AnimatePresence>
        {!studioOpen && (
          <button className="studio-tab" onClick={() => setStudioOpen(true)} title="Open the Studio panel (S)">
            <PanelLeftOpen size={15} /> Studio
          </button>
        )}
        {view === 'engine' ? (
          <div className="engine-grid">
            <div className="engine-col">
              <CaseCard />
              <DevicesPanel />
            </div>
            <div className="engine-col">
              <ScoreChart />
              <DebugFeed />
            </div>
            <div className="engine-col">
              <EvidencePanel />
              <ModelsPanel />
            </div>
          </div>
        ) : (
        <motion.div layout className="sim-stage" transition={{ type: 'spring', stiffness: 220, damping: 30 }}>
          <div className={`sim-phone ${cls('predator')}`}>
            <PhoneFrame theme="dark">
              <ChatScreen side="predator" />
            </PhoneFrame>
            <div className="sim-label">
              <span className="label-dot dot-red" /> Other participants <span>simulated</span>
            </div>
          </div>
          <div className={`sim-phone ${cls('victim')}`}>
            <PhoneFrame theme="light">
              <ChatScreen side="victim" overlay={<NudgeCard />} />
            </PhoneFrame>
            <div className="sim-label">
              <span className="label-dot dot-teal" /> {childName}'s phone <span>protected child</span>
            </div>
          </div>
          <div className={`sim-phone ${cls('guardian')}`}>
            <GuardianPhone />
            <div className="sim-label">
              <span className="label-dot dot-amber" /> {GUARDIAN.name}'s phone <span>guardian</span>
            </div>
          </div>
        </motion.div>
        )}

        <AnimatePresence>{view === 'phones' && engineOpen && <EngineDrawer onClose={() => setEngineOpen(false)} />}</AnimatePresence>
      </main>

      <Dock engineOpen={engineOpen} onToggleEngine={() => setEngineOpen((v) => !v)} onOpenStudio={() => setStudioOpen(true)} />
      <GetHelp />
      <AnimatePresence>{caseStudy && <CaseStudyView caseKey={caseStudy} onClose={() => setCaseStudy(null)} />}</AnimatePresence>
    </div>
  );
}
