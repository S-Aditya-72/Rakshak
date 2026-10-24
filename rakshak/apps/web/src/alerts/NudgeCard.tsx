import { AnimatePresence, motion } from 'framer-motion';
import { HeartHandshake, ShieldCheck, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { GUARDIAN } from '../data/meta';
import { blockActiveContact, dismissNudge, useDemo } from '../store';
import type { AlertItem } from '../types';
import { HazardStripe } from './primitives';

type Copy = { title: string; body: string; canDismiss: boolean; primary: string };

// Child-facing copy. Deliberately calm at every level: the alarming visuals are for the guardian only.
const COPY: Record<1 | 2 | 3, Copy> = {
  1: {
    title: 'A quick check-in 💛',
    body: "Safe people don't ask you to hide chats from your family. Want to talk to someone you trust?",
    canDismiss: true,
    primary: 'Talk to someone',
  },
  2: {
    title: "You don't have to send anything",
    body: `Asking for photos and keeping it secret is a warning sign. We've let ${GUARDIAN.name} know. You're not in trouble.`,
    canDismiss: false,
    primary: `Talk to ${GUARDIAN.name}`,
  },
  3: {
    title: "You're not alone in this",
    body: `Don't pay and don't delete anything. This isn't your fault. ${GUARDIAN.name} has been alerted and help is on the way.`,
    canDismiss: false,
    primary: `Call ${GUARDIAN.name}`,
  },
};

// Bullying cases get their own wording: supportive, never blaming, no stranger-danger framing.
const BULLYING_COPY: Record<1 | 2 | 3, Copy> = {
  1: {
    title: "That message wasn't okay 💛",
    body: "Nobody deserves to be talked to like that. Want to talk to someone you trust about it?",
    canDismiss: true,
    primary: 'Talk to someone',
  },
  2: {
    title: "This keeps happening, and it's not okay",
    body: `We've let ${GUARDIAN.name} know so you don't have to handle this alone. You're not in trouble.`,
    canDismiss: false,
    primary: `Talk to ${GUARDIAN.name}`,
  },
  3: {
    title: "You're not alone in this",
    body: `Someone made a threat. Save the messages, don't reply, and stay with a trusted adult. ${GUARDIAN.name} has been alerted.`,
    canDismiss: false,
    primary: `Call ${GUARDIAN.name}`,
  },
};

export function NudgeCard() {
  const alert = useDemo((s) => s.data.victimNudge);
  return <AnimatePresence>{alert && <Card key={alert.id} alert={alert} />}</AnimatePresence>;
}

function Card({ alert }: { alert: AlertItem }) {
  const dispatch = useDemo((s) => s.dispatch);
  const [done, setDone] = useState<string | null>(null);
  const base = (alert.category === 'bullying' ? BULLYING_COPY : COPY)[alert.level];
  // "Don't pay" only when a payment or threat was actually detected; otherwise the generic critical wording.
  const copy =
    alert.level === 3 && alert.category !== 'bullying' && !alert.cues.some((c) => c.cue === 'threat_payment')
      ? { ...base, body: `This isn't your fault. Please don't delete anything. ${GUARDIAN.name} has been alerted and help is on the way.` }
      : base;

  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => dispatch({ type: 'closeNudge' }), 2200);
    return () => clearTimeout(t);
  }, [done, dispatch]);

  return (
    <motion.div
      className={`nudge nudge-l${alert.level}`}
      initial={{ y: 60, opacity: 0, scale: 0.96 }}
      animate={{ y: 0, opacity: 1, scale: 1 }}
      exit={{ y: 40, opacity: 0, scale: 0.97, transition: { duration: 0.22 } }}
      transition={{ type: 'spring', stiffness: 260, damping: 26 }}
    >
      <HazardStripe tone="soft" height={5} />
      <div className="nudge-body">
        <div className="nudge-head">
          <span className="nudge-brand">
            <ShieldCheck size={13} strokeWidth={2.6} /> RAKSHAK
          </span>
          <span className="nudge-private">Private to you</span>
          {copy.canDismiss && !done && (
            <button className="nudge-x" aria-label="Dismiss" onClick={() => dismissNudge()}>
              <X size={14} strokeWidth={2.6} />
            </button>
          )}
        </div>

        <AnimatePresence mode="wait" initial={false}>
          {done ? (
            <motion.div key="done" className="nudge-done" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <HeartHandshake size={20} strokeWidth={2.2} />
              <span>{done}</span>
            </motion.div>
          ) : (
            <motion.div key="ask" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, y: -6 }}>
              <div className="nudge-title">{copy.title}</div>
              <div className="nudge-text">{copy.body}</div>
              <div className="nudge-actions">
                <button className="nudge-btn primary" onClick={() => setDone(`Okay. We've let ${GUARDIAN.name} know you'd like to talk.`)}>
                  {copy.primary}
                </button>
                <button
                  className="nudge-btn"
                  onClick={() => {
                    blockActiveContact();
                    setDone('Contact blocked (demo). You did the right thing.');
                  }}
                >
                  Block
                </button>
                {copy.canDismiss ? (
                  <button className="nudge-btn ghost" onClick={() => dismissNudge()}>
                    Dismiss
                  </button>
                ) : (
                  <button className="nudge-btn ghost" onClick={() => dispatch({ type: 'closeNudge' })}>
                    Got it
                  </button>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
