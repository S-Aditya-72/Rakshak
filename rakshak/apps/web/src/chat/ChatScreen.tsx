import { AnimatePresence, motion } from 'framer-motion';
import { ArrowUp, Ban, Check, ChevronDown, ChevronLeft, ChevronRight, HeartHandshake, Image as ImageIcon, Mic, Plus, ShieldCheck, SquarePen, UserRound, Users, Video, X } from 'lucide-react';
import { Fragment, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { RECONSTRUCTION_LABEL } from '../data/caseStudies';
import { GUARDIAN } from '../data/meta';
import { GALLERY, photoOf, type GalleryPhoto } from '../data/gallery';
import { canCompose } from '../lib/flow';
import { buzz, onBack } from '../lib/native';
import { playPing, playSend } from '../lib/sounds';
import { blockContact, childNameOf, createConversation, isBlocked, markRead, openConversation, respond, sendLive, typingLive, typingMs, useDemo } from '../store';
import type { ChatMessage, ConversationView, ParticipantView, Side } from '../types';
import { BareContext, StatusBar } from './PhoneFrame';

interface ChatScreenProps {
  side: Side;
  /** Overlays rendered above the composer (the victim's nudge card). */
  overlay?: ReactNode;
  /** A phone's own open chat. Without it the screen follows the shared one (the laptop's drawn phones). */
  convId?: string | null;
  onOpenConv?: (id: string) => void;
}

const SENDER_COLORS = ['#ff9f0a', '#30d158', '#bf5af2', '#ff375f', '#64d2ff', '#ffd60a'];
const initials = (name: string) => name.trim().slice(0, 1).toUpperCase() || '?';

export function ChatScreen({ side, overlay, convId, onOpenConv }: ChatScreenProps) {
  const bare = useContext(BareContext);
  const allMessages = useDemo((s) => s.data.messages);
  const sharedConv = useDemo((s) => s.data.activeConv);
  const activeConv = convId !== undefined ? convId : sharedConv;
  const conversations = useDemo((s) => s.data.conversations);
  const participants = useDemo((s) => s.data.participants);
  const childId = useDemo((s) => s.data.childId);
  const perspective = useDemo((s) => s.data.perspective);
  const mode = useDemo((s) => s.data.mode);
  const reads = useDemo((s) => s.data.reads);
  // Case-study reconstructions stay labelled on both phones; anything not in the script is a hypothetical continuation.
  const scenario = useDemo((s) => (s.data.origin === 'scripted' || s.data.origin === 'history' ? s.data.scenarios.find((x) => x.id === s.data.scenarioId && x.kind === 'case_study') : undefined));
  const scriptIds = useMemo(() => new Set(scenario?.messages.map((m) => m.id)), [scenario]);
  const other: Side = side === 'victim' ? 'predator' : 'victim';
  const otherTyping = useDemo((s) => s.data.typing[other]);
  const nudgeOpen = useDemo((s) => side === 'victim' && (s.data.victimNudge !== null || s.data.childNotice !== null));
  const scrollRef = useRef<HTMLDivElement>(null);
  const [inbox, setInbox] = useState(false);
  const [profile, setProfile] = useState(false);

  const conv = conversations.find((c) => c.id === activeConv) ?? null;
  const people = useMemo(() => Object.fromEntries(participants.map((p) => [p.id, p])), [participants]);
  // Whose phone this is: the child on the right, the selected sender on the left.
  const me = side === 'victim' ? childId : perspective;
  // A blocked contact's messages exist only on their own phone ("Not delivered"); the child never sees them.
  const messages = useMemo(() => allMessages.filter((m) => (m.conversationId ?? activeConv) === activeConv && !(m.undelivered && side === 'victim')), [allMessages, activeConv, side]);
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
  const lastSentId = [...messages].reverse().find((m) => m.kind === 'msg' && isMine(m) && !m.undelivered)?.id;
  const lastIncoming = [...messages].reverse().find((m) => m.kind === 'msg' && !isMine(m));
  const firstLiveId = scenario ? messages.find((m) => m.kind === 'msg' && !scriptIds.has(m.id))?.id : undefined;

  // A real phone: ping for incoming messages, whoosh for sent ones; and read receipts while this chat is on screen.
  const lastSeen = useRef<string | null>(null);
  useEffect(() => {
    const last = messages[messages.length - 1];
    if (!bare || !last || last.kind !== 'msg' || last.id === lastSeen.current) return;
    const first = lastSeen.current === null;
    lastSeen.current = last.id;
    if (first) return;
    if (isMine(last)) {
      if (!last.undelivered) playSend();
    } else {
      playPing();
      buzz(1);
    }
  }, [messages]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!bare || !activeConv || !lastIncoming) return;
    const mark = () => document.visibilityState === 'visible' && markRead(activeConv, side, lastIncoming.id);
    mark();
    document.addEventListener('visibilitychange', mark);
    return () => document.removeEventListener('visibilitychange', mark);
  }, [bare, activeConv, lastIncoming?.id, side]);
  const otherRead = activeConv ? reads[`${activeConv}:${other}`] : undefined;
  const readIdx = otherRead ? messages.findIndex((m) => m.id === otherRead.upto) : -1;
  const statusFor = (m: ChatMessage) => {
    const idx = messages.indexOf(m);
    return readIdx >= idx ? `Read ${otherRead!.time}` : 'Delivered';
  };

  const group = conv?.kind === 'group';
  const peerId = conv && !group ? conv.participantIds.find((p) => p !== me) : undefined;
  const title = conv ? (group ? conv.title : people[peerId ?? '']?.displayName ?? conv.title) : '…';
  const firstContact = side === 'victim' && !group && peerId && people[peerId]?.role === 'contact';

  // Android back: close what is open; a chat goes back to the chat list.
  useEffect(() => {
    if (!bare) return;
    return onBack(() => {
      if (profile) setProfile(false);
      else if (inbox) setInbox(false);
      else if (conversations.length > 1) setInbox(true);
      else return false;
      return true;
    });
  }, [bare, profile, inbox, conversations.length]);

  const openConv = (id: string) => (onOpenConv ? onOpenConv(id) : openConversation(id));

  return (
    <div className="chat">
      <StatusBar shield={side === 'victim'} />

      <div className="chat-header">
        <button className="glass glass-pill-btn" aria-label="All chats" onClick={() => setInbox(true)} disabled={conversations.length === 0}>
          <ChevronLeft size={22} strokeWidth={2.4} />
        </button>
        <button className="chat-peer" onClick={() => side === 'victim' && conv && setProfile(true)} aria-label="Contact info">
          <div className={`avatar ${group ? 'avatar-group' : ''}`}>{group ? <Users size={22} /> : initials(title)}</div>
          <div className="glass peer-name">
            {title}
            <ChevronRight size={12} strokeWidth={2.6} />
          </div>
        </button>
        <button className="glass glass-pill-btn" aria-label="FaceTime">
          <Video size={19} strokeWidth={2.2} />
        </button>
      </div>
      {side === 'victim' && (
        <div className="protected-bar">
          <ShieldCheck size={11} strokeWidth={2.8} /> Protected by RAKSHAK · on-device
        </div>
      )}

      <div className={`chat-scroll ${nudgeOpen ? 'has-overlay' : ''}`} ref={scrollRef}>
        <div className="chat-intro">
          <div className={`avatar avatar-lg ${group ? 'avatar-group' : ''}`}>{group ? <Users size={30} /> : initials(title)}</div>
          <div className="chat-intro-name">{title}</div>
          {group && conv && <div className="chat-intro-sub">{conv.participantIds.map((p) => (p === me ? 'You' : people[p]?.displayName ?? p)).join(', ')}</div>}
          {firstContact && <div className="chat-intro-sub">Not in your contacts</div>}
          {scenario && <div className="chat-intro-sub cs-bar">{RECONSTRUCTION_LABEL} · not an actual transcript</div>}
        </div>

        {messages.map((m, i) => (
          <Fragment key={m.id}>
          {m.id === firstLiveId && <div className="sys-row cs-live-sep">Hypothetical continuation · not part of the reconstruction</div>}
          <MessageRow
            m={m}
            mine={m.kind === 'msg' && isMine(m)}
            next={messages[i + 1]}
            prev={messages[i - 1]}
            status={m.id === lastSentId ? statusFor(m) : null}
            live={mode !== 'A'}
            senderName={group && m.kind === 'msg' && !isMine(m) ? people[m.senderId ?? '']?.displayName : undefined}
            senderColor={colorOf(m.senderId)}
          />
          </Fragment>
        ))}

        <AnimatePresence>
          {otherTyping && (
            <motion.div
              key="typing"
              className="row recv group-start"
              initial={{ opacity: 0, scale: 0.7, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ pointerEvents: 'none', opacity: 0, scale: 0.7 }}
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

      <Composer side={side} conv={conv} people={people} childId={childId} peerId={peerId} />

      <AnimatePresence>
        {inbox && (
          <Inbox
            side={side}
            me={me}
            onOpen={openConv}
            onClose={() => setInbox(false)}
          />
        )}
        {profile && conv && <ContactProfile conv={conv} peer={peerId ? people[peerId] : undefined} onClose={() => setProfile(false)} />}
      </AnimatePresence>
    </div>
  );
}

function MessageRow({
  m,
  mine,
  next,
  prev,
  status,
  live,
  senderName,
  senderColor,
}: {
  m: ChatMessage;
  mine: boolean;
  next?: ChatMessage;
  prev?: ChatMessage;
  status: string | null;
  live: boolean;
  senderName?: string;
  senderColor: string;
}) {
  if (m.kind === 'system') {
    return (
      <motion.div className="sys-row" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
        {m.text}
      </motion.div>
    );
  }
  if (m.kind === 'day') {
    const [day, weekday] = m.text.split(' · ');
    // Live chat happens now; the scripted cases span simulated days.
    return live ? (
      <div className="day-sep">
        <b>Today</b> {m.time}
      </div>
    ) : (
      <div className="day-sep">
        <b>{day}</b> · <b>{weekday}</b> {m.time}
      </div>
    );
  }
  const sameSender = (o?: ChatMessage) => o && o.kind === 'msg' && (o.senderId ?? o.from) === (m.senderId ?? m.from);
  const tail = !sameSender(next);
  const groupStart = !sameSender(prev);
  const photo = photoOf(m.image);

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
        {photo ? (
          <div className="photo-bubble" style={{ background: photo.bg }} aria-label={photo.label}>
            <span>{photo.emoji}</span>
          </div>
        ) : (
          <div className={`bubble ${mine ? 'sent' : 'recv'} ${tail ? 'tail' : ''}`}>{m.text}</div>
        )}
      </motion.div>
      {mine && m.undelivered ? (
        <motion.div className="msg-status undelivered" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.25 }}>
          Not delivered
        </motion.div>
      ) : (
        mine &&
        status && (
          <motion.div key={status} className="msg-status" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.25 }}>
            {status}
          </motion.div>
        )
      )}
    </>
  );
}

/** Scripted playback: the next line appears letter by letter in the sender's composer, like someone typing it. */
function useTypewriter(draft: string) {
  const speed = useDemo((s) => s.data.speed);
  const [shown, setShown] = useState('');
  useEffect(() => {
    if (!draft) return setShown('');
    const total = typingMs(draft) / speed;
    const start = performance.now();
    let raf = 0;
    const step = () => {
      const n = Math.min(draft.length, Math.ceil(((performance.now() - start) / total) * draft.length));
      setShown(draft.slice(0, n));
      if (n < draft.length) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [draft, speed]);
  return shown;
}

/** Should RAKSHAK pause a photo before it goes to this chat? Yes when the contact is already flagged. */
function photoNeedsPause(peerId: string | undefined): boolean {
  if (!peerId) return false;
  const d = useDemo.getState().data;
  if (d.participants.find((p) => p.id === peerId)?.role !== 'contact') return false;
  const track = d.risk?.tracks.find((t) => t.contactId === peerId);
  return (track?.level ?? 0) >= 1 || d.alerts.some((a) => a.contactId === peerId) || d.evidence.some((e) => e.senderId === peerId && (e.cue === 'image_request' || e.cue === 'secrecy') && e.status !== 'superseded');
}

function Composer({ side, conv, people, childId, peerId }: { side: Side; conv: ConversationView | null; people: Record<string, ParticipantView>; childId: string; peerId?: string }) {
  const bare = useContext(BareContext);
  const mode = useDemo((s) => s.data.mode);
  const composable = useDemo((s) => canCompose(s.data.mode, s.data.origin, s.data.historyInit));
  const settingUp = useDemo((s) => s.data.historyInit.status === 'loading' || s.data.historyInit.status === 'analyzing');
  const perspective = useDemo((s) => s.data.perspective);
  const draft = useDemo((s) => (s.data.typing[side] ? s.data.drafts[side] : ''));
  const dispatch = useDemo((s) => s.dispatch);
  const [text, setText] = useState('');
  const [picker, setPicker] = useState(false);
  const [gallery, setGallery] = useState(false);
  const [pending, setPending] = useState<GalleryPhoto | null>(null);
  const typed = useTypewriter(draft);
  const live = composable && !!conv;
  const others = conv ? conv.participantIds.filter((p) => p !== childId) : [];
  const showPicker = side === 'predator' && others.length > 1;

  const send = () => {
    const t = text.trim();
    if (!t || !conv) return;
    void sendLive(side, t, conv.id);
    setText('');
  };

  const sendPhoto = (p: GalleryPhoto) => {
    setGallery(false);
    if (!conv) return;
    if (side === 'victim' && p.personal && photoNeedsPause(peerId)) return setPending(p);
    void sendLive(side, '📷 Photo', conv.id, p.key);
  };

  return (
    <div className="composer">
      <AnimatePresence>
        {showPicker && picker && (
          <motion.div className="sender-menu glass" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ pointerEvents: 'none', opacity: 0, y: 6 }}>
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
        <button className="glass sender-pill" onClick={() => setPicker((v) => !v)} aria-label="Choose who is typing" disabled={!composable}>
          {people[perspective ?? '']?.displayName ?? 'Sender'} <ChevronDown size={13} />
        </button>
      ) : (
        <button className="glass glass-circle" aria-label="Photos" disabled={!live} onClick={() => setGallery(true)}>
          <Plus size={20} strokeWidth={2.2} />
        </button>
      )}
      <div className="glass composer-pill">
        <input
          value={draft ? typed : text}
          disabled={!live}
          onChange={(e) => {
            setText(e.target.value);
            if (e.target.value) typingLive(side);
          }}
          onKeyDown={(e) => e.key === 'Enter' && send()}
          placeholder={live ? (bare ? 'Message' : 'iMessage') : settingUp ? 'Setting up history…' : composable ? 'Open a chat…' : mode === 'A' ? (bare ? 'Demo playing…' : 'AI simulation running…') : bare ? 'Waiting for the laptop to start a chat…' : 'Use the Studio panel to start'}
        />
        <AnimatePresence mode="wait" initial={false}>
          {text.trim() && live ? (
            <motion.button
              key="send"
              className="send-btn"
              onClick={send}
              initial={{ scale: 0.4, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ pointerEvents: 'none', scale: 0.4, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 600, damping: 28 }}
              aria-label="Send"
            >
              <ArrowUp size={17} strokeWidth={3} />
            </motion.button>
          ) : (
            <motion.span key="mic" className="mic" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ pointerEvents: 'none', opacity: 0 }}>
              <Mic size={18} strokeWidth={2.2} />
            </motion.span>
          )}
        </AnimatePresence>
      </div>
      <AnimatePresence>
        {gallery && <Gallery onPick={sendPhoto} onClose={() => setGallery(false)} />}
        {pending && conv && (
          <PhotoPause
            name={people[peerId ?? '']?.displayName ?? 'this person'}
            onKeep={() => {
              respond('child_photo_held');
              setPending(null);
            }}
            onTalk={() => {
              respond('child_photo_held');
              respond('child_help');
              setPending(null);
            }}
            onSend={() => {
              void sendLive(side, '📷 Photo', conv.id, pending.key);
              respond('child_photo_sent');
              setPending(null);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

/** Demo photo picker (illustrations, not the phone's real photos). */
function Gallery({ onPick, onClose }: { onPick: (p: GalleryPhoto) => void; onClose: () => void }) {
  return (
    <motion.div className="gallery" initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ pointerEvents: 'none', y: '100%' }} transition={{ type: 'spring', stiffness: 320, damping: 34 }}>
      <div className="gallery-head">
        <span>
          <ImageIcon size={15} /> Recents
        </span>
        <button onClick={onClose} aria-label="Close">
          <X size={16} />
        </button>
      </div>
      <div className="gallery-grid">
        {GALLERY.map((p) => (
          <button key={p.key} className="gallery-tile" style={{ background: p.bg }} onClick={() => onPick(p)} aria-label={p.label}>
            <span>{p.emoji}</span>
          </button>
        ))}
      </div>
      <div className="gallery-note">Demo gallery · illustrations, not your real photos</div>
    </motion.div>
  );
}

/** RAKSHAK steps in before a photo reaches a flagged contact. Calm, never blaming; the child decides. */
function PhotoPause({ name, onKeep, onTalk, onSend }: { name: string; onKeep: () => void; onTalk: () => void; onSend: () => void }) {
  return (
    <motion.div className="pause-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ pointerEvents: 'none', opacity: 0 }}>
      <motion.div className="pause-card" initial={{ y: 40, scale: 0.96 }} animate={{ y: 0, scale: 1 }} transition={{ type: 'spring', stiffness: 300, damping: 26 }}>
        <div className="pause-brand">
          <ShieldCheck size={13} strokeWidth={2.6} /> RAKSHAK · private to you
        </div>
        <div className="pause-title">Pause before you send 💛</div>
        <p className="pause-text">
          {name} asked you to keep your chats secret. Once a photo is sent you can't take it back: it can be saved, shown to others or used to pressure you.
        </p>
        <button className="pause-btn primary" onClick={onKeep}>
          Don't send
        </button>
        <button className="pause-btn" onClick={onTalk}>
          <HeartHandshake size={15} /> Talk to {GUARDIAN.name} first
        </button>
        <button className="pause-btn ghost" onClick={onSend}>
          Send anyway
        </button>
      </motion.div>
    </motion.div>
  );
}

/** Who is this? Seen from the child's phone: a new contact looks new. (Synthetic account details.) */
function ContactProfile({ conv, peer, onClose }: { conv: ConversationView; peer?: ParticipantView; onClose: () => void }) {
  const firstSeen = useDemo((s) => (peer ? s.data.firstSeen[peer.id] : undefined));
  const messages = useDemo((s) => s.data.messages);
  const conversations = useDemo((s) => s.data.conversations);
  const blocked = useDemo((s) => !!peer && s.data.blocks.some((b) => b.contactId === peer.id));
  const group = conv.kind === 'group';
  const firstDay = messages.find((m) => m.kind === 'msg' && m.conversationId === conv.id)?.day;
  const shared = peer ? conversations.filter((c) => c.participantIds.includes(peer.id)).length : 0;
  const stranger = peer?.role === 'contact';
  const name = group ? conv.title : peer?.displayName ?? conv.title;

  return (
    <motion.div className="profile" initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ pointerEvents: 'none', y: '100%' }} transition={{ type: 'spring', stiffness: 320, damping: 34 }}>
      <div className="inbox-head">
        <button className="inbox-link" onClick={onClose}>
          <ChevronLeft size={18} /> Back
        </button>
      </div>
      <div className="profile-top">
        <div className={`avatar avatar-lg ${group ? 'avatar-group' : ''}`}>{group ? <Users size={30} /> : initials(name)}</div>
        <div className="profile-name">{name}</div>
        {stranger && <div className="profile-flag">Not in your contacts</div>}
      </div>
      <div className="profile-rows">
        {group ? (
          <div className="profile-row">
            <Users size={15} /> {conv.participantIds.length} members
          </div>
        ) : stranger ? (
          <>
            <div className="profile-row">
              <UserRound size={15} /> Account created 3 days ago
            </div>
            <div className="profile-row">
              <Users size={15} /> No mutual friends
            </div>
            <div className="profile-row">
              <ChevronRight size={15} /> First messaged you on Day {firstSeen ?? firstDay ?? 1}
            </div>
          </>
        ) : (
          <>
            <div className="profile-row">
              <Users size={15} /> Classmate · in {shared} {shared === 1 ? 'chat' : 'chats'} with you
            </div>
          </>
        )}
      </div>
      {!group && peer && (
        <div className="profile-actions">
          <button className="profile-btn danger" disabled={blocked || isBlocked(peer.id)} onClick={() => blockContact(peer.id, 'child')}>
            <Ban size={15} /> {blocked ? 'Blocked' : `Block ${peer.displayName}`}
          </button>
          <button className="profile-btn" onClick={() => respond('child_help')}>
            <HeartHandshake size={15} /> Tell {GUARDIAN.name} something feels wrong
          </button>
        </div>
      )}
      <div className="gallery-note">Account details are synthetic, for the demo.</div>
    </motion.div>
  );
}

/** iMessage-style conversation list inside the phone. Mode B can also start new private or group chats. */
function Inbox({ side, me, onOpen, onClose }: { side: Side; me: string | null; onOpen: (id: string) => void; onClose: () => void }) {
  const conversations = useDemo((s) => s.data.conversations);
  const messages = useDemo((s) => s.data.messages);
  const participants = useDemo((s) => s.data.participants);
  const childId = useDemo((s) => s.data.childId);
  const active = useDemo((s) => s.data.activeConv);
  const composable = useDemo((s) => canCompose(s.data.mode, s.data.origin, s.data.historyInit));
  const [composing, setComposing] = useState(false);
  const people = Object.fromEntries(participants.map((p) => [p.id, p]));
  // The contact phone only lists chats its current sender is in; the child sees all of the child's chats.
  const visible = conversations.filter((c) => side === 'victim' || !me || c.participantIds.includes(me));

  return (
    <motion.div className="inbox" initial={{ x: '-100%' }} animate={{ x: 0 }} exit={{ pointerEvents: 'none', x: '-100%' }} transition={{ type: 'spring', stiffness: 380, damping: 38 }}>
      <div className="inbox-head">
        <button className="inbox-link" onClick={onClose}>
          <ChevronLeft size={18} /> Back
        </button>
        {composable && side === 'victim' && (
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
                onOpen(c.id);
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
  const childName = useDemo((s) => childNameOf(s.data));
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
    <motion.div className="newchat" initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ pointerEvents: 'none', y: '100%' }} transition={{ type: 'spring', stiffness: 300, damping: 32 }}>
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
        <div className="newchat-k">People already in {childName}'s chats</div>
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
