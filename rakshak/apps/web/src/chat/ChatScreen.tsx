import { AnimatePresence, motion } from 'framer-motion';
import { ArrowUp, ChevronLeft, ChevronRight, Mic, Plus, Video } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CHILD, CONTACT } from '../data/meta';
import { sendLive, useDemo } from '../store';
import type { ChatMessage, Side } from '../types';
import { StatusBar } from './PhoneFrame';

interface ChatScreenProps {
  side: Side;
  /** Overlays rendered above the composer (the victim's nudge card). */
  overlay?: ReactNode;
}

export function ChatScreen({ side, overlay }: ChatScreenProps) {
  const messages = useDemo((s) => s.data.messages);
  const other: Side = side === 'victim' ? 'predator' : 'victim';
  const otherTyping = useDemo((s) => s.data.typing[other]);
  const nudgeOpen = useDemo((s) => side === 'victim' && s.data.victimNudge !== null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const peer = side === 'victim' ? CONTACT : CHILD;

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    // Wait a frame so the new row is laid out, then pin to the bottom.
    const id = requestAnimationFrame(() => el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' }));
    return () => cancelAnimationFrame(id);
  }, [messages.length, otherTyping, nudgeOpen]);

  const lastSentId = [...messages].reverse().find((m) => m.kind === 'msg' && m.from === side)?.id;

  return (
    <div className="chat">
      <StatusBar shield={side === 'victim'} />

      <div className="chat-header">
        <button className="glass glass-pill-btn" aria-label="Back">
          <ChevronLeft size={22} strokeWidth={2.4} />
        </button>
        <div className="chat-peer">
          <div className="avatar">{peer.initials}</div>
          <div className="glass peer-name">
            {peer.name}
            <ChevronRight size={12} strokeWidth={2.6} />
          </div>
        </div>
        <button className="glass glass-pill-btn" aria-label="FaceTime">
          <Video size={19} strokeWidth={2.2} />
        </button>
      </div>

      <div className={`chat-scroll ${nudgeOpen ? 'has-overlay' : ''}`} ref={scrollRef}>
        <div className="chat-intro">
          <div className="avatar avatar-lg">{peer.initials}</div>
          <div className="chat-intro-name">{peer.name}</div>
          {side === 'victim' && <div className="chat-intro-sub">Not in your contacts</div>}
        </div>

        {messages.map((m, i) => (
          <MessageRow key={m.id} m={m} side={side} next={messages[i + 1]} prev={messages[i - 1]} showStatus={m.id === lastSentId} />
        ))}

        <AnimatePresence>
          {otherTyping && (
            <motion.div
              key="typing"
              className="row recv group-start"
              initial={{ opacity: 0, scale: 0.7, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.7 }}
              style={{ originX: 0, originY: 1 }}
              transition={{ type: 'spring', stiffness: 500, damping: 30 }}
            >
              <div className="bubble recv tail typing">
                <span />
                <span />
                <span />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {overlay}

      <Composer side={side} />
    </div>
  );
}

function MessageRow({ m, side, next, prev, showStatus }: { m: ChatMessage; side: Side; next?: ChatMessage; prev?: ChatMessage; showStatus: boolean }) {
  if (m.kind === 'day') {
    const [day, weekday] = m.text.split(' · ');
    return (
      <div className="day-sep">
        <b>{day}</b> · <b>{weekday}</b> {m.time}
      </div>
    );
  }
  const sent = m.from === side;
  const tail = !next || next.kind !== 'msg' || next.from !== m.from;
  const groupStart = !prev || prev.kind !== 'msg' || prev.from !== m.from;

  return (
    <>
      <motion.div
        className={`row ${sent ? 'sent' : 'recv'} ${groupStart ? 'group-start' : ''}`}
        initial={{ opacity: 0, scale: 0.6, y: 14 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        style={{ originX: sent ? 1 : 0, originY: 1 }}
        transition={{ type: 'spring', stiffness: 520, damping: 32, mass: 0.8 }}
      >
        <div className={`bubble ${sent ? 'sent' : 'recv'} ${tail ? 'tail' : ''}`}>{m.text}</div>
      </motion.div>
      {sent && showStatus && (
        <motion.div className="msg-status" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.25 }}>
          Delivered
        </motion.div>
      )}
    </>
  );
}

function Composer({ side }: { side: Side }) {
  const mode = useDemo((s) => s.data.mode);
  const [text, setText] = useState('');
  const live = mode === 'B';

  const send = () => {
    const t = text.trim();
    if (!t) return;
    sendLive(side, t);
    setText('');
  };

  return (
    <div className="composer">
      <button className="glass glass-circle" aria-label="Apps" disabled={!live}>
        <Plus size={20} strokeWidth={2.2} />
      </button>
      <div className="glass composer-pill">
        <input
          value={text}
          disabled={!live}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
          placeholder={live ? 'iMessage' : 'AI simulation running…'}
        />
        <AnimatePresence mode="wait" initial={false}>
          {text.trim() ? (
            <motion.button
              key="send"
              className="send-btn"
              onClick={send}
              initial={{ scale: 0.4, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.4, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 600, damping: 28 }}
              aria-label="Send"
            >
              <ArrowUp size={17} strokeWidth={3} />
            </motion.button>
          ) : (
            <motion.span key="mic" className="mic" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <Mic size={18} strokeWidth={2.2} />
            </motion.span>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
