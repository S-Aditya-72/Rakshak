import { Link } from 'react-router-dom';
import { ChevronLeft, ShieldCheck } from 'lucide-react';
import { GetHelp } from '../alerts/GetHelp';
import { GuardianPhone } from '../alerts/GuardianPhone';
import { NudgeCard } from '../alerts/NudgeCard';
import { ChatScreen } from '../chat/ChatScreen';
import { PhoneFrame } from '../chat/PhoneFrame';
import { CaseCard, DebugFeed, EvidencePanel, ModelsPanel, ScoreChart } from '../console/Analytics';
import { usePhoneScale } from '../lib/hooks';

/** Pop-out window: guardian phone + engine panels. Controlled from the simulation window. */
export function ConsolePage() {
  usePhoneScale(1, 640, 90);
  return (
    <div className="sim">
      <div className="sim-bg" aria-hidden />
      <header className="sim-top">
        <Link to="/sim" className="sim-back">
          <ChevronLeft size={18} />
          <span className="brand-mark sm">
            <ShieldCheck size={14} strokeWidth={2.6} />
          </span>
          RAKSHAK
        </Link>
        <div className="sim-title">
          Guardian & engine<span className="sim-title-sub">synced window</span>
        </div>
        <span className="sim-note">mirrors the main window</span>
      </header>
      <main className="console-main">
        <GuardianPhone />
        <aside className="console-panels">
          <CaseCard />
          <ScoreChart />
          <DebugFeed />
          <EvidencePanel />
          <ModelsPanel />
        </aside>
      </main>
      <GetHelp />
    </div>
  );
}

export function SinglePhonePage({ side }: { side: 'predator' | 'victim' }) {
  usePhoneScale(1, 0, 60);
  return (
    <div className="single">
      {side === 'predator' ? (
        <PhoneFrame theme="dark">
          <ChatScreen side="predator" />
        </PhoneFrame>
      ) : (
        <PhoneFrame theme="light">
          <ChatScreen side="victim" overlay={<NudgeCard />} />
        </PhoneFrame>
      )}
    </div>
  );
}
