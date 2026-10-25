import { AnimatePresence, motion } from 'framer-motion';
import { BellRing, ChevronRight, Keyboard, MessageCircle, PlayCircle, QrCode, ShieldCheck, UserRound, Users } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { ServerSettings } from '../console/ServerSettings';
import { CHILD, GUARDIAN } from '../data/meta';
import { api, setServer } from '../lib/api';
import { setActiveRole, setDevice, useDevice, type DeviceRole } from '../lib/device';
import { enableNotifications, keepAwake, onBack, setBarStyle } from '../lib/native';
import { unlockAudio } from '../lib/sounds';
import { useSync } from '../lib/sync';
import { decodePairing, pairingFromLocation, type Pairing } from '../qr/pairing';
import { QrScanner } from '../qr/QrScanner';
import { play, PREVIEW_ID, refreshHealth, resetForRole, selectScenario, setMode, setViewer } from '../store';
import { ChatApp } from './ChatApp';
import { GuardianApp } from './GuardianApp';

export type Role = DeviceRole;

const ROLES: { role: Exclude<Role, 'temp'>; title: string; sub: string; icon: ReactNode; tone: string }[] = [
  { role: 'child', title: `${CHILD.name}'s phone`, sub: 'Messages, protected by RAKSHAK', icon: <ShieldCheck size={22} strokeWidth={2.4} />, tone: 'blue' },
  { role: 'contact', title: "Kabir's phone", sub: 'A plain messenger. Kabir does not know RAKSHAK is there', icon: <MessageCircle size={22} strokeWidth={2.4} />, tone: 'grey' },
  { role: 'guardian', title: `${GUARDIAN.name}'s phone`, sub: 'RAKSHAK Guardian: alerts, reports, temporary guardians', icon: <BellRing size={22} strokeWidth={2.4} />, tone: 'amber' },
];

/** First screen of the Android app: connect to the server laptop (scan its QR), then choose who uses this phone. */
/**
 * A scanned join link opened in the phone's browser (no RAKSHAK app): hand it to the setup screen exactly as the app's
 * own scanner would, and drop the code from the address bar.
 */
export function JoinLink() {
  const navigate = useNavigate();
  useEffect(() => {
    const p = pairingFromLocation();
    navigate('/app', { replace: true, state: p ? { pairing: p } : null });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

export function MobileHome() {
  const navigate = useNavigate();
  const location = useLocation();
  const sync = useSync();
  const live = sync.state === 'live';
  const [scanning, setScanning] = useState(false);
  const [manual, setManual] = useState(false);
  const [invite, setInvite] = useState<Extract<Pairing, { kind: 'guardian' }> | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    setActiveRole(null);
    setBarStyle('dark');
    return onBack(() => {
      if (scanning) {
        setScanning(false);
        return true;
      }
      return false;
    });
  }, [scanning]);

  const open = (role: Exclude<Role, 'temp'>) => {
    unlockAudio();
    if (role === 'guardian') void enableNotifications();
    setDevice({ role, name: role === 'guardian' ? GUARDIAN.name : role === 'child' ? CHILD.name : 'Kabir' });
    navigate(`/m/${role}`);
  };

  const onScan = (text: string) => {
    setScanning(false);
    applyPairing(decodePairing(text));
  };

  const applyPairing = (p: Pairing | null) => {
    if (!p) return setNote("That QR code isn't a RAKSHAK code.");
    if (p.kind === 'connect') {
      setServer({ url: p.url, token: p.token });
      setNote('Connected to the RAKSHAK server.');
      void refreshHealth();
    } else if (p.expiresAt && p.expiresAt < Date.now()) {
      setNote('That invite has expired. Ask for a new one.');
    } else setInvite(p);
  };

  // Opened from a join link in the browser (see JoinLink).
  useEffect(() => {
    const p = (location.state as { pairing?: Pairing } | null)?.pairing;
    if (!p) return;
    applyPairing(p);
    navigate('/app', { replace: true, state: null });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Offline fallback: this phone plays the labelled presentation preview on its own, without any server.
  const offlineDemo = async () => {
    unlockAudio();
    await setMode('A');
    await selectScenario(PREVIEW_ID);
    navigate('/m/child?offline=1');
    setTimeout(() => void play(), 900);
  };

  return (
    <div className="mhome">
      <header className="mhome-head">
        <span className="brand-mark">
          <ShieldCheck size={18} strokeWidth={2.6} />
        </span>
        <div>
          <div className="mhome-brand">RAKSHAK</div>
          <div className="mhome-sub">Set up this phone</div>
        </div>
        <span className={`mhome-state ${live ? 'ok' : sync.state === 'connecting' ? 'warn' : 'bad'}`}>
          {live ? 'Connected' : sync.state === 'connecting' ? 'Connecting…' : sync.state === 'unauthorized' ? 'Wrong code' : 'Not connected'}
        </span>
      </header>

      <section className="mhome-section">
        <div className="mhome-k">1 · Connect</div>
        <button className="mrole mrole-primary" onClick={() => setScanning(true)}>
          <span className="mrole-icon blue">
            <QrCode size={22} strokeWidth={2.4} />
          </span>
          <span className="mrole-text">
            <span className="mrole-title">Scan QR code</span>
            <span className="mrole-sub">The laptop's code, or a temporary-guardian invite</span>
          </span>
          <ChevronRight size={18} className="mrole-go" />
        </button>
        {note && <p className="mhome-note strong">{note}</p>}
        <button className="mhome-link" onClick={() => setManual((v) => !v)}>
          <Keyboard size={14} /> {manual ? 'Hide' : 'Enter address and code by hand'}
        </button>
        {manual && <ServerSettings onConnected={refreshHealth} />}
      </section>

      <section className={`mhome-section ${live ? '' : 'dim'}`}>
        <div className="mhome-k">2 · Who uses this phone?</div>
        {ROLES.map((r) => (
          <button key={r.role} className="mrole" onClick={() => open(r.role)} disabled={!live}>
            <span className={`mrole-icon ${r.tone}`}>{r.icon}</span>
            <span className="mrole-text">
              <span className="mrole-title">{r.title}</span>
              <span className="mrole-sub">{r.sub}</span>
            </span>
            <ChevronRight size={18} className="mrole-go" />
          </button>
        ))}
        {!live && <p className="mhome-note">Connect first. The phone remembers its role and opens straight into it next time.</p>}
      </section>

      <section className="mhome-section">
        <button className="mrole mrole-offline" onClick={offlineDemo} disabled={live}>
          <span className="mrole-icon grey">
            <PlayCircle size={22} strokeWidth={2.4} />
          </span>
          <span className="mrole-text">
            <span className="mrole-title">Offline demo</span>
            <span className="mrole-sub">{live ? 'Only when this phone is not connected, so it cannot disturb the others.' : 'No server needed. Plays the scripted presentation preview (not live AI) on this phone.'}</span>
          </span>
        </button>
      </section>

      <footer className="mhome-foot">
        <UserRound size={12} /> Synthetic demo conversations only · Team Git Happens
      </footer>

      <AnimatePresence>
        {scanning && <QrScanner hint="Point at a RAKSHAK QR code" onResult={onScan} onClose={() => setScanning(false)} />}
        {invite && <JoinAsGuardian invite={invite} onCancel={() => setInvite(null)} />}
      </AnimatePresence>
    </div>
  );
}

/** A temporary guardian scanned an invite: they give their name, and the phone joins with the invite's own code. */
function JoinAsGuardian({ invite, onCancel }: { invite: Extract<Pairing, { kind: 'guardian' }>; onCancel: () => void }) {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const until = new Date(invite.expiresAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  const join = async () => {
    setBusy(true);
    setErr(null);
    unlockAudio();
    void enableNotifications();
    setServer({ url: invite.url, token: invite.code });
    try {
      await api.health();
      setDevice({ role: 'temp', name: name.trim() || 'Temporary guardian', scope: invite.scope });
      navigate('/m/temp');
    } catch {
      setErr("Can't reach RAKSHAK with this invite. It may have expired or been revoked, or this phone is on another network.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <motion.div className="msheet-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ pointerEvents: 'none', opacity: 0 }}>
      <motion.div className="msheet" initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ pointerEvents: 'none', y: '100%' }} transition={{ type: 'spring', stiffness: 300, damping: 32 }}>
        <div className="msheet-icon">
          <Users size={26} />
        </div>
        <div className="msheet-title">Become {invite.child}'s temporary guardian</div>
        <p className="msheet-text">
          You'll get {invite.scope === 'critical' ? 'critical safety alerts only' : 'safety alerts'} about {invite.child} until <b>{until}</b>. You will never see
          {` ${invite.child}'s`} messages. Access ends by itself, or earlier if it is revoked.
        </p>
        <input className="srv-input" placeholder="Your name, e.g. Ms. Rao (class teacher)" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
        {err && <p className="mhome-note strong bad">{err}</p>}
        <button className="msheet-go" onClick={join} disabled={busy || !name.trim()}>
          {busy ? 'Joining…' : 'Accept'}
        </button>
        <button className="msheet-cancel" onClick={onCancel}>
          Cancel
        </button>
      </motion.div>
    </motion.div>
  );
}

/** One full-screen role. Each phone keeps its own screens; the case itself is shared over the relay. */
export function RoleScreen({ role }: { role: Role }) {
  const [params] = useSearchParams();
  const offline = params.get('offline') === '1';
  const navigate = useNavigate();
  const device = useDevice();

  useEffect(() => {
    // Switching into or out of a guardian role starts from a clean state, so a guardian never holds chat data.
    const wasGuardian = device.role === 'guardian' || device.role === 'temp';
    const isGuardian = role === 'guardian' || role === 'temp';
    setActiveRole(role);
    if (!offline && (wasGuardian !== isGuardian || isGuardian)) resetForRole();
    if (device.role !== role && !offline) setDevice({ ...device, role });
    setViewer(!offline);
    keepAwake(true);
    return () => keepAwake(false);
  }, [role, offline]); // eslint-disable-line react-hooks/exhaustive-deps

  // A temporary guardian without an invite (e.g. opened by hand) goes back to setup.
  useEffect(() => {
    if (role === 'temp' && !device.scope) navigate('/app', { replace: true });
  }, [role, device.scope, navigate]);

  return role === 'guardian' || role === 'temp' ? <GuardianApp temporary={role === 'temp'} offline={offline} /> : <ChatApp role={role} offline={offline} />;
}
