import { Share } from '@capacitor/share';
import { AnimatePresence, motion } from 'framer-motion';
import { Bell, BellRing, ChevronRight, Clock, FileText, Home, Lock, MessageCircleHeart, QrCode, Settings, Share2, ShieldCheck, Smartphone, Trash2, UserPlus, Users, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { GetHelp } from '../alerts/GetHelp';
import { AlertSheet, CriticalTakeover, NoticeBanner } from '../alerts/GuardianAlerts';
import { CueChip, NeonBadge, ScoreRing, StageStepper } from '../alerts/primitives';
import { CUE_META, GUARDIAN, LEVEL_META, WEEKDAYS } from '../data/meta';
import { api, getServer } from '../lib/api';
import { setDevice, useDevice } from '../lib/device';
import { useClock } from '../lib/hooks';
import { buzz, guardianService, isNative, notify, onBack, onNotificationTap, setBarStyle } from '../lib/native';
import { playChime, playCritical, playRing } from '../lib/sounds';
import { useSync, type GuardianView } from '../lib/sync';
import { encodePairing } from '../qr/pairing';
import { QrCode as QrImage } from '../qr/QrCode';
import { childNameOf, resetForRole, respond, useDemo, type HelpTab } from '../store';
import type { AlertItem, Level } from '../types';

type Tab = 'home' | 'alerts' | 'report' | 'settings';

/** The protected child's name in the current case. */
const useChild = () => useDemo((s) => childNameOf(s.data));
const fmtTime = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

/**
 * RAKSHAK Guardian: the parent's phone (or a temporary guardian's). It never receives Meera's messages, only what
 * the alerts say (cue types, days, score) and what was done about them. Alerts also arrive as Android notifications.
 */
export function GuardianApp({ temporary, offline }: { temporary: boolean; offline: boolean }) {
  const child = useChild();
  const navigate = useNavigate();
  const alerts = useDemo((s) => s.data.alerts);
  const critical = useDemo((s) => s.data.critical);
  const notice = useDemo((s) => s.data.guardianNotice);
  const sound = useDemo((s) => s.data.sound);
  const sync = useSync();
  const [tab, setTab] = useState<Tab>('home');
  const [locked, setLocked] = useState(true);
  const [dim, setDim] = useState(false);
  const [detail, setDetail] = useState<AlertItem | null>(null);
  const [closedCritical, setClosedCritical] = useState<string | null>(null);
  const guardianAlerts = useMemo(() => alerts.filter((a) => a.level >= 2), [alerts]);
  const activeAlerts = useMemo(() => guardianAlerts.filter((a) => !a.withdrawn), [guardianAlerts]);
  const helpFor = useDemo((s) => s.data.helpFor);
  const dispatch = useDemo((s) => s.dispatch);
  /** Opens Get help over this phone's own screens (it stays on this phone; nothing is sent to the others). */
  const openHelp = (alert: AlertItem) => (tab: HelpTab) => {
    setDetail(null);
    if (critical) setClosedCritical(critical.id);
    setLocked(false);
    dispatch({ type: 'openHelp', alert, tab });
  };

  useEffect(() => setBarStyle('dark'), []);
  // Keep listening in the background (Android would otherwise freeze the app and drop the connection).
  useEffect(() => {
    if (offline) return;
    guardianService(true, child);
    return () => guardianService(false);
  }, [offline]);

  // Locked phone on the table: the screen dims after a while and wakes up for an alert, like a real one.
  const wake = () => setDim(false);
  useEffect(() => {
    if (!locked || dim) return;
    const t = setTimeout(() => setDim(true), 20_000);
    return () => clearTimeout(t);
  }, [locked, dim]);

  // New alerts and messages from Meera's phone: Android notification, sound, vibration, screen on.
  const seen = useRef<Set<string> | null>(null);
  const withdrawnSeen = useRef(new Set<string>());
  useEffect(() => {
    if (sync.state !== 'live' && !offline) return;
    if (seen.current === null) {
      // What was already there when this phone connected is history, not news.
      const t = setTimeout(() => {
        seen.current = new Set(guardianAlerts.map((a) => a.id));
        guardianAlerts.forEach((a) => a.withdrawn && withdrawnSeen.current.add(a.id));
      }, 1500);
      return () => clearTimeout(t);
    }
    for (const a of guardianAlerts) {
      if (a.withdrawn && !withdrawnSeen.current.has(a.id)) {
        withdrawnSeen.current.add(a.id);
        seen.current.add(a.id);
        void notify(`${a.id}-withdrawn`, `Update: ${a.guardianTitle}`, a.withdrawnReason ?? 'This alert was withdrawn. No action needed.', { alertId: a.id });
        continue;
      }
      if (seen.current.has(a.id)) continue;
      seen.current.add(a.id);
      if (a.historical || a.withdrawn) continue; // found while analysing earlier history: listed, never pushed
      wake();
      void notify(a.id, a.level === 3 ? `Critical: ${a.guardianTitle}` : a.guardianTitle, a.guardianBody, { alertId: a.id });
      buzz(a.level === 3 ? 3 : 2);
      if (sound) (a.level === 3 ? playCritical : playChime)();
    }
  }, [guardianAlerts, sync.state]); // eslint-disable-line react-hooks/exhaustive-deps

  const lastNotice = useRef<string | null>(null);
  useEffect(() => {
    if (!notice || notice.id === lastNotice.current) return;
    lastNotice.current = notice.id;
    wake();
    void notify(notice.id, notice.title, notice.body);
    if (notice.tone === 'urgent' && sound) playRing();
  }, [notice?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(
    () =>
      onNotificationTap((extra) => {
        setLocked(false);
        setDim(false);
        const a = useDemo.getState().data.alerts.find((x) => x.id === extra.alertId);
        if (a) {
          setTab('alerts');
          setDetail(a);
        }
      }),
    [],
  );

  useEffect(
    () =>
      onBack(() => {
        if (useDemo.getState().data.helpFor) dispatch({ type: 'closeHelp' });
        else if (detail) setDetail(null);
        else if (tab !== 'home') setTab('home');
        else if (!locked) setLocked(true);
        else return false;
        return true;
      }),
    [detail, tab, locked], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // A replaced case (new conversation, loaded history) takes its alerts with it: close what belonged to the old one.
  useEffect(() => {
    if (detail && !alerts.some((a) => a.id === detail.id)) setDetail(null);
    if (helpFor && !alerts.some((a) => a.id === helpFor.id)) dispatch({ type: 'closeHelp' });
  }, [alerts]); // eslint-disable-line react-hooks/exhaustive-deps

  const showCritical = critical && critical.id !== closedCritical && (!temporary || critical.level === 3);

  if (sync.state === 'ended' && temporary) return <AccessEnded why={sync.ended} />;

  return (
    <div className="gapp" onPointerDown={wake}>
      <AnimatePresence>{temporary && sync.access && !locked && <TempBanner access={sync.access} />}</AnimatePresence>

      <div className="gapp-body">
        {tab === 'home' && <HomeTab temporary={temporary} onOpen={(a) => (setTab('alerts'), setDetail(a))} onTab={setTab} />}
        {tab === 'alerts' && <AlertsTab onOpen={setDetail} />}
        {tab === 'report' && <ReportTab />}
        {tab === 'settings' && <SettingsTab temporary={temporary} onSetup={() => navigate('/app')} />}
      </div>

      <nav className="gtabs">
        {(
          [
            ['home', <Home size={20} />, 'Home'],
            ['alerts', <Bell size={20} />, 'Alerts'],
            ['report', <FileText size={20} />, 'Report'],
            ['settings', <Settings size={20} />, 'Settings'],
          ] as [Tab, ReactNode, string][]
        ).map(([t, icon, label]) => (
          <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
            {icon}
            <span>{label}</span>
            {t === 'alerts' && activeAlerts.length > 0 && <i className="gtab-badge">{activeAlerts.length}</i>}
          </button>
        ))}
      </nav>

      <AnimatePresence>{detail && <AlertSheet key={detail.id} alert={detail} temporary={temporary} onClose={() => setDetail(null)} onHelp={openHelp(detail)} />}</AnimatePresence>

      <AnimatePresence>
        {locked && (
          <LockScreen
            dim={dim}
            alerts={guardianAlerts}
            onUnlock={(a) => {
              setLocked(false);
              setDim(false);
              if (a) {
                setTab('alerts');
                setDetail(a);
              }
            }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>{notice && <NoticeBanner key={notice.id} notice={notice} />}</AnimatePresence>

      <AnimatePresence>
        {showCritical && (
          <div className="gapp-critical">
            <CriticalTakeover
              key={critical!.id}
              alert={critical!}
              onHelp={openHelp(critical!)}
              onClose={() => {
                setClosedCritical(critical!.id);
                setLocked(false);
              }}
            />
          </div>
        )}
      </AnimatePresence>

      <div className={`gapp-help ${helpFor ? 'on' : ''}`}>
        <GetHelp />
      </div>
    </div>
  );
}

// ---------- lock screen ----------

function LockScreen({ dim, alerts, onUnlock }: { dim: boolean; alerts: AlertItem[]; onUnlock: (a?: AlertItem) => void }) {
  const child = useChild();
  const clock = useClock();
  const recent = alerts.slice(-3).reverse();
  return (
    <motion.div className="glock" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ pointerEvents: 'none', opacity: 0, y: -40, transition: { duration: 0.3 } }}>
      <div className="lock-wallpaper" />
      <div className="glock-clock">
        <Lock size={14} />
        <div className="glock-time">{clock.time}</div>
        <div className="glock-date">{clock.date}</div>
      </div>
      <div className="glock-notifs">
        {recent.length === 0 ? (
          <div className="glock-quiet">
            <ShieldCheck size={18} /> RAKSHAK is looking out for {child}
          </div>
        ) : (
          recent.map((a) => (
            <motion.button key={a.id} layout className={`glock-notif l${a.level}`} onClick={() => onUnlock(a)} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
              <span className="app-icon sm">
                <ShieldCheck size={13} strokeWidth={2.6} />
              </span>
              <span className="glock-notif-text">
                <span className="glock-notif-meta">
                  RAKSHAK · {a.time}
                </span>
                <b>{a.level === 3 ? `Critical: ${a.guardianTitle}` : a.guardianTitle}</b>
                <span>{a.guardianBody}</span>
              </span>
            </motion.button>
          ))
        )}
      </div>
      <button className="glock-open" onClick={() => onUnlock()}>
        <span className="glock-bar" />
        Tap to open
      </button>
      <motion.div className="glock-dim" animate={{ opacity: dim ? 0.93 : 0 }} transition={{ duration: dim ? 1.2 : 0.25 }} style={{ pointerEvents: dim ? 'auto' : 'none' }} />
    </motion.div>
  );
}

// ---------- tabs ----------

function statusOf(level: Level) {
  if (level >= 3) return { text: 'Critical: act now', tone: 'bad' };
  if (level >= 2) return { text: 'Needs your attention', tone: 'warn' };
  return { text: 'Safe · no alerts', tone: 'ok' };
}

function HomeTab({ temporary, onOpen, onTab }: { temporary: boolean; onOpen: (a: AlertItem) => void; onTab: (t: Tab) => void }) {
  const child = useChild();
  const d = useDemo((s) => s.data);
  const sync = useSync();
  const device = useDevice();
  const alerts = d.alerts.filter((a) => a.level >= 2);
  const latest = alerts[alerts.length - 1];
  const level = (alerts.length ? d.level : 0) as Level;
  const st = statusOf(level);
  const talked = d.responses.some((r) => r.kind === 'guardian_talk' && r.alertId === latest?.id);

  return (
    <div className="gpage">
      <header className="gpage-head">
        <span className="brand-mark sm">
          <ShieldCheck size={14} strokeWidth={2.6} />
        </span>
        <div>
          <div className="gpage-brand">RAKSHAK Guardian</div>
          <div className="gpage-sub">{temporary ? `${device.name} · temporary guardian` : `${GUARDIAN.name} · ${child}'s guardian`}</div>
        </div>
      </header>

      <section className={`gcard gchild ${st.tone}`}>
        <div className="gchild-top">
          <div className="avatar">{child.charAt(0).toUpperCase()}</div>
          <div>
            <div className="gchild-name">{child}</div>
            <div className={`gchild-status ${st.tone}`}>
              <span className="sync-dot" /> {st.text}
            </div>
          </div>
          {level >= 2 && <ScoreRing score={d.score} size={64} />}
        </div>
        {level >= 2 && d.stage && <StageStepper stage={d.stage} compact />}
        <div className="gchild-note">
          <Lock size={11} /> You see warning signs and dates, never {child}'s messages.
        </div>
      </section>

      {latest ? (
        <button className={`gcard galert l${latest.level}`} onClick={() => onOpen(latest)}>
          <NeonBadge level={latest.level} size="sm" />
          <div className="galert-title">{latest.guardianTitle}</div>
          <div className="galert-body">{latest.guardianBody}</div>
          <div className="galert-foot">
            Day {latest.day} · {latest.time} <ChevronRight size={14} />
          </div>
        </button>
      ) : (
        <div className="gcard gquiet">
          <ShieldCheck size={22} />
          <div>
            <b>No alerts</b>
            <span>Level 1 nudges stay private to {child}. You hear from RAKSHAK only when it matters.</span>
          </div>
        </div>
      )}

      <div className="gquick">
        <button disabled={!latest || talked} onClick={() => latest && respond('guardian_talk', latest.id)}>
          <MessageCircleHeart size={18} /> {talked ? 'Check-in sent' : `Check in with ${child}`}
        </button>
        <button onClick={() => onTab('report')}>
          <FileText size={18} /> View report
        </button>
      </div>

      <section className="gcard">
        <div className="gcard-k">Guardians</div>
        <div className="grow">
          <Users size={15} /> {GUARDIAN.name} <em>main guardian</em>
        </div>
        {sync.guardians
          .filter((g) => g.state === 'active')
          .map((g) => (
            <div className="grow" key={g.id}>
              <Clock size={15} /> {g.claimedBy ?? 'Invite not used yet'} <em>temporary · until {fmtTime(g.expiresAt)}</em>
            </div>
          ))}
        {temporary && sync.access && (
          <div className="grow">
            <Clock size={15} /> {device.name} (you) <em>until {fmtTime(sync.access.expiresAt)}</em>
          </div>
        )}
      </section>

      {d.responses.length > 0 && (
        <section className="gcard">
          <div className="gcard-k">What's been done</div>
          {d.responses
            .slice(-5)
            .reverse()
            .map((r) => (
              <div className="grow" key={r.id}>
                <span className={`gdot ${r.by}`} /> {r.label} <em>{r.time}</em>
              </div>
            ))}
        </section>
      )}
    </div>
  );
}

function AlertsTab({ onOpen }: { onOpen: (a: AlertItem) => void }) {
  const all = useDemo((s) => s.data.alerts);
  const alerts = useMemo(() => all.filter((a) => a.level >= 2), [all]); // filter outside the selector: a new array each call would re-render forever
  const responses = useDemo((s) => s.data.responses);
  return (
    <div className="gpage">
      <header className="gpage-head">
        <div className="gpage-title">Alerts</div>
      </header>
      {alerts.length === 0 && (
        <div className="gcard gquiet">
          <Bell size={22} />
          <div>
            <b>Nothing yet</b>
            <span>When RAKSHAK sees a pattern that needs you, it shows up here and on your lock screen.</span>
          </div>
        </div>
      )}
      {alerts
        .slice()
        .reverse()
        .map((a) => {
          const done = responses.filter((r) => r.alertId === a.id).length;
          return (
            <button key={a.id} className={`gcard galert l${a.level}`} onClick={() => onOpen(a)}>
              <div className="galert-row">
                <NeonBadge level={a.level} size="sm" />
                <span className="galert-when">
                  Day {a.day} · {a.time}
                </span>
              </div>
              <div className="galert-title">{a.guardianTitle}</div>
              <div className="galert-contact">{a.contact}</div>
              <div className="galert-cues">
                {[...new Set(a.cues.map((c) => c.cue))].slice(0, 4).map((c) => (
                  <CueChip key={c} cue={c} />
                ))}
              </div>
              <div className="galert-foot">
                {done ? `${done} action${done === 1 ? '' : 's'} taken` : 'No action yet'} <ChevronRight size={14} />
              </div>
            </button>
          );
        })}
    </div>
  );
}

function ReportTab() {
  const child = useChild();
  const d = useDemo((s) => s.data);
  const alerts = d.alerts.filter((a) => a.level >= 2);
  const top = alerts.reduce<AlertItem | null>((m, a) => (!m || a.level >= m.level ? a : m), null);
  const cues = useMemo(() => {
    const seen = new Map<string, { cue: AlertItem['cues'][number]['cue']; day: number }>();
    for (const a of alerts) for (const c of a.cues) if (!seen.has(`${c.cue}-${c.day}`)) seen.set(`${c.cue}-${c.day}`, c);
    return [...seen.values()].sort((a, b) => a.day - b.day);
  }, [alerts]);
  const [shared, setShared] = useState<string | null>(null);

  if (!top) {
    return (
      <div className="gpage">
        <header className="gpage-head">
          <div className="gpage-title">Report</div>
        </header>
        <div className="gcard gquiet">
          <FileText size={22} />
          <div>
            <b>Nothing to report</b>
            <span>RAKSHAK has not alerted you about {child}. Reports appear here once there is a case.</span>
          </div>
        </div>
      </div>
    );
  }

  const text = [
    `RAKSHAK case report: ${child}`,
    `${top.guardianTitle} (${LEVEL_META[top.level].label}), ${top.contact}`,
    `Risk score ${d.score.toFixed(1)} / 12 · stage: ${d.stage.replace('_', ' / ')}`,
    'Warning signs:',
    ...cues.map((c) => `  Day ${c.day} (${WEEKDAYS[c.day]}): ${CUE_META[c.cue].label}`),
    'Actions taken:',
    ...(d.responses.length ? d.responses.map((r) => `  ${r.time}: ${r.label}`) : ['  none yet']),
    'AI-detected warning signs, not a confirmed offence. Message content is not included.',
    'Report online: cybercrime.gov.in · Helpline: 1930',
  ].join('\n');

  const share = async () => {
    try {
      if (isNative) await Share.share({ title: `RAKSHAK report: ${child}`, text, dialogTitle: 'Share report' });
      else if (navigator.share) await navigator.share({ title: 'RAKSHAK report', text });
      else {
        await navigator.clipboard.writeText(text);
        setShared('Copied to the clipboard.');
      }
    } catch {
      /* closed the share sheet */
    }
  };

  return (
    <div className="gpage">
      <header className="gpage-head">
        <div className="gpage-title">Report</div>
        <button className="gpage-action" onClick={share}>
          <Share2 size={16} /> Share
        </button>
      </header>

      <section className="gcard">
        <div className="gcard-k">Case</div>
        <div className="greport-title">{top.guardianTitle}</div>
        <div className="galert-contact">{top.contact}</div>
        <div className="greport-score">
          <ScoreRing score={d.score} size={84} />
          <div>
            <NeonBadge level={top.level} size="sm" />
            <div className="greport-stage">Stage: {d.stage.replace('_', ' / ')}</div>
          </div>
        </div>
        {top.category !== 'bullying' && <StageStepper stage={d.stage} compact />}
      </section>

      <section className="gcard">
        <div className="gcard-k">Risk over the days</div>
        <Sparkline points={d.history} />
      </section>

      <section className="gcard">
        <div className="gcard-k">Warning signs</div>
        {cues.map((c, i) => {
          const Icon = CUE_META[c.cue].icon;
          return (
            <div className="grow" key={i}>
              <Icon size={15} /> {CUE_META[c.cue].label}{' '}
              <em>
                Day {c.day} · {WEEKDAYS[c.day]}
              </em>
            </div>
          );
        })}
      </section>

      <section className="gcard">
        <div className="gcard-k">Actions taken</div>
        {d.responses.length === 0 ? (
          <div className="grow muted">None yet</div>
        ) : (
          d.responses.map((r) => (
            <div className="grow" key={r.id}>
              <span className={`gdot ${r.by}`} /> {r.label} <em>{r.time}</em>
            </div>
          ))
        )}
      </section>
      <p className="gfine">AI-detected warning signs, not a confirmed offence. The report contains no message content. {shared}</p>
    </div>
  );
}

function Sparkline({ points }: { points: { day: number; score: number }[] }) {
  if (points.length === 0) return <div className="grow muted">No scores yet</div>;
  const w = 300;
  const h = 90;
  const days = points.map((p) => p.day);
  const min = Math.min(...days);
  const span = Math.max(1, Math.max(...days) - min);
  const xy = points.map((p, i) => [points.length === 1 ? w / 2 : ((p.day - min) / span) * (w - 16) + 8 + (i ? 0 : 0), h - 8 - (Math.min(12, p.score) / 12) * (h - 16)]);
  const path = xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const yOf = (s: number) => h - 8 - (s / 12) * (h - 16);
  return (
    <svg className="gspark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      {[3, 6, 9].map((s) => (
        <line key={s} x1="0" x2={w} y1={yOf(s)} y2={yOf(s)} className={`gspark-th t${s}`} />
      ))}
      <path d={path} className="gspark-line" />
      {xy.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="3.2" className="gspark-dot" />
      ))}
    </svg>
  );
}

// ---------- settings and temporary guardians ----------

function SettingsTab({ temporary, onSetup }: { temporary: boolean; onSetup: () => void }) {
  const child = useChild();
  const sync = useSync();
  const device = useDevice();
  const [inviting, setInviting] = useState(false);
  const [tested, setTested] = useState(false);

  return (
    <div className="gpage">
      <header className="gpage-head">
        <div className="gpage-title">Settings</div>
      </header>

      {!temporary && (
        <section className="gcard">
          <div className="gcard-k">Temporary guardians</div>
          <p className="gfine left">
            A teacher on a school trip, an aunt for the weekend: they scan a code and get {child}'s alerts until a time you choose. They never get the
            main access code, and access ends by itself.
          </p>
          {sync.guardians.map((g) => (
            <GuardianRow key={g.id} g={g} />
          ))}
          <button className="gbtn primary" onClick={() => setInviting(true)}>
            <UserPlus size={16} /> Add temporary guardian
          </button>
        </section>
      )}

      <section className="gcard">
        <div className="gcard-k">Notifications</div>
        <div className="grow">
          <BellRing size={15} /> Level 2 and 3 alerts, and messages from {child}
        </div>
        <button
          className="gbtn"
          onClick={() => {
            void notify(`test-${Date.now()}`, 'RAKSHAK test notification', `This is how alerts about ${child} will arrive.`);
            setTested(true);
          }}
        >
          <Bell size={16} /> {tested ? (isNative ? 'Sent. Check the notification shade' : 'Notifications appear on the Android app') : 'Send a test notification'}
        </button>
      </section>

      <section className="gcard">
        <div className="gcard-k">This phone</div>
        <div className="grow">
          <Smartphone size={15} /> {temporary ? `${device.name} · temporary guardian` : `${GUARDIAN.name}'s phone`}
        </div>
        <div className="grow muted">
          {sync.state === 'live' ? `Connected · ${sync.peers} devices` : 'Not connected'} · {getServer().url || 'this laptop'}
        </div>
        <button
          className="gbtn"
          onClick={() => {
            if (temporary) setDevice({ role: null, name: '' });
            onSetup();
          }}
        >
          <QrCode size={16} /> {temporary ? 'Leave and set up again' : 'Set up this phone again'}
        </button>
      </section>

      <AnimatePresence>{inviting && <InviteSheet onClose={() => setInviting(false)} />}</AnimatePresence>
    </div>
  );
}

function GuardianRow({ g }: { g: GuardianView }) {
  const [busy, setBusy] = useState(false);
  const label = g.state === 'active' ? (g.connected ? 'connected' : g.claimedBy ? 'offline' : 'not scanned yet') : g.state;
  return (
    <div className={`grow ginvite ${g.state}`}>
      <Clock size={15} />
      <span className="ginvite-text">
        <b>{g.claimedBy ?? (g.label || 'Invite')}</b>
        <span>
          {g.scope === 'critical' ? 'Critical only' : 'All alerts'} · until {fmtTime(g.expiresAt)} · {label}
        </span>
      </span>
      {g.state === 'active' && (
        <button
          className="ginvite-x"
          disabled={busy}
          aria-label="Revoke"
          onClick={async () => {
            setBusy(true);
            await api.guardians.revoke(g.id).catch(() => {});
            setBusy(false);
          }}
        >
          <Trash2 size={15} />
        </button>
      )}
    </div>
  );
}

const DURATIONS = [
  { label: '1 hour', minutes: 60 },
  { label: '4 hours', minutes: 240 },
  { label: 'Today', minutes: 0 },
  { label: '3 days', minutes: 3 * 24 * 60 },
];

function InviteSheet({ onClose }: { onClose: () => void }) {
  const child = useChild();
  const sync = useSync();
  const [minutes, setMinutes] = useState(240);
  const [critical, setCritical] = useState(true);
  const [label, setLabel] = useState('');
  const [invite, setInvite] = useState<{ id: string; code: string; scope: 'all' | 'critical'; expiresAt: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const joined = invite ? sync.guardians.find((g) => g.id === invite.id && g.claimedBy) : undefined;

  const create = async () => {
    setErr(null);
    // "Today" = until 11:59 PM.
    const end = new Date();
    end.setHours(23, 59, 0, 0);
    const mins = minutes || Math.max(30, Math.round((end.getTime() - Date.now()) / 60000));
    try {
      setInvite(await api.guardians.invite({ minutes: mins, scope: critical ? 'critical' : 'all', label: label.trim() }));
    } catch {
      setErr('Could not create the invite. Is this phone connected?');
    }
  };

  const server = getServer();
  return (
    <motion.div className="msheet-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ pointerEvents: 'none', opacity: 0 }}>
      <motion.div className="msheet" initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ pointerEvents: 'none', y: '100%' }} transition={{ type: 'spring', stiffness: 300, damping: 32 }}>
        <button className="msheet-close" onClick={onClose} aria-label="Close">
          <X size={18} />
        </button>
        {!invite ? (
          <>
            <div className="msheet-icon">
              <UserPlus size={26} />
            </div>
            <div className="msheet-title">Add a temporary guardian</div>
            <div className="msheet-k">For how long?</div>
            <div className="gchips">
              {DURATIONS.map((d) => (
                <button key={d.label} className={minutes === d.minutes ? 'on' : ''} onClick={() => setMinutes(d.minutes)}>
                  {d.label}
                </button>
              ))}
            </div>
            <label className="gswitch">
              <input type="checkbox" checked={critical} onChange={(e) => setCritical(e.target.checked)} />
              <span>
                <b>Critical alerts only</b>
                <em>Recommended. They hear about emergencies, nothing else.</em>
              </span>
            </label>
            <input className="srv-input" placeholder="What for? e.g. School trip (optional)" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={40} />
            {err && <p className="mhome-note strong bad">{err}</p>}
            <button className="msheet-go" onClick={create}>
              Create invite QR
            </button>
          </>
        ) : joined ? (
          <>
            <div className="msheet-icon ok">
              <Users size={26} />
            </div>
            <div className="msheet-title">{joined.claimedBy} joined</div>
            <p className="msheet-text">
              They'll get {joined.scope === 'critical' ? 'critical alerts' : 'alerts'} about {child} until {fmtTime(joined.expiresAt)}. Revoke any time in Settings.
            </p>
            <button className="msheet-go" onClick={onClose}>
              Done
            </button>
          </>
        ) : (
          <>
            <div className="msheet-title">Scan with their phone</div>
            <p className="msheet-text">
              Open RAKSHAK on their phone → Scan QR code. Valid until <b>{fmtTime(invite.expiresAt)}</b> · {invite.scope === 'critical' ? 'critical alerts only' : 'all alerts'}.
            </p>
            <div className="msheet-qr">
              <QrImage text={encodePairing({ kind: 'guardian', url: server.url || location.origin, code: invite.code, scope: invite.scope, expiresAt: invite.expiresAt, child: child })} size={230} />
            </div>
            <p className="gfine">This code is their own key, not yours. It stops working at the end time or when you revoke it.</p>
          </>
        )}
      </motion.div>
    </motion.div>
  );
}

function TempBanner({ access }: { access: GuardianView }) {
  return (
    <motion.div className="gtemp" initial={{ y: -30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ pointerEvents: 'none', y: -30, opacity: 0 }}>
      <Clock size={13} /> Temporary guardian · {access.scope === 'critical' ? 'critical alerts only' : 'all alerts'} · until {fmtTime(access.expiresAt)}
    </motion.div>
  );
}

function AccessEnded({ why }: { why: 'expired' | 'revoked' | null }) {
  const child = useChild();
  const navigate = useNavigate();
  useEffect(() => resetForRole(), []); // forget the case on this phone
  return (
    <div className="gapp gended">
      <div className="msheet-icon">
        <Clock size={26} />
      </div>
      <div className="msheet-title">Your temporary access has ended</div>
      <p className="msheet-text">
        {why === 'revoked' ? `${GUARDIAN.name} ended your access.` : 'The time you were given is over.'} RAKSHAK no longer sends you alerts about {child}, and nothing about
        the case is kept on this phone.
      </p>
      <button
        className="msheet-go"
        onClick={() => {
          setDevice({ role: null, name: '' });
          navigate('/app');
        }}
      >
        OK
      </button>
    </div>
  );
}
