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
  RotateCcw,
  Settings2,
  ShieldCheck,
  SkipForward,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { GuardianPhone } from '../alerts/GuardianPhone';
import { NudgeCard } from '../alerts/NudgeCard';
import { ChatScreen } from '../chat/ChatScreen';
import { PhoneFrame } from '../chat/PhoneFrame';
import { CaseCard, DebugFeed, ScoreChart } from '../console/Analytics';
import { Segmented } from '../console/Segmented';
import { CHILD, CUE_ACTIVE_P, CUE_META, GUARDIAN, LEVEL_META, WEEKDAYS } from '../data/meta';
import { SCENARIO } from '../data/scenario';
import { usePhoneScale } from '../lib/hooks';
import { pause, play, previewAlert, resetDemo, SCRIPT_LENGTH, setMode, stepOnce, useDemo } from '../store';
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
  let content: React.ReactNode = d.mode === 'A' ? 'Press Play to start the six-day scenario' : 'Type on either phone to start chatting';
  let level: Level | null = null;

  const last = [...d.messages].reverse().find((m) => m.analysis);
  if (d.analyzingId) {
    key = `an-${d.analyzingId}`;
    content = <span className="shimmer">Classifying with {d.backend === 'gpt' ? 'GPT' : 'the in-house model'}…</span>;
  } else if (last?.analysis) {
    const a = last.analysis;
    level = a.level;
    key = `a-${last.id}`;
    const cues = a.cues.filter((c) => c.p >= CUE_ACTIVE_P).map((c) => CUE_META[c.cue].label);
    content = (
      <>
        <b>
          Day {last.day} · {WEEKDAYS[last.day]}
        </b>
        <span className="cap-sep">·</span>
        {cues.join(' + ')} detected
        <span className="cap-arrow">→</span>
        <span style={{ color: LEVEL_META[a.level].color }}>{OUTCOME[a.level]}</span>
      </>
    );
  } else if (d.messages.length) {
    key = `day-${d.simDay}`;
    content = (
      <>
        <b>
          Day {d.simDay} · {WEEKDAYS[d.simDay] ?? ''}
        </b>
        <span className="cap-sep">·</span>
        no warning cues yet
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
  const markers = SCENARIO.map((s, i) => ({ i, s })).filter(({ s }) => s.analysis);
  const dayStarts = SCENARIO.map((s, i) => ({ i, day: s.day })).filter(({ i, day }) => i === 0 || SCENARIO[i - 1].day !== day);
  const pct = (i: number) => (i / SCRIPT_LENGTH) * 100;

  return (
    <div className="progress">
      <div className="progress-track">
        <motion.div className="progress-fill" initial={false} animate={{ width: `${pct(cursor)}%` }} transition={{ type: 'spring', stiffness: 120, damping: 24 }} />
        {markers.map(({ i, s }) => (
          <span
            key={i}
            className={`progress-marker ${cursor > i ? 'hit' : ''}`}
            style={{ left: `${pct(i + 0.5)}%`, ['--c' as string]: LEVEL_META[s.analysis!.level].color }}
          />
        ))}
      </div>
      <div className="progress-days">
        {dayStarts.map(({ i, day }) => (
          <span key={day} style={{ left: `${pct(i)}%` }}>
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
      className="popover"
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
            { value: 'A', label: 'AI simulation' },
            { value: 'B', label: 'Live chat' },
          ]}
        />
      </div>
      <div className="pop-row">
        <span className="pop-k">Classifier</span>
        <Segmented
          id="pbackend"
          value={d.backend}
          onChange={(b) => dispatch({ type: 'setBackend', backend: b })}
          options={[
            { value: 'gpt', label: <><Cloud size={13} /> GPT</> },
            { value: 'inhouse', label: <><Cpu size={13} /> In-house</> },
          ]}
        />
      </div>
      {d.mode === 'A' && (
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
      )}
      <div className="pop-row">
        <span className="pop-k">Sim clock</span>
        <div className="pop-inline">
          <span className="pop-v">Day {d.simDay}</span>
          <button className="chip-btn" onClick={() => dispatch({ type: 'setDay', day: d.simDay + 1 })}>
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

      <div className="pop-divider" />

      <div className="pop-row">
        <span className="pop-k">Preview alert</span>
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
  const finished = d.cursor >= SCRIPT_LENGTH;
  const meta = LEVEL_META[d.level];

  const onPlay = () => {
    if (d.playing) pause();
    else if (finished) {
      resetDemo();
      setTimeout(play, 50);
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
          <button className="dock-icon" onClick={() => stepOnce()} disabled={d.playing || finished} title="Next message (→)">
            <SkipForward size={16} />
          </button>
          <Progress />
        </>
      ) : (
        <div className="dock-live">
          <span className="live-dot" /> Live chat · type on either phone
        </div>
      )}

      <div className="dock-sep" />

      <div className="dock-level" style={{ ['--c' as string]: meta.color }}>
        <span className="dock-level-dot" />
        <div>
          <div className="dock-level-k">{meta.short} · {meta.label}</div>
          <div className="dock-level-v">
            <Gauge size={11} /> score {d.score.toFixed(1)}
          </div>
        </div>
      </div>

      <div className="dock-sep" />

      <button className="dock-icon" onClick={() => resetDemo()} title="Reset (R)">
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

function EngineDrawer({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<'case' | 'trace'>('case');
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
          <div className="drawer-sub">What RAKSHAK sees on the child's device</div>
        </div>
        <button className="dock-icon" onClick={onClose} aria-label="Close engine panel">
          <PanelRightClose size={16} />
        </button>
      </div>
      <Segmented
        id="drawer-tab"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'case', label: 'Case overview' },
          { value: 'trace', label: 'Message trace' },
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
            {tab === 'case' ? (
              <>
                <CaseCard />
                <ScoreChart />
              </>
            ) : (
              <DebugFeed />
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </motion.aside>
  );
}

export function SimulationPage() {
  const [params] = useSearchParams();
  const mode = useDemo((s) => s.data.mode);
  const [engineOpen, setEngineOpen] = useState(false);
  const spot = useSpotlight();

  usePhoneScale(3, engineOpen ? 470 : 0, 205);

  useEffect(() => {
    const m = params.get('mode');
    if ((m === 'A' || m === 'B') && m !== useDemo.getState().data.mode) setMode(m);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      const d = useDemo.getState().data;
      if (e.code === 'Space' && d.mode === 'A') {
        e.preventDefault();
        if (d.playing) pause();
        else if (d.cursor >= SCRIPT_LENGTH) {
          resetDemo();
          setTimeout(play, 50);
        } else play();
      } else if (e.key === 'ArrowRight') stepOnce();
      else if (e.key.toLowerCase() === 'e') setEngineOpen((v) => !v);
      else if (e.key.toLowerCase() === 'r') resetDemo();
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
          {mode === 'A' ? 'Six days, one stranger' : 'Live chat'}
          <span className="sim-title-sub">{mode === 'A' ? 'AI simulation' : 'Mode B'}</span>
        </div>
        <span className="sim-note">UI preview · dummy data</span>
      </header>

      <Caption />

      <main className="sim-main">
        <motion.div layout className="sim-stage" transition={{ type: 'spring', stiffness: 220, damping: 30 }}>
          <div className={`sim-phone ${cls('predator')}`}>
            <PhoneFrame theme="dark">
              <ChatScreen side="predator" />
            </PhoneFrame>
            <div className="sim-label">
              <span className="label-dot dot-red" /> Contact <span>simulated</span>
            </div>
          </div>
          <div className={`sim-phone ${cls('victim')}`}>
            <PhoneFrame theme="light">
              <ChatScreen side="victim" overlay={<NudgeCard />} />
            </PhoneFrame>
            <div className="sim-label">
              <span className="label-dot dot-teal" /> {CHILD.name}'s phone <span>RAKSHAK on-device</span>
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
