import { motion, useAnimationControls } from 'framer-motion';
import { useEffect, type ReactNode } from 'react';
import { ShieldCheck } from 'lucide-react';

interface PhoneFrameProps {
  theme?: 'light' | 'dark';
  /** Changing this value shakes the phone once (used for Level 3). */
  shakeKey?: string | null;
  children: ReactNode;
}

export function PhoneFrame({ theme = 'light', shakeKey, children }: PhoneFrameProps) {
  const controls = useAnimationControls();

  useEffect(() => {
    if (!shakeKey) return;
    void controls.start({
      x: [0, -9, 9, -7, 7, -4, 4, 0],
      transition: { duration: 0.55, ease: 'easeInOut', delay: 0.15 },
    });
  }, [shakeKey, controls]);

  return (
    <motion.div className={`phone ${theme}`} animate={controls}>
      <div className="phone-btn phone-btn-l1" />
      <div className="phone-btn phone-btn-l2" />
      <div className="phone-btn phone-btn-r" />
      <div className="phone-screen">
        {children}
        <div className="dynamic-island" />
        <div className="home-indicator" />
      </div>
    </motion.div>
  );
}

export function StatusBar({ shield = false }: { shield?: boolean }) {
  return (
    <div className="status-bar">
      <div className="status-left">
        <span>9:41</span>
        {shield && (
          <span className="rakshak-pill" title="Simulated phone: analysis runs on the host laptop, not on this phone">
            <ShieldCheck size={11} strokeWidth={2.6} />
          </span>
        )}
      </div>
      <div className="status-right">
        <svg width="18" height="12" viewBox="0 0 18 12" fill="currentColor" aria-hidden>
          <rect x="0" y="8" width="3" height="4" rx="1" />
          <rect x="5" y="5.5" width="3" height="6.5" rx="1" />
          <rect x="10" y="3" width="3" height="9" rx="1" />
          <rect x="15" y="0" width="3" height="12" rx="1" />
        </svg>
        <svg width="16" height="12" viewBox="0 0 16 12" fill="currentColor" aria-hidden>
          <path d="M8 2.4c2.3 0 4.4.9 6 2.4l1.2-1.3A10.4 10.4 0 0 0 8 .6 10.4 10.4 0 0 0 .8 3.5L2 4.8a8.6 8.6 0 0 1 6-2.4Z" />
          <path d="M8 6c1.3 0 2.5.5 3.4 1.3l1.2-1.3A6.6 6.6 0 0 0 8 4.2 6.6 6.6 0 0 0 3.4 6l1.2 1.3C5.5 6.5 6.7 6 8 6Z" />
          <path d="M8 9.6c.5 0 1 .2 1.3.5L8 11.5 6.7 10.1c.3-.3.8-.5 1.3-.5Z" />
        </svg>
        <span className="battery">
          <span className="battery-level" />
        </span>
      </div>
    </div>
  );
}
