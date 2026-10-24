import { AnimatePresence, motion } from 'framer-motion';
import {
  ChevronLeft,
  Cloud,
  Cpu,
  ExternalLink,
  FastForward,
  Gauge,
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
import { GuardianPhone } from '../alerts/GuardianPhone';
import { NudgeCard } from '../alerts/NudgeCard';
import { ChatScreen } from '../chat/ChatScreen';
import { PhoneFrame } from '../chat/PhoneFrame';
import { CaseCard, DebugFeed, EvidencePanel, ModelsPanel, ScoreChart } from '../console/Analytics';
import { ChatGPTPanel } from '../console/ChatGPTPanel';
import { Segmented } from '../console/Segmented';
import { BACKEND_META, CHILD, CUE_ACTIVE_P, CUE_META, GUARDIAN, LEVEL_META, WEEKDAYS } from '../data/meta';
import { SCENARIO as PREVIEW_SCRIPT } from '../data/scenario';
import { usePhoneScale } from '../lib/hooks';
import {
  analyzeAllChats,
  analyzeWithChatGPT,
  bootstrap,
  pause,
  play,
  PREVIEW_ID,
  previewAlert,
  refreshHealth,
  resetDemo,
  scriptLength,
  selectScenario,
  setBackend,
  setMode,
  stepOnce,
  useDemo,
} from '../store';
import type { Level } from '../types';

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

const OUTCOME: Record<Level, string> = {
  0: 'logged quietly',
  1: `private nudge to ${CHILD.name}`,
  2: `${GUARDIAN.name} alerted`,
  3: 'critical alert + guided report',
};

/** One-line narration of what the engine just did. */
function Caption() {
  const d = useDemo((s) => s.data);
  let key = 'idle';
  let content: React.ReactNode =
    d.mode === 'A' ? (d.scenarioId ? 'Press Play to run the scenario through the real pipeline' : 'Pick a test case in Settings to begin') : 'Type on either phone. Open the chat list to switch or create chats';
  let level: Level | null = null;

  const last = [...d.messages].reverse().find((m) => m.analysis && (!d.activeConv || m.conversationId === d.activeConv || !m.conversationId));
  if (d.runError) {
    key = `err-${d.runError.code}`;
    content = <span style={{ color: LEVEL_META[2].color }}>{d.runError.message}</span>;
  } else if (d.analyzingId) {
    key = `an-${d.analyzingId}`;
    content = <span className="shimmer">{d.backend === 'gpt' ? 'Analysing with ChatGPT (cloud)…' : 'RoBERTa + Qwen3.5 analysing locally…'}</span>;
  } else if (last?.analysis) {
    const a = last.analysis;
    level = a.level;
    key = `a-${last.id}-${a.level}`;
    const cues = a.cues.filter((c) => c.p >= CUE_ACTIVE_P && (c.status === undefined || c.status === 'active' || c.status === 'needs_review')).map((c) => CUE_META[c.cue].label);
    content = (
      <>
        <b>
          Day {last.day} · {WEEKDAYS[last.day]}
        </b>
        <span className="cap-sep">·</span>
        {cues.length ? `${[...new Set(cues)].join(' + ')} detected` : a.run?.assessment === 'uncertain' ? 'model uncertain' : 'no harmful cues on this message'}
        <span className="cap-arrow">→</span>
        <span style={{ color: LEVEL_META[a.level].color }}>{OUTCOME[a.level]}</span>
        {a.preview && <span className="cap-sep">· preview, not live AI</span>}
      </>
    );
  } else if (d.caption) {
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

function ScenarioPicker() {
  const scenarios = useDemo((s) => s.data.scenarios);
  const scenarioId = useDemo((s) => s.data.scenarioId);
  const online = useDemo((s) => s.data.serverOnline);
  return (
    <div className="scn-list">
      {scenarios.map((s) => (
        <button key={s.id} className={`scn-item ${s.id === scenarioId ? 'on' : ''}`} onClick={() => selectScenario(s.id)}>
          <span className="scn-num">{s.number}</span>
          <span className="scn-text">
            <span className="scn-title">{s.title}</span>
            <span className="scn-sub">{s.tests}</span>
          </span>
        </button>
      ))}
      {online === false && scenarios.length === 0 && <div className="pop-note">Inference service offline. Start apps/server to run the live test cases.</div>}
      <button className={`scn-item scn-preview ${scenarioId === PREVIEW_ID ? 'on' : ''}`} onClick={() => selectScenario(PREVIEW_ID)}>
        <span className="scn-num">P</span>
        <span className="scn-text">
          <span className="scn-title">Presentation preview (offline)</span>
          <span className="scn-sub">Precomputed six-day script. Not live AI output.</span>
        </span>
      </button>
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
      exit={{ opacity: 0, y: 8, scale: 0.98, transition: { duration: 0.15 } }}
      transition={{ type: 'spring', stiffness: 420, damping: 32 }}
    >
      <div className="pop-row">
        <span className="pop-k">Mode</span>
        <Segmented
          id="pmode"
          value={d.mode}
          onChange={(m) => setMode(m)}
          options={[
            { value: 'A', label: 'Test cases' },
            { value: 'B', label: 'Live chat' },
          ]}
        />
      </div>
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
          ? 'RoBERTa (per message) + Qwen3.5 4B via Ollama (whole conversation) + RAKSHAK fusion, memory and scoring. Runs on this laptop.'
          : 'Your connected ChatGPT account analyses the conversation in the cloud. Runs only when you press “Analyze with ChatGPT”.'}
      </div>
      {d.backend === 'gpt' && <ChatGPTPanel />}

      {d.mode === 'A' && (
        <>
          <div className="pop-divider" />
          <div className="pop-k">Test case</div>
          <ScenarioPicker />
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
        <kbd>Space</kbd> play/pause · <kbd>→</kbd> step · <kbd>E</kbd> engine · <kbd>R</kbd> reset
      </div>
    </motion.div>
  );
}

function Dock({ engineOpen, onToggleEngine }: { engineOpen: boolean; onToggleEngine: () => void }) {
  const d = useDemo((s) => s.data);
  const [settings, setSettings] = useState(false);
  const length = scriptLength();
  const finished = length > 0 && d.cursor >= length;
  const meta = LEVEL_META[d.level];
  const cg = d.chatgpt.status;
  const cgReady = !!cg && cg.status === 'connected' && cg.sharing && cg.consent && !!d.chatgpt.model;

  const onPlay = () => {
    if (!d.scenarioId) return setSettings(true);
    if (d.playing) pause();
    else if (finished) {
      void resetDemo().then(() => setTimeout(play, 50));
    } else play();
  };

  return (
    <motion.div className="dock" initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ type: 'spring', stiffness: 260, damping: 28, delay: 0.3 }}>
      <AnimatePresence>{settings && <SettingsPopover onClose={() => setSettings(false)} />}</AnimatePresence>

      {d.mode === 'A' ? (
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
        </>
      ) : (
        <div className="dock-live">
          <span className="live-dot" /> Live chat · type on either phone
        </div>
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

      <button className="dock-icon" onClick={() => resetDemo()} title="Reset (R): clears this case and its memory">
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
  const backend = useDemo((s) => s.data.backend);
  const busy = useDemo((s) => !!s.data.analyzingId);
  const hasChats = useDemo((s) => s.data.conversations.length > 0 && s.data.scenarioId !== PREVIEW_ID);
  return (
    <motion.aside
      className="drawer"
      initial={{ opacity: 0, x: 60 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 60, transition: { duration: 0.2 } }}
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
      text = ok ? `Local AI ready · RoBERTa (${health.roberta.device}) + ${health.qwen.model}` : !health.qwen.reachable ? 'Ollama not running · RoBERTa-only fallback' : !health.qwen.modelPresent ? `${health.qwen.model} not pulled` : 'RoBERTa loading…';
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

export function SimulationPage() {
  const [params] = useSearchParams();
  const mode = useDemo((s) => s.data.mode);
  const scenarioTitle = useDemo((s) => (s.data.scenarioId === PREVIEW_ID ? 'Six days, one stranger' : s.data.scenarios.find((x) => x.id === s.data.scenarioId)?.title));
  const [engineOpen, setEngineOpen] = useState(false);
  const spot = useSpotlight();

  usePhoneScale(3, engineOpen ? 470 : 0, 205);

  useEffect(() => {
    const m = params.get('mode');
    const run = async () => {
      if ((m === 'A' || m === 'B') && m !== useDemo.getState().data.mode) await setMode(m);
      await bootstrap();
    };
    void run();
    const t = window.setInterval(() => refreshHealth(), 15000);
    return () => window.clearInterval(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      const d = useDemo.getState().data;
      if (e.code === 'Space' && d.mode === 'A') {
        e.preventDefault();
        if (!d.scenarioId) return;
        if (d.playing) pause();
        else if (d.cursor >= scriptLength()) {
          void resetDemo().then(() => setTimeout(play, 50));
        } else play();
      } else if (e.key === 'ArrowRight') stepOnce();
      else if (e.key.toLowerCase() === 'e') setEngineOpen((v) => !v);
      else if (e.key.toLowerCase() === 'r') void resetDemo();
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
        <div className="sim-title">
          {mode === 'A' ? scenarioTitle ?? 'Choose a test case' : 'Live chat'}
          <span className="sim-title-sub">{mode === 'A' ? 'Test cases · real pipeline' : 'Mode B · unscripted'}</span>
        </div>
        <StatusPill />
      </header>

      <Caption />

      <main className="sim-main">
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
              <span className="label-dot dot-teal" /> {CHILD.name}'s phone <span>protected child</span>
            </div>
          </div>
          <div className={`sim-phone ${cls('guardian')}`}>
            <GuardianPhone />
            <div className="sim-label">
              <span className="label-dot dot-amber" /> {GUARDIAN.name}'s phone <span>guardian</span>
            </div>
          </div>
        </motion.div>

        <AnimatePresence>{engineOpen && <EngineDrawer onClose={() => setEngineOpen(false)} />}</AnimatePresence>
      </main>

      <Dock engineOpen={engineOpen} onToggleEngine={() => setEngineOpen((v) => !v)} />
    </div>
  );
}
