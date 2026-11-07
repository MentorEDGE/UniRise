import type { ReactNode } from 'react';
import { SDGS } from '../lib/types';

/**
 * Simple white pictograms for the 17 Sustainable Development Goals, drawn for this app on a 40 × 40 grid and shown on
 * each goal's official colour. Strokes use currentColor, so the tile sets the colour.
 */
const G: Record<number, ReactNode> = {
  1: <>{[8, 16, 24, 32].map((x, i) => <g key={x}><circle cx={x} cy={i % 3 ? 14 : 12} r={i % 3 ? 2 : 2.6} className="f" /><path d={i % 3 ? `M${x} 17v9M${x - 2.5} 20h5M${x} 26l-2 5M${x} 26l2 5` : `M${x} 15.5v11M${x - 3.5} 19h7M${x} 26.5l-2.5 6M${x} 26.5l2.5 6`} /></g>)}</>,
  2: <><path d="M8 20h24a12 12 0 0 1-24 0Z" className="f" /><path d="M15 11c-1.5 2 1.5 3 0 5M20 10c-1.5 2 1.5 3 0 5M25 11c-1.5 2 1.5 3 0 5M16 32h8" /></>,
  3: <><path d="M5 22h7l3-7 4 13 3-9 2 3h3" /><path d="M29.5 26.5 27 24a2.6 2.6 0 0 1 3.7-3.7l-.2.2.2-.2A2.6 2.6 0 0 1 34.4 24Z" className="f" /></>,
  4: <><path d="M7 12c4-1.5 8-1 12 1.5V31c-4-2.5-8-3-12-1.5Z" className="f" /><path d="M19 13.5c3-2.5 6-3 9-1.5v17.5c-3-1.5-6-1-9 1.5" /><path d="M32 9v18l1.5 3 1.5-3V9Z" className="f" /></>,
  5: <><circle cx="18" cy="17" r="7" /><path d="M18 24v10M14 30h8M23 12l6-6M24 6h5v5M15 16h6M15 19h6" /></>,
  6: <><path d="M11 9h18l-3 22H14Z" /><path d="M20 15c-2.5 3.5-3.5 5.5-3.5 7a3.5 3.5 0 0 0 7 0c0-1.5-1-3.5-3.5-7Z" className="f" /></>,
  7: <><circle cx="20" cy="20" r="6.5" /><path d="M20 16.5V20M17.6 17.8a3.5 3.5 0 1 0 4.8 0" />{[0, 45, 90, 135, 180, 225, 270, 315].map((a) => <path key={a} d="M20 6v4" transform={`rotate(${a} 20 20)`} />)}</>,
  8: <><path d="M8 32h24" /><path d="M10 32v-7h4v7M17 32v-10h4v10M24 32V18h4v14" className="f" /><path d="m9 21 8-7 5 4 9-9M26 9h5v5" /></>,
  9: <><path d="m20 7 6 3.5v7L20 21l-6-3.5v-7Z M14 21l6 3.5v7L14 35l-6-3.5v-7Z M26 21l6 3.5v7L26 35l-6-3.5v-7Z" /><path d="m14 10.5 6 3.5 6-3.5M20 14v7M8 24.5l6 3.5 6-3.5M14 28v7M20 24.5l6 3.5 6-3.5M26 28v7" /></>,
  10: <><path d="M15 17h10M15 23h10" /><path d="M20 6v5M17 9l3-3 3 3M20 34v-5M17 31l3 3 3-3M6 20h5M9 17l-3 3 3 3M34 20h-5M31 17l3 3-3 3" className="f" /></>,
  11: <><path d="M6 32h28M8 32V22h6v10M15 32V11h7v21M23 32V17h5v15M29 32V24l4 3v5" className="f" /><path d="M17.5 15h2M17.5 19h2M17.5 23h2M17.5 27h2M10 25h2M10 28h2" className="k" /></>,
  12: <path d="M20 20c-3-4-5.5-6-8.5-6a6 6 0 0 0 0 12c3 0 5.5-2 8.5-6s5.5-6 8.5-6a6 6 0 0 1 0 12c-3 0-5.5-2-8.5-6Z" />,
  13: <><path d="M5 20c4-6 9-9 15-9s11 3 15 9c-4 6-9 9-15 9s-11-3-15-9Z" className="f" /><circle cx="20" cy="20" r="6" className="k" /><path d="M16 18c2 0 2 2 4 2s1.5-3 3-3M17 23c1.5-1 3 0 4.5 1" className="k" /></>,
  14: <><path d="M6 11c2.5-2 4.5-2 7 0s4.5 2 7 0 4.5-2 7 0 4.5 2 7 0M6 16c2.5-2 4.5-2 7 0s4.5 2 7 0 4.5-2 7 0 4.5 2 7 0" /><path d="M9 26c4-5 10-6 16-2l5-4v12l-5-4c-6 4-12 3-16-2Z" className="f" /><circle cx="14" cy="25.5" r="1" className="k f" /></>,
  15: <><path d="M6 33h28M8 29h24" /><path d="M14 27V19" /><circle cx="14" cy="15" r="6" className="f" /><path d="m23 12 2 1.5 2-1.5M28 16l2 1.5 2-1.5M24 21h9M26 24.5h6" /></>,
  16: <><path d="M9 21c3 4 9 5 13 2l9-9-5 1c-1-3-4-4-6-2l3 3-5 4c-3-1-6-1-9 1Z" className="f" /><path d="M14 31h12M20 27v4M17 25l-3 3M22 24l5 4" /></>,
  17: <>{[0, 72, 144, 216, 288].map((a) => <ellipse key={a} cx="20" cy="13" rx="4.5" ry="7" transform={`rotate(${a} 20 20)`} />)}</>,
};

/** A goal's coloured tile with its pictogram. */
export function SdgTile({ n, size = 64 }: { n: number; size?: number }) {
  const g = SDGS[n - 1];
  return (
    <span className="sdg-tile" style={{ background: g.color, width: size, height: size, ['--c' as string]: g.color }} aria-hidden>
      <svg viewBox="0 0 40 40" width={size * 0.78} height={size * 0.78}>{G[n]}</svg>
    </span>
  );
}
