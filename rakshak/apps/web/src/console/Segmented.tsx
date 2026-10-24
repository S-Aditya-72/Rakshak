import { motion } from 'framer-motion';
import type { ReactNode } from 'react';

/** iOS-style segmented control with a sliding thumb. `id` must be unique per control on the page. */
export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  id,
}: {
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (v: T) => void;
  id: string;
}) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button key={String(o.value)} className={`seg-btn ${o.value === value ? 'on' : ''}`} onClick={() => onChange(o.value)}>
          {o.value === value && <motion.span layoutId={`seg-${id}`} className="seg-thumb" transition={{ type: 'spring', stiffness: 500, damping: 35 }} />}
          <span className="seg-label">{o.label}</span>
        </button>
      ))}
    </div>
  );
}
