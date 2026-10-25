import { motion } from 'framer-motion';
import { Ban, Check, HeartHandshake, LifeBuoy, Lock, MessageCircleHeart, Phone, ShieldCheck, Siren, Users, X } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { CUE_META, LEVEL_META, WEEKDAYS } from '../data/meta';
import { buzz, openExternal } from '../lib/native';
import { blockContact, childNameOf, isBlocked, respond, useDemo, type HelpTab } from '../store';
import type { AlertItem, Notice, ResponseKind } from '../types';
import { Icon3DWarning } from './Icon3DWarning';
import { HazardStripe, NeonBadge, ScoreRing, StageStepper } from './primitives';

export function AppIcon({ size = 22 }: { size?: number }) {
  return (
    <span className="app-icon" style={{ width: size, height: size, borderRadius: size * 0.27 }}>
      <ShieldCheck size={size * 0.62} strokeWidth={2.6} />
    </span>
  );
}

/** The child named in the alert itself (alerts keep their original identity), falling back to the loaded case. */
function useChildName(alert: AlertItem) {
  const current = useDemo((s) => childNameOf(s.data));
  return alert.childName ?? current;
}

/** Level 2: iOS "Time Sensitive" banner that drops in from the top. */
export function GuardianBanner({ alert }: { alert: AlertItem }) {
  const dispatch = useDemo((s) => s.dispatch);

  useEffect(() => {
    const t = setTimeout(() => dispatch({ type: 'closeBanner' }), 9000);
    return () => clearTimeout(t);
  }, [alert.id, dispatch]);

  return (
    <motion.div
      layoutId={`card-${alert.id}`}
      className="g-banner"
      initial={{ y: -140, opacity: 0, scale: 0.92 }}
      animate={{ y: 0, opacity: 1, scale: 1 }}
      exit={{ pointerEvents: 'none', y: -140, opacity: 0, transition: { duration: 0.25 } }}
      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
      onClick={() => dispatch({ type: 'openSheet', alert })}
    >
      <div className="g-banner-glow" />
      <motion.div
        className="g-banner-icon"
        initial={{ scale: 0.4, rotate: -12 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ type: 'spring', stiffness: 500, damping: 14, delay: 0.15 }}
      >
        <Icon3DWarning variant="amber" size={42} />
      </motion.div>
      <div className="g-banner-text">
        <div className="g-banner-meta">
          <span className="ts-label">TIME SENSITIVE</span>
          <span className="g-banner-time">now</span>
        </div>
        <div className="g-banner-title">{alert.guardianTitle}</div>
        <div className="g-banner-body">{alert.guardianBody}</div>
      </div>
      <button
        className="g-banner-x"
        aria-label="Close"
        onClick={(e) => {
          e.stopPropagation();
          dispatch({ type: 'closeBanner' });
        }}
      >
        <X size={13} strokeWidth={2.8} />
      </button>
    </motion.div>
  );
}

/** A message from the child's phone (help request, reply, SOS), dropped in like a banner. */
export function NoticeBanner({ notice }: { notice: Notice }) {
  const dispatch = useDemo((s) => s.dispatch);
  const child = useDemo((s) => childNameOf(s.data));
  const urgent = notice.tone === 'urgent';
  useEffect(() => {
    buzz(urgent ? 3 : 1);
    if (urgent) return;
    const t = setTimeout(() => dispatch({ type: 'clearNotice', who: 'guardian' }), 10000);
    return () => clearTimeout(t);
  }, [notice.id, urgent, dispatch]);
  return (
    <motion.div
      className={`g-banner g-notice ${notice.tone}`}
      initial={{ y: -140, opacity: 0, scale: 0.92 }}
      animate={{ y: 0, opacity: 1, scale: 1 }}
      exit={{ pointerEvents: 'none', y: -140, opacity: 0, transition: { duration: 0.25 } }}
      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
      onClick={() => dispatch({ type: 'clearNotice', who: 'guardian' })}
    >
      <div className="g-notice-icon">{urgent ? <Siren size={20} strokeWidth={2.4} /> : <HeartHandshake size={20} strokeWidth={2.4} />}</div>
      <div className="g-banner-text">
        <div className="g-banner-meta">
          <span className="ts-label">{urgent ? 'SOS' : notice.tone === 'warn' ? 'HEADS UP' : `FROM ${child.toUpperCase()}`}</span>
          <span className="g-banner-time">{notice.time}</span>
        </div>
        <div className="g-banner-title">{notice.title}</div>
        <div className="g-banner-body">{notice.body}</div>
      </div>
    </motion.div>
  );
}

/** A response button that shows when it has been done (read from the shared case, so every phone agrees). */
function ActionButton({ kind, alert, className, icon, label, doneLabel, onPress }: { kind: ResponseKind; alert: AlertItem; className: string; icon: ReactNode; label: string; doneLabel: string; onPress: () => void }) {
  const done = useDemo((s) => s.data.responses.some((r) => r.kind === kind && r.alertId === alert.id));
  return (
    <button className={`${className} ${done ? 'is-done' : ''}`} disabled={done} onClick={onPress}>
      {done ? <Check size={15} strokeWidth={2.6} /> : icon} {done ? doneLabel : label}
    </button>
  );
}

/** Calls the national cybercrime helpline: opens the phone's dialer with 1930 filled in. */
function useCall1930(alert: AlertItem) {
  const [note, setNote] = useState<string | null>(null);
  const call = () => {
    const opened = openExternal('tel:1930');
    if (opened) respond('guardian_call', alert.id);
    setNote(opened ? 'Dialer opened with 1930. Press call when you are ready.' : 'On a phone this opens the dialer with 1930 (cybercrime helpline).');
  };
  return { call, note };
}

/** Lock-screen notification for alert history. */
export function NotificationCard({ alert }: { alert: AlertItem }) {
  const dispatch = useDemo((s) => s.dispatch);
  const critical = alert.level === 3;
  return (
    <motion.button
      layout
      layoutId={`card-${alert.id}`}
      className={`g-notif ${critical && !alert.withdrawn ? 'g-notif-critical' : ''} ${alert.historical ? 'g-notif-hist' : ''}`}
      style={alert.withdrawn ? { opacity: 0.72 } : undefined}
      initial={{ opacity: 0, y: 20, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: 'spring', stiffness: 300, damping: 28 }}
      onClick={() => dispatch({ type: 'openSheet', alert })}
    >
      <AppIcon size={30} />
      <div className="g-notif-text">
        <div className="g-notif-meta">
          <span>RAKSHAK{alert.historical ? ' · from earlier history' : ''}</span>
          <span>
            Day {alert.day} · {alert.time}
          </span>
        </div>
        {alert.withdrawn ? (
          <>
            <div className="g-notif-title">
              Withdrawn: <s>{alert.guardianTitle}</s>
            </div>
            <div className="g-notif-body">{alert.withdrawnReason}</div>
          </>
        ) : (
          <>
            <div className="g-notif-title" style={{ color: LEVEL_META[alert.level].color }}>
              {critical ? 'Critical: ' : ''}
              {alert.guardianTitle}
            </div>
            <div className="g-notif-body">{alert.guardianBody}</div>
          </>
        )}
      </div>
    </motion.button>
  );
}

/** Expanded Level 2/3 summary: only the minimal guardian payload, never chat text. */
/** Each guardian phone opens and closes its own screens; the laptop's drawn phone uses the shared state (defaults). */
interface ScreenControls {
  onClose?: () => void;
  onHelp?: (tab: HelpTab) => void;
}

export function AlertSheet({ alert, onClose, onHelp, temporary }: { alert: AlertItem; temporary?: boolean } & ScreenControls) {
  const dispatch = useDemo((s) => s.dispatch);
  const close = onClose ?? (() => dispatch({ type: 'closeSheet' }));
  const dismissals = useDemo((s) => s.data.dismissals);
  const child = useChildName(alert);
  const critical = alert.level === 3;
  const help = onHelp ?? ((tab: HelpTab) => dispatch({ type: 'openHelp', alert, tab }));

  return (
    <>
      <motion.div
        className="sheet-scrim"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ pointerEvents: 'none', opacity: 0 }}
        onClick={close}
      />
      <motion.div
        className={`sheet ${critical ? 'sheet-critical' : ''}`}
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ pointerEvents: 'none', y: '100%', transition: { duration: 0.28, ease: [0.4, 0, 1, 1] } }}
        transition={{ type: 'spring', stiffness: 260, damping: 30 }}
      >
        <div className="sheet-grabber" />
        <div className="sheet-head">
          <Icon3DWarning variant={critical ? 'red' : 'amber'} size={52} />
          <div>
            <NeonBadge level={alert.level} size="sm" />
            <div className="sheet-title">{alert.guardianTitle}</div>
            <div className="sheet-sub">
              {alert.contact} · about {child}
              {alert.preview ? ' · preview' : ''}
              {alert.historical ? ' · from earlier history' : ''}
            </div>
          </div>
          <button className="sheet-x" onClick={close} aria-label="Close">
            <X size={15} strokeWidth={2.6} />
          </button>
        </div>

        <div className="sheet-scroll">
          <div className="sheet-card sheet-score">
            <ScoreRing score={alert.score} size={104} />
            <div className="sheet-score-text">
              <div className="sheet-k">{alert.category === 'bullying' ? 'Case type' : 'Pattern stage'}</div>
              <div className="sheet-v">{alert.category === 'bullying' ? 'bullying' : alert.stage.replace('_', ' / ')}</div>
              <div className="sheet-k">Child dismissed nudges</div>
              <div className="sheet-v">{dismissals}×</div>
            </div>
          </div>

          {alert.category !== 'bullying' && (
            <div className="sheet-card">
              <StageStepper stage={alert.stage} compact />
            </div>
          )}

          <div className="sheet-card">
            <div className="sheet-card-title">Cue timeline</div>
            <div className="timeline">
              {alert.cues.map((c, i) => {
                const meta = CUE_META[c.cue];
                const Icon = meta.icon;
                return (
                  <motion.div
                    key={i}
                    className="timeline-row"
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.15 + i * 0.08 }}
                  >
                    <span className={`timeline-dot ${meta.weight >= 3 ? 'hot' : ''}`}>
                      <Icon size={12} strokeWidth={2.4} />
                    </span>
                    <span className="timeline-cue">{meta.label}</span>
                    <span className="timeline-day">
                      Day {c.day} · {WEEKDAYS[c.day]}
                    </span>
                  </motion.div>
                );
              })}
            </div>
          </div>

          <div className="privacy-line">
            <Lock size={12} strokeWidth={2.4} /> This alert shows cue types and dates only, never {child}'s messages.
          </div>
          <div className="privacy-line">AI-detected warning signs, not a confirmed offence. Please review with {child} before acting.</div>

          <div className="sheet-actions">
            <button className={critical ? 'btn-critical' : 'btn-amber'} onClick={() => help('understand')}>
              <LifeBuoy size={16} /> Get help
            </button>
            <div className="sheet-actions-row">
              <ActionButton
                kind="guardian_talk"
                alert={alert}
                className="btn-glass"
                icon={<MessageCircleHeart size={15} />}
                label={`Talk to ${child}`}
                doneLabel={`Check-in sent to ${child}`}
                onPress={() => respond('guardian_talk', alert.id)}
              />
              {alert.category !== 'bullying' && alert.contactId && !temporary ? (
                <BlockButton alert={alert} />
              ) : (
                <ActionButton kind="guardian_trusted" alert={alert} className="btn-glass" icon={<Users size={15} />} label="Trusted adult" doneLabel="Alerted" onPress={() => respond('guardian_trusted', alert.id)} />
              )}
            </div>
            <ActionButton kind="guardian_counsellor" alert={alert} className="btn-glass" icon={<Users size={15} />} label="Loop in counsellor" doneLabel="Counsellor notified" onPress={() => respond('guardian_counsellor', alert.id)} />
            <ResponseLog alertId={alert.id} />
          </div>
        </div>
      </motion.div>
    </>
  );
}

function BlockButton({ alert }: { alert: AlertItem }) {
  const blocked = useDemo((s) => s.data.blocks.some((b) => b.contactId === alert.contactId));
  return (
    <button className={`btn-glass ${blocked ? 'is-done' : ''}`} disabled={blocked} onClick={() => !isBlocked(alert.contactId) && blockContact(alert.contactId, 'guardian', alert.id)}>
      {blocked ? <Check size={15} strokeWidth={2.6} /> : <Ban size={15} />} {blocked ? 'Contact blocked' : 'Block contact'}
    </button>
  );
}

/** What has been done about this case so far, from both phones. */
function ResponseLog({ alertId, dark }: { alertId?: string; dark?: boolean }) {
  const responses = useDemo((s) => s.data.responses);
  if (responses.length === 0) return null;
  return (
    <div className={`resp-log ${dark ? 'dark' : ''}`}>
      {responses.slice(-4).map((r) => (
        <div key={r.id} className={`resp-row ${r.alertId === alertId ? 'this' : ''}`}>
          <Check size={11} strokeWidth={3} /> <span>{r.label}</span> <em>{r.time}</em>
        </div>
      ))}
    </div>
  );
}

/** Level 3: full-screen dark "CRITICAL" takeover with neon border, hazard band and siren glow. */
export function CriticalTakeover({ alert, onClose, onHelp }: { alert: AlertItem } & ScreenControls) {
  const dispatch = useDemo((s) => s.dispatch);
  const close = onClose ?? (() => dispatch({ type: 'closeCritical' }));
  const help = onHelp ?? ((tab: HelpTab) => dispatch({ type: 'openHelp', alert, tab }));
  const child = useChildName(alert);
  const { call, note } = useCall1930(alert);

  return (
    <motion.div className="critical" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ pointerEvents: 'none', opacity: 0, transition: { duration: 0.3 } }}>
      <div className="critical-vignette" />
      <div className="critical-border" />

      <motion.div
        className="critical-inner"
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ pointerEvents: 'none', opacity: 0, x: -40 }}
        transition={{ type: 'spring', stiffness: 220, damping: 22, delay: 0.2 }}
      >
        <HazardStripe tone="amber" height={14} />
        <div className="critical-top">
          <span className="critical-app">
            <AppIcon size={18} /> RAKSHAK · Day {alert.day} · {alert.time}
          </span>
          <button className="critical-x" onClick={close} aria-label="Close">
            <X size={14} strokeWidth={2.8} />
          </button>
        </div>

        <div className="critical-word">CRITICAL</div>

        <div className="critical-icon">
          <div className="siren-beam" />
          <div className="siren-glow" />
          <motion.div initial={{ y: -30, scale: 0.6 }} animate={{ y: 0, scale: 1 }} transition={{ type: 'spring', stiffness: 300, damping: 12, delay: 0.35 }}>
            <Icon3DWarning variant="red" size={128} pedestal />
          </motion.div>
        </div>

        <div className="critical-card">
          <div className="critical-feature">URGENT ALERT</div>
          <div className="critical-title">{alert.guardianTitle}</div>
          <div className="critical-body">{alert.guardianBody}</div>
          <ul className="critical-list">
            {alert.category === 'bullying' ? (
              <>
                <li>A threat was detected. Keep {child} with a trusted adult.</li>
                <li>Don't delete anything. Save the messages as evidence.</li>
                <li>Contact the school; involve police if safety is at risk.</li>
              </>
            ) : alert.cues.some((c) => c.cue === 'threat_payment') ? (
              <>
                <li>Don't pay. Payment rarely stops the threats.</li>
                <li>Don't delete anything. Chats are evidence.</li>
                <li>Reassure {child}: this is not their fault.</li>
              </>
            ) : (
              <>
                <li>Don't delete anything. Chats are evidence.</li>
                <li>Talk calmly with {child}: this is not their fault.</li>
                <li>Don't confront the contact yourself. Get help walks you through it.</li>
              </>
            )}
          </ul>
        </div>

        <div className="critical-actions">
          <motion.button className="btn-critical" whileTap={{ scale: 0.97 }} onClick={() => help('understand')}>
            <LifeBuoy size={16} /> Get help
          </motion.button>
          <div className="sheet-actions-row">
            <button className="btn-glass" onClick={call}>
              <Phone size={15} /> Call 1930
            </button>
            <button className="btn-glass" onClick={() => help('support')}>
              <HeartHandshake size={15} /> Support {child}
            </button>
          </div>
          <button className="btn-glass" onClick={() => help('complaint')}>
            Reporting options
          </button>
          {note && <div className="resp-note">{note}</div>}
          <ResponseLog alertId={alert.id} dark />
        </div>
        <div className="privacy-line dark">
          <Lock size={11} strokeWidth={2.4} /> Nothing is sent or reported automatically
        </div>
      </motion.div>
    </motion.div>
  );
}
