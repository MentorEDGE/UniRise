import { useState } from 'react';
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
export const ACTIVITY_KINDS: EntityKind[] = ['publications', 'grants', 'seedMoney', 'conferences', 'awards', 'ipr'];

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
  const [hover, setHover] = useState<number | null>(null);
  if (!data.length) return <span className="muted spark-none">No approved research activity yet</span>;
  const max = Math.max(1, ...data.map((d) => d.total));
  const bw = 5; const gap = 2;
  const w = data.length * (bw + gap) - gap;
  const summary = data.filter((d) => d.total).map((d) => `${d.year}: ${d.total}`).join(', ');
  return (
    <span className="spark">
      {label && <span className="spark-year">{data[0].year}</span>}
      <span className="spark-plot" onMouseLeave={() => setHover(null)}>
      {hover !== null && (
        <span className="spark-tip" role="tooltip" style={{ left: hover * (bw + gap) + bw / 2 }}>
          <b>{data[hover].year}</b>
          <span>Publications: {data[hover].publications}</span>
          <span>Grants / projects: {data[hover].projects}</span>
          <span>Other: {data[hover].other}</span>
        </span>
      )}
      <svg width={w} height={height} viewBox={`0 0 ${w} ${height}`} role="img" aria-label={`Research activity per year. ${summary}`}>
        <line x1="0" x2={w} y1={height - 0.5} y2={height - 0.5} className="spark-base" />
        {data.map((d, i) => {
          const h = d.total ? Math.max(2, (d.total / max) * (height - 2)) : 0;
          return <rect key={d.year} x={i * (bw + gap)} y={height - 1 - h} width={bw} height={h} rx={1} className={i === (hover ?? data.length - 1) ? 'spark-bar now' : 'spark-bar'} />;
        })}
        {data.map((d, i) => (
          <rect key={`hit-${d.year}`} x={i * (bw + gap) - gap / 2} y={0} width={bw + gap} height={height} className="spark-hit" onMouseEnter={() => setHover(i)} />
        ))}
      </svg>
      </span>
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

/* ---------- highlights (selected works) ---------- */

const HIGHLIGHT_KINDS: EntityKind[] = ['publications', 'grants', 'seedMoney', 'conferences', 'awards', 'ipr'];
const KIND_LABEL: Record<string, string> = { publications: 'Publication', grants: 'Grant', seedMoney: 'Seed money', conferences: 'Conference', awards: 'Honour', ipr: 'IP' };
export interface HighlightItem { key: string; kind: EntityKind; id: string; kindLabel: string; title: string; year: string; record: AnyRecord }

const titleOf = (kind: EntityKind, r: AnyRecord) => {
  const x = r as unknown as Record<string, string>;
  return kind === 'conferences' ? x.paperTitle || x.conferenceName : x.title;
};

/** The faculty member's approved records they can pin as highlights, newest first. */
export function highlightOptions(db: DB, facultyId: string): HighlightItem[] {
  const out: HighlightItem[] = [];
  for (const kind of HIGHLIGHT_KINDS) {
    for (const r of (db[kind] ?? []) as AnyRecord[]) {
      if (r.status !== 'Approved' || !creditedFaculty(kind, r).includes(facultyId)) continue;
      out.push({ key: `${kind}:${r.id}`, kind, id: r.id, kindLabel: KIND_LABEL[kind], title: titleOf(kind, r), year: dateOf(kind, r).slice(0, 4), record: r });
    }
  }
  return out.sort((a, b) => b.year.localeCompare(a.year));
}

/** Saved highlight keys turned back into items, in the order chosen; anything no longer approved is dropped. */
export function resolveHighlights(db: DB, facultyId: string, keys: string[]): HighlightItem[] {
  const all = new Map(highlightOptions(db, facultyId).map((h) => [h.key, h]));
  return keys.map((k) => all.get(k)).filter((h): h is HighlightItem => !!h);
}
