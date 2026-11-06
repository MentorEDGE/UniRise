import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { dateOf, inr, isSanctioned, lakh } from '../lib/analytics';
import type { AnyRecord, Conference, DB, EntityKind, Fdp, Grant, Honour, Publication, SeedMoney } from '../lib/types';
import { useTheme } from '../lib/theme';

/**
 * One consolidated, interactive analytics card for a research module, shown between Search and the records table.
 * It is computed from the same filtered records as the table (actual records only). Clicking a bar narrows the table
 * to that year / type / department / ...; the chart keeps showing the whole filtered set with the choice highlighted.
 */

export interface Focus { dim: string; value: string }
interface Dim { id: string; label: string; of: (r: AnyRecord) => string; order?: 'asc' | 'count' }
interface Metric { id: string; label: string; of: (r: AnyRecord) => number; fmt: (n: number) => string }

const year = (k: EntityKind) => (r: AnyRecord) => dateOf(k, r).slice(0, 4) || '—';
const short = (s: string) => (s.length > 26 ? `${s.slice(0, 24)}…` : s);

/** What can be grouped and measured for each module. */
function config(kind: EntityKind, deptOf: (r: AnyRecord) => string) {
  const count: Metric = { id: 'count', label: 'Entries', of: () => 1, fmt: (n) => n.toLocaleString('en-IN') };
  const dept: Dim = { id: 'dept', label: 'Department', of: deptOf, order: 'count' };
  const yr: Dim = { id: 'year', label: 'Year', of: year(kind), order: 'asc' };
  switch (kind) {
    case 'publications': return {
      noun: 'publications', metrics: [count],
      dims: [yr, { id: 'type', label: 'Journal vs conference', of: (r: AnyRecord) => (r as Publication).entryType, order: 'count' }, { id: 'category', label: 'Category', of: (r: AnyRecord) => (r as Publication).category, order: 'count' }, dept] as Dim[],
    };
    case 'grants': return {
      noun: 'grants and fellowships',
      metrics: [count, { id: 'funding', label: 'Sanctioned funding', of: (r: AnyRecord) => (isSanctioned(r as Grant) ? (r as Grant).sanctionedAmount : 0), fmt: lakh }] as Metric[],
      dims: [yr, dept, { id: 'agency', label: 'Funding agency', of: (r: AnyRecord) => (r as Grant).agency, order: 'count' }, { id: 'type', label: 'Category', of: (r: AnyRecord) => (r as Grant).grantType, order: 'count' }, { id: 'outcome', label: 'Outcome', of: (r: AnyRecord) => (r as Grant).outcome, order: 'count' }] as Dim[],
    };
    case 'seedMoney': return {
      noun: 'seed-money projects',
      metrics: [count, { id: 'funding', label: 'Sanctioned funding', of: (r: AnyRecord) => (r as SeedMoney).sanctionedAmount, fmt: lakh }] as Metric[],
      dims: [yr, dept, { id: 'status', label: 'Status', of: (r: AnyRecord) => r.status, order: 'count' }] as Dim[],
    };
    case 'fdps': return {
      noun: 'FDP participations',
      metrics: [count, { id: 'hours', label: 'Hours', of: (r: AnyRecord) => (r as Fdp).hours, fmt: (n: number) => `${n.toLocaleString('en-IN')} h` }] as Metric[],
      dims: [yr, dept, { id: 'origin', label: 'Internal vs external', of: (r: AnyRecord) => (/internal/i.test((r as Fdp).organiser) ? 'Internal' : 'External'), order: 'count' }, { id: 'type', label: 'Programme type', of: (r: AnyRecord) => (r as Fdp).programmeType, order: 'count' }, { id: 'role', label: 'Role', of: (r: AnyRecord) => (r as Fdp).role, order: 'count' }] as Dim[],
    };
    case 'awards': return {
      noun: 'honours and awards', metrics: [count],
      dims: [yr, dept, { id: 'type', label: 'Category', of: (r: AnyRecord) => (r as Honour).category, order: 'count' }, { id: 'level', label: 'Level', of: (r: AnyRecord) => (r as Honour).level, order: 'count' }] as Dim[],
    };
    default: return {
      noun: 'conferences', metrics: [count],
      dims: [yr, dept, { id: 'level', label: 'Level', of: (r: AnyRecord) => (r as Conference).level, order: 'count' }, { id: 'type', label: 'Participation', of: (r: AnyRecord) => (r as Conference).participation, order: 'count' }] as Dim[],
    };
  }
}

/** The dimension functions, so the page can apply a chart click to the table. */
export function focusMatcher(kind: EntityKind, db: DB): (r: AnyRecord, f: Focus) => boolean {
  const byId = new Map(db.faculty.map((f) => [f.id, f]));
  const c = config(kind, (r) => byId.get(r.facultyId)?.department ?? '—');
  return (r, f) => { const d = c.dims.find((x) => x.id === f.dim); return !d || d.of(r) === f.value; };
}

function summary(kind: EntityKind, rows: AnyRecord[]): [string, string][] {
  const n = rows.length.toLocaleString('en-IN');
  if (kind === 'publications') {
    const p = rows as Publication[];
    return [['Total publications', n], ['Journal articles', String(p.filter((x) => x.entryType === 'Journal Article').length)], ['Conference papers', String(p.filter((x) => x.entryType === 'Conference Paper').length)], ['Q1 + Q2', String(p.filter((x) => x.quartile === 'Q1' || x.quartile === 'Q2').length)]];
  }
  if (kind === 'grants') {
    const g = rows as Grant[];
    const s = g.filter(isSanctioned);
    return [['Total grants and fellowships', n], ['Sanctioned', String(s.length)], ['Sanctioned funding', inr(s.reduce((a, x) => a + x.sanctionedAmount, 0))], ['Fellowships', String(g.filter((x) => x.grantType === 'Fellowship').length)]];
  }
  if (kind === 'seedMoney') {
    const m = rows as SeedMoney[];
    return [['Total projects', n], ['Approved', String(m.filter((x) => x.status === 'Approved').length)], ['Requested', inr(m.reduce((a, x) => a + x.requestedAmount, 0))], ['Sanctioned', inr(m.reduce((a, x) => a + x.sanctionedAmount, 0))]];
  }
  if (kind === 'fdps') {
    const f = rows as Fdp[];
    return [['Total FDP participation', n], ['Hours', f.reduce((a, x) => a + x.hours, 0).toLocaleString('en-IN')], ['Internal programmes', String(f.filter((x) => /internal/i.test(x.organiser)).length)], ['Faculty taking part', String(new Set(f.map((x) => x.facultyId)).size)]];
  }
  if (kind === 'awards') {
    const a = rows as Honour[];
    return [['Total honours and awards', n], ['International', String(a.filter((x) => x.level === 'International').length)], ['National', String(a.filter((x) => x.level === 'National').length)], ['Faculty recognised', String(new Set(a.map((x) => x.facultyId)).size)]];
  }
  const c = rows as Conference[];
  return [['Total conferences', n], ['National', String(c.filter((x) => x.level !== 'International').length)], ['International', String(c.filter((x) => x.level === 'International').length)], ['Papers presented', String(c.filter((x) => x.participation.includes('Presented')).length)]];
}

export function RecordInsights({ kind, rows, db, focus, onFocus }: { kind: EntityKind; rows: AnyRecord[]; db: DB; focus: Focus | null; onFocus: (f: Focus | null) => void }) {
  const theme = useTheme();
  const byId = useMemo(() => new Map(db.faculty.map((f) => [f.id, f])), [db]);
  const cfg = useMemo(() => config(kind, (r) => byId.get(r.facultyId)?.department ?? '—'), [kind, byId]);
  const [dimId, setDimId] = useState(cfg.dims[0].id);
  const [metricId, setMetricId] = useState('count');
  const dim = cfg.dims.find((d) => d.id === dimId) ?? cfg.dims[0];
  const metric = cfg.metrics.find((m) => m.id === metricId) ?? cfg.metrics[0];
  const data = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) { const k = dim.of(r) || '—'; m.set(k, (m.get(k) ?? 0) + metric.of(r)); }
    const out = [...m].map(([label, value]) => ({ label, value }));
    return dim.order === 'asc' ? out.sort((a, b) => a.label.localeCompare(b.label)) : out.sort((a, b) => b.value - a.value).slice(0, 12);
  }, [rows, dim, metric]);
  const focused = focus ? rows.filter((r) => { const d = cfg.dims.find((x) => x.id === focus.dim); return !d || d.of(r) === focus.value; }) : rows;
  const horizontal = dim.order !== 'asc';
  const ink = theme === 'dark' ? { grid: 'hsl(250 18% 22%)', axis: 'hsl(250 10% 70%)', bar: '#a78bfa', on: '#ede9fe', dim: 'rgb(167 139 250 / 0.35)' } : { grid: 'hsl(248 100% 95%)', axis: 'hsl(220 9% 46%)', bar: '#7c3aed', on: '#3b0f8c', dim: 'rgb(124 58 237 / 0.3)' };
  const fill = (label: string) => (!focus || focus.dim !== dim.id ? ink.bar : focus.value === label ? ink.on : ink.dim);
  const pick = (label?: string) => { if (!label) return; onFocus(focus && focus.dim === dim.id && focus.value === label ? null : { dim: dim.id, value: label }); };

  return (
    <section className="panel wide insights" aria-label={`Analytics for the ${cfg.noun} below`}>
      <div className="ins-stats">{summary(kind, focused).map(([l, v]) => <div key={l}><span>{l}</span><b>{v}</b></div>)}</div>
      <div className="ins-bar">
        <div className="net-seg" role="group" aria-label="Group by">
          {cfg.dims.map((d) => <button key={d.id} type="button" className={d.id === dim.id ? 'on' : ''} aria-pressed={d.id === dim.id} onClick={() => setDimId(d.id)}>{d.label}</button>)}
        </div>
        {cfg.metrics.length > 1 && (
          <label className="net-sel">Measure <select value={metric.id} onChange={(e) => setMetricId(e.target.value)}>{cfg.metrics.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select></label>
        )}
        {focus && (
          <span className="ins-chip">Showing {cfg.dims.find((d) => d.id === focus.dim)?.label.toLowerCase()}: <b>{focus.value}</b>
            <button type="button" onClick={() => onFocus(null)} aria-label="Show all">✕</button></span>
        )}
      </div>
      {rows.length ? (
        <div className="ins-chart" style={{ height: horizontal ? Math.max(200, data.length * 30 + 40) : 260 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} layout={horizontal ? 'vertical' : 'horizontal'} margin={{ top: 8, right: 24, bottom: 4, left: horizontal ? 8 : 0 }}>
              <CartesianGrid stroke={ink.grid} vertical={horizontal} horizontal={!horizontal} />
              {horizontal ? (
                <>
                  <XAxis type="number" tick={{ fontSize: 13, fill: ink.axis }} tickFormatter={(n) => (metric.id === 'funding' ? lakh(n) : String(n))} axisLine={false} tickLine={false} allowDecimals={false} />
                  <YAxis type="category" dataKey="label" width={190} tick={{ fontSize: 13, fill: ink.axis }} tickFormatter={short} axisLine={false} tickLine={false} />
                </>
              ) : (
                <>
                  <XAxis dataKey="label" tick={{ fontSize: 13, fill: ink.axis }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 13, fill: ink.axis }} tickFormatter={(n) => (metric.id === 'funding' ? lakh(n) : String(n))} axisLine={false} tickLine={false} allowDecimals={false} width={metric.id === 'funding' ? 72 : 40} />
                </>
              )}
              <Tooltip cursor={{ fill: 'rgb(124 58 237 / 0.08)' }} content={({ active, payload }) => active && payload?.length ? (
                <div className="ins-tip"><b>{String(payload[0].payload.label)}</b><div>{metric.label}: {metric.fmt(Number(payload[0].value))}</div><small>Click to {focus?.value === payload[0].payload.label ? 'show all' : 'show only these in the table'}</small></div>
              ) : null} />
              <Bar dataKey="value" radius={horizontal ? [0, 6, 6, 0] : [6, 6, 0, 0]} cursor="pointer" onClick={(d: { label?: string; payload?: { label?: string } }) => pick(d.payload?.label ?? d.label)} maxBarSize={48}>
                {data.map((d) => <Cell key={d.label} fill={fill(d.label)} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : <p className="muted ins-empty">No {cfg.noun} match the search, so there is nothing to chart. Clear or widen the search.</p>}
      <p className="ins-note">From the records listed below ({rows.length.toLocaleString('en-IN')}) after the search filters. Click a bar to show only those records in the table; click it again to show all.</p>
    </section>
  );
}
