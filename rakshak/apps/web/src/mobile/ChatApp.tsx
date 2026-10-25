import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { NudgeCard } from '../alerts/NudgeCard';
import { ChatScreen } from '../chat/ChatScreen';
import { BareContext, PhoneFrame } from '../chat/PhoneFrame';
import { setBarStyle } from '../lib/native';
import { useDemo } from '../store';

/**
 * The messenger on the child's and the contact's phones. Meera's is protected by RAKSHAK (nudges, photo pause);
 * Kabir's is a plain messenger: nothing on it says RAKSHAK exists. Each phone keeps its own open chat.
 */
export function ChatApp({ role, offline }: { role: 'child' | 'contact'; offline: boolean }) {
  const navigate = useNavigate();
  const shared = useDemo((s) => s.data.activeConv);
  const playing = useDemo((s) => s.data.playing);
  const banner = useDemo((s) => s.data.guardianBanner);
  const critical = useDemo((s) => s.data.critical);
  const [conv, setConv] = useState<string | null>(shared);
  // The open chat is gone when the laptop replaced the case (new conversation, a loaded history, a scenario).
  const gone = useDemo((s) => !!conv && !s.data.conversations.some((c) => c.id === conv));
  const child = role === 'child';

  // Follow the shared chat when the laptop moves the story (scripted playback, a new case); otherwise stay put.
  useEffect(() => {
    if (shared && (playing || !conv || gone)) setConv(shared);
  }, [shared, playing, gone]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => setBarStyle(child ? 'light' : 'dark', child ? '#FFFFFF' : '#000000'), [child]);

  // In the offline demo one phone plays both parts: when the guardian is alerted, it becomes the guardian's phone.
  useEffect(() => {
    if (offline && child && (banner || critical)) {
      const t = setTimeout(() => navigate('/m/guardian?offline=1'), 2400);
      return () => clearTimeout(t);
    }
  }, [offline, child, banner?.id, critical?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <BareContext.Provider value={true}>
      <div className="mrole-screen">
        <PhoneFrame theme={child ? 'light' : 'dark'}>
          <ChatScreen side={child ? 'victim' : 'predator'} convId={conv} onOpenConv={setConv} overlay={child ? <NudgeCard /> : undefined} />
        </PhoneFrame>
      </div>
    </BareContext.Provider>
  );
}
