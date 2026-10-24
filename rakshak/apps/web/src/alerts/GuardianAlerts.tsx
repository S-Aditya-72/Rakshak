import { AnimatePresence, motion } from 'framer-motion';
import { Ban, Lock, MessageCircleHeart, Phone, ShieldCheck, Users, X } from 'lucide-react';
import { useEffect } from 'react';
import { CHILD, CUE_META, LEVEL_META, WEEKDAYS } from '../data/meta';
import { useDemo } from '../store';
import type { AlertItem } from '../types';
import { Icon3DWarning } from './Icon3DWarning';
import { HazardStripe, NeonBadge, ScoreRing, StageStepper } from './primitives';
import { ReportFlow } from './ReportFlow';

export function AppIcon({ size = 22 }: { size?: number }) {
  return (
    <span className="app-icon" style={{ width: size, height: size, borderRadius: size * 0.27 }}>
      <ShieldCheck size={size * 0.62} strokeWidth={2.6} />
    </span>
  );
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
      exit={{ y: -140, opacity: 0, transition: { duration: 0.25 } }}
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

/** Lock-screen notification for alert history. */
export function NotificationCard({ alert }: { alert: AlertItem }) {
  const dispatch = useDemo((s) => s.dispatch);
  const critical = alert.level === 3;
  return (
    <motion.button
      layout
      layoutId={`card-${alert.id}`}
      className={`g-notif ${critical ? 'g-notif-critical' : ''}`}
      initial={{ opacity: 0, y: 20, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: 'spring', stiffness: 300, damping: 28 }}
      onClick={() => dispatch({ type: 'openSheet', alert })}
    >
      <AppIcon size={30} />
      <div className="g-notif-text">
        <div className="g-notif-meta">
          <span>RAKSHAK</span>
          <span>
            Day {alert.day} · {alert.time}
          </span>
        </div>
        <div className="g-notif-title" style={{ color: LEVEL_META[alert.level].color }}>
          {critical ? 'Critical: ' : ''}
          {alert.guardianTitle}
        </div>
        <div className="g-notif-body">{alert.guardianBody}</div>
      </div>
    </motion.button>
  );
}

/** Expanded Level 2/3 summary: only the minimal guardian payload, never chat text. */
export function AlertSheet({ alert }: { alert: AlertItem }) {
  const dispatch = useDemo((s) => s.dispatch);
  const dismissals = useDemo((s) => s.data.dismissals);
  const critical = alert.level === 3;

  return (
    <>
      <motion.div
        className="sheet-scrim"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={() => dispatch({ type: 'closeSheet' })}
      />
      <motion.div
        className={`sheet ${critical ? 'sheet-critical' : ''}`}
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%', transition: { duration: 0.28, ease: [0.4, 0, 1, 1] } }}
        transition={{ type: 'spring', stiffness: 260, damping: 30 }}
      >
        <div className="sheet-grabber" />
        <div className="sheet-head">
          <Icon3DWarning variant={critical ? 'red' : 'amber'} size={52} />
          <div>
            <NeonBadge level={alert.level} size="sm" />
            <div className="sheet-title">{alert.guardianTitle}</div>
            <div className="sheet-sub">
              {alert.contact} · {CHILD.name}'s phone{alert.preview ? ' · preview' : ''}
            </div>
          </div>
          <button className="sheet-x" onClick={() => dispatch({ type: 'closeSheet' })} aria-label="Close">
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
            <Lock size={12} strokeWidth={2.4} /> Message content stays on {CHILD.name}'s device. You see cue types and dates only.
          </div>
          <div className="privacy-line">AI-detected warning signs, not a confirmed offence. Please review with {CHILD.name} before acting.</div>

          <div className="sheet-actions">
            {critical ? (
              <button className="btn-critical" onClick={() => dispatch({ type: 'openReport' })}>
                Start guided report
              </button>
            ) : (
              <button className="btn-amber">
                <MessageCircleHeart size={16} /> Talk to {CHILD.name}
              </button>
            )}
            <div className="sheet-actions-row">
              <button className="btn-glass">
                <Ban size={15} /> Block contact
              </button>
              <button className="btn-glass">
                <Users size={15} /> Loop in counsellor
              </button>
            </div>
          </div>
        </div>
      </motion.div>
    </>
  );
}

/** Level 3: full-screen dark "CRITICAL" takeover with neon border, hazard band and siren glow. */
export function CriticalTakeover({ alert }: { alert: AlertItem }) {
  const dispatch = useDemo((s) => s.dispatch);
  const reportOpen = useDemo((s) => s.data.reportOpen);

  return (
    <motion.div className="critical" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.3 } }}>
      <div className="critical-vignette" />
      <div className="critical-border" />

      <AnimatePresence mode="wait">
        {reportOpen ? (
          <motion.div key="report" className="critical-inner" initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 40 }}>
            <ReportFlow onClose={() => dispatch({ type: 'closeReport' })} />
          </motion.div>
        ) : (
          <motion.div
            key="alert"
            className="critical-inner"
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ opacity: 0, x: -40 }}
            transition={{ type: 'spring', stiffness: 220, damping: 22, delay: 0.2 }}
          >
            <HazardStripe tone="amber" height={14} />
            <div className="critical-top">
              <span className="critical-app">
                <AppIcon size={18} /> RAKSHAK · Day {alert.day} · {alert.time}
              </span>
              <button className="critical-x" onClick={() => dispatch({ type: 'closeCritical' })} aria-label="Close">
                <X size={14} strokeWidth={2.8} />
              </button>
            </div>

            <div className="critical-word">CRITICAL</div>

            <div className="critical-icon">
              <div className="siren-beam" />
              <div className="siren-glow" />
              <motion.div
                initial={{ y: -30, scale: 0.6 }}
                animate={{ y: 0, scale: 1 }}
                transition={{ type: 'spring', stiffness: 300, damping: 12, delay: 0.35 }}
              >
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
                    <li>A threat was made. Keep {CHILD.name} with a trusted adult.</li>
                    <li>Don't delete anything. Save the messages as evidence.</li>
                    <li>Contact the school; involve police only if safety is at risk.</li>
                  </>
                ) : alert.cues.some((c) => c.cue === 'threat_payment') ? (
                  <>
                    <li>Don't pay. Payment rarely stops the threats.</li>
                    <li>Don't delete anything. Chats are evidence.</li>
                    <li>Reassure {CHILD.name}: this is not their fault.</li>
                  </>
                ) : (
                  <>
                    <li>Don't delete anything. Chats are evidence.</li>
                    <li>Talk calmly with {CHILD.name}: this is not their fault.</li>
                    <li>Don't confront the contact yourself; use the guided report.</li>
                  </>
                )}
              </ul>
            </div>

            <div className="critical-actions">
              <motion.button className="btn-critical" whileTap={{ scale: 0.97 }} onClick={() => dispatch({ type: 'openReport' })}>
                Start guided report
              </motion.button>
              <div className="sheet-actions-row">
                <button className="btn-glass">
                  <Phone size={15} /> Call 1930
                </button>
                <button className="btn-glass">
                  <Users size={15} /> Trusted adult
                </button>
              </div>
            </div>
            <div className="privacy-line dark">
              <Lock size={11} strokeWidth={2.4} /> Message content stays on {CHILD.name}'s device
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
