import { ShieldCheck } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useSync } from '../lib/sync';
import { PREVIEW_ID, useDemo } from '../store';

/** A phone's connection state, floating under Android's status bar. Hidden while live, like a real app. Tap to fix. */
export function SyncPill() {
  const sync = useSync();
  const preview = useDemo((s) => s.data.scenarioId === PREVIEW_ID);
  const navigate = useNavigate();

  const [tone, text] = preview
    ? ['info', 'Presentation preview · not live AI']
    : sync.state === 'live'
      ? [null, '']
      : sync.state === 'connecting'
        ? ['warn', 'Connecting to RAKSHAK…']
        : sync.state === 'unauthorized'
          ? ['bad', 'Wrong access code · tap to fix']
          : sync.state === 'ended'
            ? ['bad', 'Temporary access ended']
            : ['bad', 'No connection · tap to fix'];
  if (!tone) return null;

  return (
    <button className={`sync-pill floating ${tone}`} onClick={() => navigate('/app')}>
      <ShieldCheck size={12} strokeWidth={2.6} />
      <span className="sync-dot" />
      {text}
    </button>
  );
}
