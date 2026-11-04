import { useState } from 'react';
import type { ReactNode } from 'react';
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

/** UniRise chart palette (../unirise-web/src/index.css --viz-*): violet, pink, amber, teal, in this fixed order.
 *  Validated: all adjacent pairs pass CVD and normal-vision separation on the light surface. Never more than four series. */
export const SERIES = ['#7c3aed', '#db2777', '#d97706', '#0d9488'];
/** One violet ramp for journal quartiles (strongest = Q1), plus slate for unranked. */
export const QUARTILE_COLORS = ['#3b0f8c', '#5b21b6', '#7c3aed', '#a78bfa', '#94a3b8'];
const GRID = 'hsl(248 100% 95%)';
const AXIS = { fontSize: 13.5, fill: 'hsl(220 9% 46%)' };

export interface Series { key: string; label: string; color?: string }
const colorOf = (series: Series[], i: number) => series[i]?.color ?? SERIES[i];

function Legend({ series }: { series: Series[] }) {
  if (series.length < 2) return null;
  return <div className="legend">{series.map((s, i) => <span key={s.key}><i style={{ background: colorOf(series, i) }} />{s.label}</span>)}</div>;
}

function TableView<T extends object>({ data, xKey, xLabel, series, fmt }: { data: T[]; xKey: string; xLabel: string; series: Series[]; fmt: (n: number) => string }) {
  return (
    <div className="tbl-wrap" style={{ maxHeight: 240, overflowY: 'auto' }}>
      <table className="tbl">
        <thead><tr><th>{xLabel}</th>{series.map((s) => <th key={s.key} className="num">{s.label}</th>)}</tr></thead>
        <tbody>{data.map((d, i) => <tr key={i}><td>{String((d as Record<string, unknown>)[xKey])}</td>{series.map((s) => <td key={s.key} className="num">{fmt(Number((d as Record<string, unknown>)[s.key] ?? 0))}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

function TooltipBox({ active, payload, label, fmt, series }: { active?: boolean; payload?: { dataKey: string; value: number }[]; label?: string; fmt: (n: number) => string; series: Series[] }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: '#fff', border: '1px solid hsl(248 100% 95%)', borderRadius: 12, padding: '8px 12px', fontSize: 14, boxShadow: '0 16px 48px rgba(91,33,182,0.12)' }}>
      <b>{label}</b>
      {payload.map((p) => {
        const i = series.findIndex((s) => s.key === p.dataKey);
        return <div key={p.dataKey}><i style={{ display: 'inline-block', width: 8, height: 8, background: colorOf(series, i), marginRight: 5, borderRadius: 2 }} />{series[i]?.label}: <b>{fmt(p.value)}</b></div>;
      })}
    </div>
  );
}

export function ChartCard({ title, sub, children, table, className }: { title: string; sub?: string; children: ReactNode; table: ReactNode; className?: string }) {
  const [asTable, setAsTable] = useState(false);
  return (
    <section className={`card ${className ?? ''}`}>
      <button className="link-btn toggle-view" onClick={() => setAsTable(!asTable)}>{asTable ? 'Chart view' : 'Table view'}</button>
      <h3>{title}</h3>
      {sub && <p className="sub">{sub}</p>}
      {asTable ? table : children}
    </section>
  );
}

export function BarCard<T extends object>({ title, sub, data, xKey, xLabel, series, stacked, fmt = (n) => n.toLocaleString('en-IN'), horizontal, height = 240, className }: {
  title: string; sub?: string; data: T[]; xKey: string; xLabel: string; series: Series[]; stacked?: boolean; fmt?: (n: number) => string; horizontal?: boolean; height?: number; className?: string;
}) {
  return (
    <ChartCard title={title} sub={sub} className={className} table={<TableView data={data} xKey={xKey} xLabel={xLabel} series={series} fmt={fmt} />}>
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout={horizontal ? 'vertical' : 'horizontal'} margin={{ top: 6, right: 12, bottom: 0, left: horizontal ? 10 : -8 }} barCategoryGap="22%" barGap={2}>
            <CartesianGrid stroke={GRID} vertical={!!horizontal} horizontal={!horizontal} />
            {horizontal ? (
              <>
                <XAxis type="number" tick={AXIS} tickFormatter={fmt} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey={xKey} tick={AXIS} width={150} axisLine={false} tickLine={false} />
              </>
            ) : (
              <>
                <XAxis dataKey={xKey} tick={AXIS} axisLine={{ stroke: 'hsl(248 100% 92%)' }} tickLine={false} interval={0} />
                <YAxis tick={AXIS} tickFormatter={fmt} axisLine={false} tickLine={false} allowDecimals={false} />
              </>
            )}
            <Tooltip cursor={{ fill: 'hsl(257 100% 97% / 0.7)' }} content={<TooltipBox fmt={fmt} series={series} />} />
            {series.map((s, i) => (
              <Bar key={s.key} dataKey={s.key} stackId={stacked ? 'a' : undefined} fill={colorOf(series, i)} stroke="#fff" strokeWidth={stacked ? 1 : 0}
                isAnimationActive={false} radius={stacked ? (i === series.length - 1 ? (horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]) : 0) : horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]} maxBarSize={36} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <Legend series={series} />
    </ChartCard>
  );
}

export function LineCard<T extends object>({ title, sub, data, xKey, xLabel, series, fmt = (n) => n.toLocaleString('en-IN'), height = 240, className }: {
  title: string; sub?: string; data: T[]; xKey: string; xLabel: string; series: Series[]; fmt?: (n: number) => string; height?: number; className?: string;
}) {
  return (
    <ChartCard title={title} sub={sub} className={className} table={<TableView data={data} xKey={xKey} xLabel={xLabel} series={series} fmt={fmt} />}>
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 6, right: 12, bottom: 0, left: -8 }}>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis dataKey={xKey} tick={AXIS} axisLine={{ stroke: 'hsl(248 100% 92%)' }} tickLine={false} />
            <YAxis tick={AXIS} tickFormatter={fmt} axisLine={false} tickLine={false} allowDecimals={false} />
            <Tooltip cursor={{ stroke: '#999', strokeDasharray: '3 3' }} content={<TooltipBox fmt={fmt} series={series} />} />
            {series.map((s, i) => <Line key={s.key} dataKey={s.key} stroke={colorOf(series, i)} strokeWidth={2} dot={{ r: 4, strokeWidth: 2, stroke: '#fff', fill: colorOf(series, i) }} activeDot={{ r: 5 }} isAnimationActive={false} />)}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <Legend series={series} />
    </ChartCard>
  );
}

/** Single-series ranked list with inline bars: a lighter alternative to a chart for top-N. */
export function RankList({ rows, fmt = (n: number) => String(n) }: { rows: { label: ReactNode; value: number; key: string }[]; fmt?: (n: number) => string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <table className="tbl" style={{ background: '#fff' }}>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key}>
            <td style={{ width: '45%' }}>{r.label}</td>
            <td><div className="bar-track"><div className="bar-fill" style={{ width: `${(r.value / max) * 100}%` }} /></div></td>
            <td className="num" style={{ width: 70 }}>{fmt(r.value)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
