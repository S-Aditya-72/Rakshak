import { AnimatePresence, motion } from 'framer-motion';
import { ArrowUp, Check, ChevronDown, ChevronLeft, ChevronRight, Mic, Plus, SquarePen, Users, Video, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createConversation, openConversation, sendLive, useDemo } from '../store';
import type { ChatMessage, ConversationView, ParticipantView, Side } from '../types';
import { StatusBar } from './PhoneFrame';

interface ChatScreenProps {
  side: Side;
  /** Overlays rendered above the composer (the victim's nudge card). */
  overlay?: ReactNode;
}

const SENDER_COLORS = ['#ff9f0a', '#30d158', '#bf5af2', '#ff375f', '#64d2ff', '#ffd60a'];
const initials = (name: string) => name.trim().slice(0, 1).toUpperCase() || '?';

export function ChatScreen({ side, overlay }: ChatScreenProps) {
  const allMessages = useDemo((s) => s.data.messages);
  const activeConv = useDemo((s) => s.data.activeConv);
  const conversations = useDemo((s) => s.data.conversations);
  const participants = useDemo((s) => s.data.participants);
  const childId = useDemo((s) => s.data.childId);
  const perspective = useDemo((s) => s.data.perspective);
  const other: Side = side === 'victim' ? 'predator' : 'victim';
  const otherTyping = useDemo((s) => s.data.typing[other]);
  const nudgeOpen = useDemo((s) => side === 'victim' && s.data.victimNudge !== null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [inbox, setInbox] = useState(false);

  const conv = conversations.find((c) => c.id === activeConv) ?? null;
  const people = useMemo(() => Object.fromEntries(participants.map((p) => [p.id, p])), [participants]);
  // Whose phone this is: the child on the right, the selected sender on the left.
  const me = side === 'victim' ? childId : perspective;
  const messages = useMemo(() => allMessages.filter((m) => (m.conversationId ?? activeConv) === activeConv), [allMessages, activeConv]);
  const colorOf = useMemo(() => {
    const ids = conv?.participantIds ?? [];
    return (id?: string) => SENDER_COLORS[Math.max(0, ids.indexOf(id ?? '')) % SENDER_COLORS.length];
  }, [conv]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    // Wait a frame so the new row is laid out, then pin to the bottom.
    const id = requestAnimationFrame(() => el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' }));
    return () => cancelAnimationFrame(id);
  }, [messages.length, otherTyping, nudgeOpen, activeConv]);

  const isMine = (m: ChatMessage) => (m.senderId ? m.senderId === me : m.from === side);
  const lastSentId = [...messages].reverse().find((m) => m.kind === 'msg' && isMine(m))?.id;

  const group = conv?.kind === 'group';
  const peerId = conv && !group ? conv.participantIds.find((p) => p !== me) : undefined;
  const title = conv ? (group ? conv.title : people[peerId ?? '']?.displayName ?? conv.title) : '…';
  const firstContact = side === 'victim' && !group && peerId && people[peerId]?.role === 'contact';

  return (
    <div className="chat">
      <StatusBar shield={side === 'victim'} />

      <div className="chat-header">
        <button className="glass glass-pill-btn" aria-label="All chats" onClick={() => setInbox(true)} disabled={conversations.length === 0}>
          <ChevronLeft size={22} strokeWidth={2.4} />
        </button>
        <div className="chat-peer">
          <div className={`avatar ${group ? 'avatar-group' : ''}`}>{group ? <Users size={22} /> : initials(title)}</div>
          <div className="glass peer-name">
            {title}
            <ChevronRight size={12} strokeWidth={2.6} />
          </div>
        </div>
        <button className="glass glass-pill-btn" aria-label="FaceTime">
          <Video size={19} strokeWidth={2.2} />
        </button>
      </div>

      <div className={`chat-scroll ${nudgeOpen ? 'has-overlay' : ''}`} ref={scrollRef}>
        <div className="chat-intro">
          <div className={`avatar avatar-lg ${group ? 'avatar-group' : ''}`}>{group ? <Users size={30} /> : initials(title)}</div>
          <div className="chat-intro-name">{title}</div>
          {group && conv && <div className="chat-intro-sub">{conv.participantIds.map((p) => (p === me ? 'You' : people[p]?.displayName ?? p)).join(', ')}</div>}
          {firstContact && <div className="chat-intro-sub">Not in your contacts</div>}
        </div>

        {messages.map((m, i) => (
          <MessageRow
            key={m.id}
            m={m}
            mine={m.kind === 'msg' && isMine(m)}
            next={messages[i + 1]}
            prev={messages[i - 1]}
            showStatus={m.id === lastSentId}
            senderName={group && m.kind === 'msg' && !isMine(m) ? people[m.senderId ?? '']?.displayName : undefined}
            senderColor={colorOf(m.senderId)}
          />
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

      <Composer side={side} conv={conv} people={people} childId={childId} />

      <AnimatePresence>{inbox && <Inbox side={side} me={me} onClose={() => setInbox(false)} />}</AnimatePresence>
    </div>
  );
}

function MessageRow({
  m,
  mine,
  next,
  prev,
  showStatus,
  senderName,
  senderColor,
}: {
  m: ChatMessage;
  mine: boolean;
  next?: ChatMessage;
  prev?: ChatMessage;
  showStatus: boolean;
  senderName?: string;
  senderColor: string;
}) {
  if (m.kind === 'day') {
    const [day, weekday] = m.text.split(' · ');
    return (
      <div className="day-sep">
        <b>{day}</b> · <b>{weekday}</b> {m.time}
      </div>
    );
  }
  const sameSender = (o?: ChatMessage) => o && o.kind === 'msg' && (o.senderId ?? o.from) === (m.senderId ?? m.from);
  const tail = !sameSender(next);
  const groupStart = !sameSender(prev);

  return (
    <>
      {senderName && groupStart && (
        <div className="sender-name" style={{ color: senderColor }}>
          {senderName}
        </div>
      )}
      <motion.div
        className={`row ${mine ? 'sent' : 'recv'} ${groupStart && !senderName ? 'group-start' : ''}`}
        initial={{ opacity: 0, scale: 0.6, y: 14 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        style={{ originX: mine ? 1 : 0, originY: 1 }}
        transition={{ type: 'spring', stiffness: 520, damping: 32, mass: 0.8 }}
      >
        <div className={`bubble ${mine ? 'sent' : 'recv'} ${tail ? 'tail' : ''}`}>{m.text}</div>
      </motion.div>
      {mine && showStatus && (
        <motion.div className="msg-status" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.25 }}>
          Delivered
        </motion.div>
      )}
    </>
  );
}

function Composer({ side, conv, people, childId }: { side: Side; conv: ConversationView | null; people: Record<string, ParticipantView>; childId: string }) {
  const mode = useDemo((s) => s.data.mode);
  const perspective = useDemo((s) => s.data.perspective);
  const dispatch = useDemo((s) => s.dispatch);
  const [text, setText] = useState('');
  const [picker, setPicker] = useState(false);
  const live = mode === 'B' && !!conv;
  const others = conv ? conv.participantIds.filter((p) => p !== childId) : [];
  const showPicker = side === 'predator' && others.length > 1;

  const send = () => {
    const t = text.trim();
    if (!t) return;
    void sendLive(side, t);
    setText('');
  };

  return (
    <div className="composer">
      <AnimatePresence>
        {showPicker && picker && (
          <motion.div className="sender-menu glass" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }}>
            {others.map((p) => (
              <button
                key={p}
                className={`sender-opt ${p === perspective ? 'on' : ''}`}
                onClick={() => {
                  dispatch({ type: 'setPerspective', id: p });
                  setPicker(false);
                }}
              >
                {people[p]?.displayName ?? p} {p === perspective && <Check size={13} />}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
      {showPicker ? (
        <button className="glass sender-pill" onClick={() => setPicker((v) => !v)} aria-label="Choose who is typing" disabled={mode !== 'B'}>
          {people[perspective ?? '']?.displayName ?? 'Sender'} <ChevronDown size={13} />
        </button>
      ) : (
        <button className="glass glass-circle" aria-label="Apps" disabled={!live}>
          <Plus size={20} strokeWidth={2.2} />
        </button>
      )}
      <div className="glass composer-pill">
        <input
          value={text}
          disabled={!live}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
          placeholder={live ? 'iMessage' : mode === 'B' ? 'Open a chat…' : 'AI simulation running…'}
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

/** iMessage-style conversation list inside the phone. Mode B can also start new private or group chats. */
function Inbox({ side, me, onClose }: { side: Side; me: string | null; onClose: () => void }) {
  const conversations = useDemo((s) => s.data.conversations);
  const messages = useDemo((s) => s.data.messages);
  const participants = useDemo((s) => s.data.participants);
  const childId = useDemo((s) => s.data.childId);
  const active = useDemo((s) => s.data.activeConv);
  const mode = useDemo((s) => s.data.mode);
  const [composing, setComposing] = useState(false);
  const people = Object.fromEntries(participants.map((p) => [p.id, p]));
  // The contact phone only lists chats its current sender is in; the child sees all of the child's chats.
  const visible = conversations.filter((c) => side === 'victim' || !me || c.participantIds.includes(me));

  return (
    <motion.div className="inbox" initial={{ x: '-100%' }} animate={{ x: 0 }} exit={{ x: '-100%' }} transition={{ type: 'spring', stiffness: 380, damping: 38 }}>
      <div className="inbox-head">
        <button className="inbox-link" onClick={onClose}>
          <ChevronLeft size={18} /> Back
        </button>
        {mode === 'B' && side === 'victim' && (
          <button className="inbox-link" onClick={() => setComposing(true)} aria-label="New chat">
            <SquarePen size={18} />
          </button>
        )}
      </div>
      <div className="inbox-title">Messages</div>
      <div className="inbox-list">
        {visible.length === 0 && <div className="inbox-empty">No chats yet</div>}
        {visible.map((c) => {
          const last = [...messages].reverse().find((m) => m.kind === 'msg' && m.conversationId === c.id);
          const peer = c.kind === 'private' ? people[c.participantIds.find((p) => p !== childId) ?? ''] : undefined;
          const name = c.kind === 'group' ? c.title : peer?.displayName ?? c.title;
          return (
            <button
              key={c.id}
              className={`inbox-row ${c.id === active ? 'on' : ''}`}
              onClick={() => {
                openConversation(c.id);
                onClose();
              }}
            >
              <div className={`avatar inbox-avatar ${c.kind === 'group' ? 'avatar-group' : ''}`}>{c.kind === 'group' ? <Users size={18} /> : initials(name)}</div>
              <div className="inbox-text">
                <div className="inbox-name">
                  <span>{name}</span>
                  <span className="inbox-time">{last ? `D${last.day} ${last.time}` : ''}</span>
                </div>
                <div className="inbox-last">{last ? `${last.senderId === childId ? 'You: ' : c.kind === 'group' ? `${people[last.senderId ?? '']?.displayName ?? ''}: ` : ''}${last.text}` : c.kind === 'group' ? `${c.participantIds.length} members` : 'No messages yet'}</div>
              </div>
            </button>
          );
        })}
      </div>
      <AnimatePresence>{composing && <NewChat onDone={() => { setComposing(false); onClose(); }} onCancel={() => setComposing(false)} />}</AnimatePresence>
    </motion.div>
  );
}

function NewChat({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const participants = useDemo((s) => s.data.participants);
  const childId = useDemo((s) => s.data.childId);
  const [kind, setKind] = useState<'private' | 'group'>('private');
  const [title, setTitle] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [names, setNames] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const known = participants.filter((p) => p.id !== childId);
  const newNames = names
    .split(',')
    .map((n) => n.trim())
    .filter(Boolean);
  const count = picked.length + newNames.length;
  const valid = kind === 'private' ? count === 1 : count >= 2 && title.trim().length > 0;

  const create = async () => {
    setBusy(true);
    setErr(null);
    try {
      const t = kind === 'private' ? newNames[0] ?? known.find((p) => p.id === picked[0])?.displayName ?? 'Chat' : title.trim();
      await createConversation(kind, t, picked, newNames);
      onDone();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <motion.div className="newchat" initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={{ type: 'spring', stiffness: 300, damping: 32 }}>
      <div className="inbox-head">
        <button className="inbox-link" onClick={onCancel}>
          <X size={17} /> Cancel
        </button>
        <button className="inbox-link strong" disabled={!valid || busy} onClick={create}>
          {busy ? 'Creating…' : 'Create'}
        </button>
      </div>
      <div className="newchat-body">
        <div className="newchat-seg">
          {(['private', 'group'] as const).map((k) => (
            <button key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>
              {k === 'private' ? 'Private chat' : 'Group chat'}
            </button>
          ))}
        </div>
        {kind === 'group' && <input className="newchat-input" placeholder="Group name" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={40} />}
        <div className="newchat-k">People already in Meera's chats</div>
        <div className="newchat-people">
          {known.length === 0 && <span className="inbox-empty">None yet</span>}
          {known.map((p) => (
            <button
              key={p.id}
              className={`newchat-person ${picked.includes(p.id) ? 'on' : ''}`}
              onClick={() => setPicked((v) => (v.includes(p.id) ? v.filter((x) => x !== p.id) : kind === 'private' ? [p.id] : [...v, p.id]))}
            >
              {p.displayName}
            </button>
          ))}
        </div>
        <div className="newchat-k">New people (comma separated, synthetic names)</div>
        <input className="newchat-input" placeholder={kind === 'private' ? 'e.g. Rohan' : 'e.g. Rohan, Isha'} value={names} onChange={(e) => setNames(e.target.value)} maxLength={120} />
        <div className="newchat-hint">{kind === 'private' ? 'Pick exactly one person.' : 'Pick at least two people.'} Each person gets a stable ID; RAKSHAK never assumes two accounts are the same person.</div>
        {err && <div className="newchat-err">{err}</div>}
      </div>
    </motion.div>
  );
}
