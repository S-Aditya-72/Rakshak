import { AnimatePresence, LayoutGroup, motion } from 'framer-motion';
import { ShieldCheck } from 'lucide-react';
import { useEffect } from 'react';
import { PhoneFrame, StatusBar } from '../chat/PhoneFrame';
import { playChime, playCritical } from '../lib/sounds';
import { childNameOf, useDemo } from '../store';
import { AlertSheet, CriticalTakeover, GuardianBanner, NotificationCard } from './GuardianAlerts';

/** The guardian's phone: lock screen + alert history + L2 banner / sheet + L3 takeover. */
export function GuardianPhone() {
  const alerts = useDemo((s) => s.data.alerts);
  const banner = useDemo((s) => s.data.guardianBanner);
  const sheet = useDemo((s) => s.data.guardianSheet);
  const critical = useDemo((s) => s.data.critical);
  const sound = useDemo((s) => s.data.sound);
  const child = useDemo((s) => childNameOf(s.data));

  useEffect(() => {
    if (banner && sound) playChime();
  }, [banner?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (critical && sound) playCritical();
  }, [critical?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const history = alerts
    .filter((a) => a.level >= 2 && a.id !== banner?.id && a.id !== sheet?.id)
    .slice()
    .reverse();

  return (
    <PhoneFrame theme="dark" shakeKey={critical?.id}>
      <div className="lock">
        <div className="lock-wallpaper" />
        <StatusBar />
        <div className="lock-clock">
          <div className="lock-date">Monday 23 October</div>
          <div className="lock-time">9:41</div>
        </div>

        <LayoutGroup>
          <div className="lock-notifs">
            <AnimatePresence>
              {history.length === 0 && !banner && (
                <motion.div className="lock-empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  <div className="lock-empty-icon">
                    <ShieldCheck size={22} strokeWidth={2.2} />
                  </div>
                  <div className="lock-empty-title">RAKSHAK is watching over {child}</div>
                  <div className="lock-empty-sub">No alerts. Level 1 nudges stay private to {child}. Simulated guardian view.</div>
                </motion.div>
              )}
            </AnimatePresence>
            {history.map((a) => (
              <NotificationCard key={a.id} alert={a} />
            ))}
          </div>

          <AnimatePresence>{banner && <GuardianBanner key={banner.id} alert={banner} />}</AnimatePresence>
          <AnimatePresence>{sheet && <AlertSheet key={sheet.id} alert={sheet} />}</AnimatePresence>
        </LayoutGroup>

        <AnimatePresence>{critical && <CriticalTakeover key={critical.id} alert={critical} />}</AnimatePresence>
      </div>
    </PhoneFrame>
  );
}
