import { AnimatePresence, motion } from 'framer-motion';
import { BellRing, Laptop, Lock, MessageCircle, QrCode, ShieldCheck, Smartphone, Timer, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { encodePairing } from '../qr/pairing';
import { QrCode as QrImage } from '../qr/QrCode';
import { SimulationPage } from './Simulation';

/** The projector view: the engine and the devices, while the story plays on real phones. */
export function EnginePage() {
  return <SimulationPage initialView="engine" />;
}

type Peers = Awaited<ReturnType<typeof api.syncPeers>>;

const AUDIENCE: Record<string, { label: string; tone: string }> = {
  chat: { label: 'Chat device · conversation', tone: 'blue' },
  guardian: { label: 'Guardian · alert summary only', tone: 'amber' },
  critical: { label: 'Temporary · critical alerts only', tone: 'red' },
};

/** What each connected device is and what it has received, from the relay itself (proof, not a claim). */
export function DevicesPanel() {
  const [peers, setPeers] = useState<Peers | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    let live = true;
    const load = () =>
      api
        .syncPeers()
        .then((p) => live && (setPeers(p), setErr(false)))
        .catch(() => live && setErr(true));
    void load();
    const t = setInterval(load, 1500);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, []);

  const guardians = peers?.peers.filter((p) => p.audience !== 'chat') ?? [];
  return (
    <section className="panel panel-devices">
      <div className="panel-head">
        <div>
          <div className="panel-title">Devices</div>
          <div className="panel-sub">What each phone received through the relay</div>
        </div>
        <span className="dev-count">{peers ? peers.peers.length : '–'}</span>
      </div>
      {err && <div className="dev-empty">Server not reachable from this laptop.</div>}
      {peers?.peers.length === 0 && <div className="dev-empty">No devices yet. Use “Connect phones” and scan the QR with each phone.</div>}
      <div className="dev-list">
        {peers?.peers.map((p) => {
          const a = AUDIENCE[p.audience] ?? AUDIENCE.chat;
          const Icon = p.role === 'temp' ? Timer : p.role === 'guardian' ? BellRing : p.addr.startsWith('127.') || p.addr === '::1' ? Laptop : p.name === 'Kabir' ? MessageCircle : Smartphone;
          return (
            <motion.div layout key={p.id} className={`dev-row ${a.tone}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
              <span className="dev-icon">
                <Icon size={16} />
              </span>
              <span className="dev-main">
                <span className="dev-name">
                  {p.name && p.name !== p.role ? p.name : p.addr.startsWith('127.') ? 'This laptop' : p.role} <em>{p.addr}</em>
                </span>
                <span className={`dev-aud ${a.tone}`}>{a.label}</span>
                <span className="dev-recent">
                  {p.recent.slice(-5).map((r, i) => (
                    <i key={i}>{r.replace('action:', '')}</i>
                  ))}
                </span>
              </span>
              <span className="dev-stats">
                <b>{p.frames}</b> msgs
                <br />
                {(p.bytes / 1024).toFixed(1)} KB
              </span>
            </motion.div>
          );
        })}
      </div>
      <div className="dev-proof">
        <Lock size={12} />
        <span>
          Guardian devices ({guardians.length}) receive alert summaries only: cue types, days, score. <b>Chat messages delivered to them: 0.</b>
          {peers && peers.blockedFrames > 0 ? ` The relay refused ${peers.blockedFrames} frame${peers.blockedFrames === 1 ? '' : 's'} that carried chat content.` : ''}
        </span>
      </div>
    </section>
  );
}

/** QR codes the phones scan to join: the laptop's address and the access code. */
export function ConnectPhones({ onClose }: { onClose: () => void }) {
  const [info, setInfo] = useState<Awaited<ReturnType<typeof api.connectInfo>> | null>(null);
  const [err, setErr] = useState(false);
  const [pick, setPick] = useState(0);
  useEffect(() => {
    const load = () => api.connectInfo().then((i) => (setInfo(i), setErr(false)), () => setErr(true));
    load();
    // The tunnel address appears a few seconds after `npm run server:remote` starts.
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, []);
  // Ways a phone can reach this server: the internet tunnel first (works from anywhere), then this laptop's Wi-Fi.
  const targets = info
    ? [
        ...(info.public ? [{ key: 'net', label: 'Over the internet', url: info.public, shown: info.public.replace(/^https:\/\//, '') }] : []),
        ...(info.lan ? info.addresses.map((a) => ({ key: a, label: `Wi-Fi · ${a}`, url: `http://${a}:${info.port}`, shown: a })) : []),
      ]
    : [];
  const target = targets[Math.min(pick, targets.length - 1)];

  return (
    <motion.div className="connect-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.div className="connect-card" initial={{ y: 20, scale: 0.97 }} animate={{ y: 0, scale: 1 }} onClick={(e) => e.stopPropagation()}>
        <button className="connect-x" onClick={onClose} aria-label="Close">
          <X size={18} />
        </button>
        <div className="connect-title">
          <QrCode size={18} /> Connect phones
        </div>
        {err && <p className="connect-text">The RAKSHAK server is not running on this laptop.</p>}
        {info && targets.length === 0 && (
          <p className="connect-text">
            {info.lan ? (
              'No Wi-Fi address found. Connect this laptop to the hotspot first, or start the server with npm run server:remote for phones elsewhere.'
            ) : (
              <>
                Phones can't reach this server yet. Stop it and start it with <code>npm run server:lan</code> (same Wi-Fi) or <code>npm run server:remote</code> (phones anywhere).
              </>
            )}
          </p>
        )}
        {target && (
          <>
            <p className="connect-text">
              On each phone: RAKSHAK → Scan QR code.{' '}
              {target.key === 'net' ? 'Works from anywhere with internet: share this screen in a call and scan it, or send a photo of it.' : 'Phones must be on the same Wi-Fi or hotspot as this laptop.'}
            </p>
            {targets.length > 1 && (
              <div className="connect-tabs">
                {targets.map((t, i) => (
                  <button key={t.key} className={t === target ? 'on' : ''} onClick={() => setPick(i)}>
                    {t.label}
                  </button>
                ))}
              </div>
            )}
            <div className="connect-qr">
              <QrImage text={encodePairing({ kind: 'connect', url: target.url, token: info!.token })} size={260} />
            </div>
            <div className="connect-manual">
              Or type: <b>{target.shown}</b> · code <b>{info!.token}</b>
            </div>
            {target.key === 'net' && <p className="connect-hint">The internet address changes each time the server starts. Phones that joined earlier need to scan again.</p>}
            {target.key !== 'net' && info!.addresses.length > 1 && <p className="connect-hint">Two networks found. If a phone can't connect, try the other address.</p>}
          </>
        )}
        <p className="connect-hint">
          <ShieldCheck size={12} /> The code lets a phone join this demo. Temporary guardians get their own codes from the guardian's phone instead.
        </p>
      </motion.div>
    </motion.div>
  );
}

export function ConnectButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="chip-btn connect-btn" onClick={() => setOpen(true)}>
        <QrCode size={13} /> Connect phones
      </button>
      <AnimatePresence>{open && <ConnectPhones onClose={() => setOpen(false)} />}</AnimatePresence>
    </>
  );
}
