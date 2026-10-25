import { AnimatePresence, motion } from 'framer-motion';
import { HeartHandshake, MessageCircleHeart, ShieldCheck, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { GUARDIAN } from '../data/meta';
import { buzz } from '../lib/native';
import { blockActiveContact, dismissNudge, replyToGuardian, respond, useDemo } from '../store';
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
    body: `Don't pay and don't delete anything. This isn't your fault. ${GUARDIAN.name} has been alerted.`,
    canDismiss: false,
    primary: `SOS to ${GUARDIAN.name}`,
  },
};

// Grooming L1/L2 copy names only what was actually detected (no "keeping it secret" unless secrecy was found).
// Order = which behaviour leads the sentence when several were found.
const ASKED: [string, string][] = [
  ['threat_payment', 'threatening you or asking for money'],
  ['image_request', 'asking for photos of you'],
  ['meeting_request', 'asking to meet you'],
  ['disable_protection', 'asking you to delete chats or turn off safety apps'],
  ['secrecy', 'asking you to keep chats secret'],
  ['personal_info_request', "asking where you are or when you're alone"],
  ['platform_move', 'asking you to move to another app'],
  ['isolation', 'trying to pull you away from family or friends'],
  ['manipulation', 'making you feel you owe them'],
  ['flattery_age', 'saying you seem older than you are'],
];

function groomingCopy(level: 1 | 2, cues: string[]): Copy {
  const found = ASKED.filter(([c]) => cues.includes(c)).map(([, t]) => t).slice(0, 2);
  const what = found.length ? found.join(' and ') : 'some of the messages in this chat';
  const sign = `${what.charAt(0).toUpperCase()}${what.slice(1)} ${found.length ? 'is' : 'are'} a warning sign.`;
  if (level === 1) return { ...COPY[1], body: `${sign} Want to talk to someone you trust?` };
  const title = cues.includes('image_request')
    ? "You don't have to send anything"
    : cues.includes('meeting_request')
      ? "You don't have to meet anyone"
      : "You don't have to do anything that feels wrong";
  return { ...COPY[2], title, body: `${sign} We've let ${GUARDIAN.name} know. You're not in trouble.` };
}

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
    primary: `SOS to ${GUARDIAN.name}`,
  },
};

export function NudgeCard() {
  const alert = useDemo((s) => s.data.victimNudge);
  const notice = useDemo((s) => s.data.childNotice);
  return (
    <AnimatePresence>
      {alert ? <Card key={alert.id} alert={alert} /> : notice ? <GuardianNote key={notice.id} title={notice.title} body={notice.body} /> : null}
    </AnimatePresence>
  );
}

/** The guardian's check-in, delivered through RAKSHAK. The child answers with one tap. */
function GuardianNote({ title, body }: { title: string; body: string }) {
  const dispatch = useDemo((s) => s.dispatch);
  useEffect(() => buzz(1), []);
  return (
    <motion.div
      className="nudge nudge-note"
      initial={{ y: 60, opacity: 0, scale: 0.96 }}
      animate={{ y: 0, opacity: 1, scale: 1 }}
      exit={{ pointerEvents: 'none', y: 40, opacity: 0, scale: 0.97, transition: { duration: 0.22 } }}
      transition={{ type: 'spring', stiffness: 260, damping: 26 }}
    >
      <div className="nudge-body">
        <div className="nudge-head">
          <span className="nudge-brand">
            <MessageCircleHeart size={13} strokeWidth={2.6} /> {title.toUpperCase()}
          </span>
          <span className="nudge-private">via RAKSHAK</span>
          <button className="nudge-x" aria-label="Close" onClick={() => dispatch({ type: 'clearNotice', who: 'child' })}>
            <X size={14} strokeWidth={2.6} />
          </button>
        </div>
        <div className="nudge-text">{body}</div>
        <div className="nudge-actions">
          <button className="nudge-btn primary" onClick={() => replyToGuardian('Okay 💛')}>
            Okay 💛
          </button>
          <button className="nudge-btn" onClick={() => replyToGuardian('Can we talk now?')}>
            Talk now
          </button>
        </div>
      </div>
    </motion.div>
  );
}

function Card({ alert }: { alert: AlertItem }) {
  const dispatch = useDemo((s) => s.dispatch);
  const [done, setDone] = useState<string | null>(null);
  const cues = alert.cues.map((c) => c.cue as string);
  const base =
    alert.category === 'bullying'
      ? BULLYING_COPY[alert.level]
      : alert.level === 3
        ? COPY[3]
        : groomingCopy(alert.level, cues);
  // "Don't pay" only when a payment or threat was actually detected; otherwise the generic critical wording.
  const has = (cue: string) => alert.cues.some((c) => c.cue === cue);
  const copy =
    alert.level === 3 && alert.category !== 'bullying' && !has('threat_payment')
      ? { ...base, body: `This isn't your fault. Please don't delete anything. ${GUARDIAN.name} has been alerted.` }
      : base;

  useEffect(() => buzz(alert.level), [alert.id]); // eslint-disable-line react-hooks/exhaustive-deps

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
      exit={{ pointerEvents: 'none', y: 40, opacity: 0, scale: 0.97, transition: { duration: 0.22 } }}
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
            <motion.div key="done" className="nudge-done" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ pointerEvents: 'none', opacity: 0 }}>
              <HeartHandshake size={20} strokeWidth={2.2} />
              <span>{done}</span>
            </motion.div>
          ) : (
            <motion.div key="ask" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ pointerEvents: 'none', opacity: 0, y: -6 }}>
              <div className="nudge-title">{copy.title}</div>
              <div className="nudge-text">{copy.body}</div>
              <div className="nudge-actions">
                <button
                  className="nudge-btn primary"
                  onClick={() => {
                    // L3: an SOS to the guardian's phone. L1/L2: a calm "would like to talk" (no chat content is sent).
                    respond(alert.level === 3 ? 'child_sos' : 'child_help', alert.id);
                    setDone(alert.level === 3 ? `SOS sent. ${GUARDIAN.name}'s phone is ringing an alert now.` : `Sent. ${GUARDIAN.name} knows you'd like to talk.`);
                  }}
                >
                  {copy.primary}
                </button>
                <button
                  className="nudge-btn"
                  onClick={() => {
                    blockActiveContact();
                    setDone('Blocked. Their messages can no longer reach you. You did the right thing.');
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
