import { creditedFaculty } from '../lib/domain';
import type { AnyRecord, DB, EntityKind } from '../lib/types';
import { SDGS } from '../lib/types';
import { dateOf } from '../lib/analytics';

/** Researcher-discovery building blocks shared by Faculty Search and the research profile. */

/** Faculty photograph, or a neutral silhouette when none has been uploaded. */
export function Avatar({ name, photo, size = 72 }: { name: string; photo?: string; size?: number }) {
  return (
    <span className="avatar" style={{ width: size, height: size * 1.12 }}>
      {photo ? <img src={photo} alt={`Photograph of ${name}`} /> : (
        <svg viewBox="0 0 40 44" role="img" aria-label={`No photograph of ${name}`}>
          <circle cx="20" cy="15" r="8.5" />
          <path d="M4 44c0-9.5 7.2-16 16-16s16 6.5 16 16Z" />
        </svg>
      )}
    </span>
  );
}

/** A coloured SDG tile with its number (the goal's official colour). */
export function SdgIcon({ n, size = 34 }: { n: number; size?: number }) {
  const g = SDGS[n - 1];
  return <span className="sdg-icon" style={{ background: g.color, width: size, height: size, fontSize: size * 0.44 }} title={`SDG ${n}: ${g.title}`} aria-hidden>{n}</span>;
}

/** Kinds counted as research activity (FDPs are professional development, not research output). */
export const ACTIVITY_KINDS: EntityKind[] = ['publications', 'grants', 'seedMoney', 'conferences', 'awards'];

export interface YearActivity { year: number; publications: number; projects: number; other: number; total: number }

/** Approved research activity per calendar year for one faculty member, from first active year to this year. */
export function activityByYear(db: DB, facultyId: string, thisYear = new Date().getFullYear()): YearActivity[] {
  const counts = new Map<number, YearActivity>();
  for (const k of ACTIVITY_KINDS) {
    for (const r of db[k] as AnyRecord[]) {
      if (r.status !== 'Approved' || !creditedFaculty(k, r).includes(facultyId)) continue;
      const y = Number(dateOf(k, r).slice(0, 4));
      if (!y) continue;
      const row = counts.get(y) ?? { year: y, publications: 0, projects: 0, other: 0, total: 0 };
      if (k === 'publications') row.publications++; else if (k === 'grants' || k === 'seedMoney') row.projects++; else row.other++;
      row.total++;
      counts.set(y, row);
    }
  }
  if (!counts.size) return [];
  const first = Math.min(...counts.keys());
  const last = Math.max(thisYear, ...counts.keys());
  return Array.from({ length: last - first + 1 }, (_, i) => counts.get(first + i) ?? { year: first + i, publications: 0, projects: 0, other: 0, total: 0 });
}

/** Small bar chart of research activity per year, labelled with the first and last year. */
export function ActivitySpark({ data, height = 34, label = true }: { data: YearActivity[]; height?: number; label?: boolean }) {
  if (!data.length) return <span className="muted spark-none">No approved research activity yet</span>;
  const max = Math.max(1, ...data.map((d) => d.total));
  const bw = 5; const gap = 2;
  const w = data.length * (bw + gap) - gap;
  const summary = data.filter((d) => d.total).map((d) => `${d.year}: ${d.total}`).join(', ');
  return (
    <span className="spark">
      {label && <span className="spark-year">{data[0].year}</span>}
      <svg width={w} height={height} viewBox={`0 0 ${w} ${height}`} role="img" aria-label={`Research activity per year. ${summary}`}>
        <title>{data.map((d) => `${d.year}: ${d.publications} publications, ${d.projects} grants/projects, ${d.other} other`).join('\n')}</title>
        <line x1="0" x2={w} y1={height - 0.5} y2={height - 0.5} className="spark-base" />
        {data.map((d, i) => {
          const h = d.total ? Math.max(2, (d.total / max) * (height - 2)) : 0;
          return <rect key={d.year} x={i * (bw + gap)} y={height - 1 - h} width={bw} height={h} rx={1} className={i === data.length - 1 ? 'spark-bar now' : 'spark-bar'} />;
        })}
      </svg>
      {label && <span className="spark-year">{data[data.length - 1].year}</span>}
    </span>
  );
}

/** Splits a semicolon / comma separated profile field into clean, de-duplicated items. */
export const splitList = (s: string | undefined) => [...new Set((s ?? '').split(/[;,]/).map((x) => x.trim()).filter(Boolean))];

/** First / last name parts for sorting ("Faculty A" → first "Faculty", last "A"). */
export const nameParts = (name: string) => {
  const parts = name.trim().split(/\s+/);
  return { first: parts[0] ?? '', last: parts.length > 1 ? parts[parts.length - 1] : parts[0] ?? '' };
};
