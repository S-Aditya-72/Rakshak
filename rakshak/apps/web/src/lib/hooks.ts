import { animate } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';

/** Animates a number towards `value` and returns the in-flight display value. */
export function useCountUp(value: number, duration = 0.9) {
  const [display, setDisplay] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const controls = animate(from.current, value, {
      duration,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (v) => {
        from.current = v;
        setDisplay(v);
      },
    });
    return () => controls.stop();
  }, [value, duration]);
  return display;
}

/**
 * Sets --phone-scale on <html> so every phone frame fits the viewport.
 * `phones` is how many phones sit side by side; `reserved` is horizontal space taken by other columns.
 */
export function usePhoneScale(phones: number, reserved: number, chrome = 150) {
  useEffect(() => {
    const update = () => {
      const byHeight = (window.innerHeight - chrome) / 800;
      const byWidth = (window.innerWidth - reserved - 64) / (phones * 372 + (phones - 1) * 28);
      const scale = Math.max(0.5, Math.min(1, byHeight, byWidth));
      document.documentElement.style.setProperty('--phone-scale', scale.toFixed(3));
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [phones, reserved, chrome]);
}
