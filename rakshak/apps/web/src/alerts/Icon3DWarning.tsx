import { useId } from 'react';

interface Icon3DWarningProps {
  variant?: 'amber' | 'red';
  size?: number;
  /** Puts the triangle on a glossy pedestal (Level 3 "CRITICAL" card). */
  pedestal?: boolean;
}

const PALETTE = {
  amber: { edge: ['#C77700', '#7A3E00'], face: ['#FFF09A', '#FFC81F', '#F29A00'], mark: '#2A1700', glow: '#FFB800' },
  red: { edge: ['#9A0014', '#43000A'], face: ['#FF9C8F', '#FF3B30', '#BE0019'], mark: '#FFD60A', glow: '#FF2D20' },
};

/** Glossy 3D warning triangle drawn entirely in SVG: thick rounded edge for depth, gradient face, specular highlight. */
export function Icon3DWarning({ variant = 'amber', size = 64, pedestal = false }: Icon3DWarningProps) {
  const id = useId().replace(/:/g, '');
  const c = PALETTE[variant];
  const pts = '60,18 106,98 14,98';
  const height = pedestal ? 150 : 122;

  return (
    <svg width={size} height={(size * height) / 120} viewBox={`0 0 120 ${height}`} aria-hidden style={{ overflow: 'visible' }}>
      <defs>
        <linearGradient id={`edge${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={c.edge[0]} />
          <stop offset="1" stopColor={c.edge[1]} />
        </linearGradient>
        <linearGradient id={`face${id}`} x1="0.25" y1="0" x2="0.75" y2="1">
          <stop offset="0" stopColor={c.face[0]} />
          <stop offset="0.45" stopColor={c.face[1]} />
          <stop offset="1" stopColor={c.face[2]} />
        </linearGradient>
        <linearGradient id={`hi${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.9" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <radialGradient id={`shadow${id}`}>
          <stop offset="0" stopColor="#000" stopOpacity="0.45" />
          <stop offset="1" stopColor="#000" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`ped${id}`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#0c0c0f" />
          <stop offset="0.35" stopColor="#3b3b44" />
          <stop offset="0.6" stopColor="#1c1c22" />
          <stop offset="1" stopColor="#060608" />
        </linearGradient>
        <radialGradient id={`pedTop${id}`}>
          <stop offset="0" stopColor={c.glow} stopOpacity="0.55" />
          <stop offset="0.6" stopColor="#2a2a31" />
          <stop offset="1" stopColor="#15151a" />
        </radialGradient>
        <filter id={`soft${id}`} x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="1.2" />
        </filter>
      </defs>

      {pedestal ? (
        <g>
          <rect x="14" y="116" width="92" height="20" fill={`url(#ped${id})`} />
          <ellipse cx="60" cy="136" rx="46" ry="9" fill={`url(#ped${id})`} />
          <ellipse cx="60" cy="116" rx="46" ry="9" fill={`url(#pedTop${id})`} />
          <ellipse cx="60" cy="116" rx="46" ry="9" fill="none" stroke="#fff" strokeOpacity="0.12" />
        </g>
      ) : (
        <ellipse cx="60" cy="112" rx="46" ry="7" fill={`url(#shadow${id})`} />
      )}

      <g transform={pedestal ? 'translate(0,6)' : undefined}>
        {/* edge / depth */}
        <g transform="translate(0,5)">
          <polygon points={pts} fill={`url(#edge${id})`} stroke={`url(#edge${id})`} strokeWidth="22" strokeLinejoin="round" />
        </g>
        {/* face */}
        <polygon points={pts} fill={`url(#face${id})`} stroke={`url(#face${id})`} strokeWidth="16" strokeLinejoin="round" />
        {/* specular highlight */}
        <polygon
          points="60,22 84,62 36,62"
          fill={`url(#hi${id})`}
          stroke={`url(#hi${id})`}
          strokeWidth="10"
          strokeLinejoin="round"
          opacity="0.55"
          filter={`url(#soft${id})`}
        />
        <ellipse cx="44" cy="74" rx="5" ry="10" fill="#fff" opacity="0.18" transform="rotate(30 44 74)" />
        {/* exclamation mark */}
        <rect x="53.5" y="40" width="13" height="36" rx="6.5" fill={c.mark} />
        <circle cx="60" cy="88" r="7" fill={c.mark} />
      </g>
    </svg>
  );
}
