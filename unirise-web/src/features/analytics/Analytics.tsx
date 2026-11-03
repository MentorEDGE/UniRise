import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowDownRight, ArrowUpRight, BookOpen, Coins, Download, FlaskConical, Info, Printer, Quote, RotateCcw, Target, Unlock, X } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, LabelList, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "@/lib/api";
import { PUB_TYPES, QUARTILES, type AnalyticsDataset } from "@/mock/analytics";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Select } from "@/components/ui/form";
import { ErrorBanner, Skeleton } from "@/components/ui/feedback";
import { SortHeader, Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { cn, downloadCsv, formatMoney, formatMoneyCompact, formatNumber } from "@/lib/utils";
import {
  byAgency, byDepartment, kpis, periodLabel, periodYears, previousYears, scholarsByStage, selectedYears, topResearchers, trend,
  type DeptRow, type Filters, type Period, type Totals, type TrendRow,
} from "./aggregate";
import { ChartCard, ChartTooltip, Segmented, Sparkline, ToggleLegend, axis, grid, useToggleSet } from "./charts";

const TYPE_COLORS: Record<string, string> = { "Journal article": "var(--viz-1)", "Conference paper": "var(--viz-2)", "Book chapter": "var(--viz-3)", Patent: "var(--viz-4)" };
const QUARTILE_COLORS: Record<string, string> = { Q1: "var(--viz-q1)", Q2: "var(--viz-q2)", Q3: "var(--viz-q3)", Q4: "var(--viz-q4)" };
const OA_TARGET = 60;
const DIM = 0.3;

export const pctFmt = (v: number) => `${v.toFixed(1)}%`;

export default function Analytics() {
  const q = useQuery({ queryKey: ["analytics"], queryFn: api.analytics });
  return (
    <div>
      <Header data={q.data} />
      {q.isError && <ErrorBanner error={q.error} onRetry={() => q.refetch()} />}
      {q.isLoading && <div className="space-y-6"><Skeleton className="h-16 w-full" /><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-32" />)}</div><Skeleton className="h-80 w-full" /></div>}
      {q.data && <Dashboard ds={q.data} />}
    </div>
  );
}

function Header({ data }: { data?: AnalyticsDataset }) {
  return (
    <PageHeader eyebrow="Analytics" title="Research analytics"
      description="Output, quality, funding and doctoral progress across the institution. Pick a period, school or department; click any bar to drill in."
      actions={<Button variant="secondary" className="no-print" disabled={!data} onClick={() => window.print()}><Printer /> Print / PDF</Button>} />
  );
}

/* ----------------------------------------------------------------- filters */

function useFilters(ds: AnalyticsDataset) {
  const [sp, setSp] = useSearchParams();
  const period = (["3y", "5y", "all"].includes(sp.get("period") ?? "") ? sp.get("period") : "5y") as Period;
  const school = ds.departments.some((d) => d.school === sp.get("school")) ? sp.get("school")! : "";
  const deptRaw = sp.get("dept") ?? "";
  const dept = ds.departments.some((d) => d.id === deptRaw && (!school || d.school === school)) ? deptRaw : "";
  const yearRaw = Number(sp.get("year"));
  const year = periodYears(ds, period).includes(yearRaw) ? yearRaw : null;
  const f: Filters = { period, school, dept, year };
  const set = (patch: Partial<Record<keyof Filters, string | number | null>>) => setSp((p) => {
    const n = new URLSearchParams(p);
    for (const [k, v] of Object.entries(patch)) { if (v === null || v === "") n.delete(k); else n.set(k, String(v)); }
    return n;
  }, { replace: true });
  return [f, set] as const;
}

function Dashboard({ ds }: { ds: AnalyticsDataset }) {
  const [f, set] = useFilters(ds);
  const schools = [...new Set(ds.departments.map((d) => d.school))];
  const deptOptions = ds.departments.filter((d) => !f.school || d.school === f.school);
  const deptName = ds.departments.find((d) => d.id === f.dept)?.name;
  const years = periodYears(ds, f.period);
  const sel = selectedYears(ds, f);
  const scopeLabel = deptName ?? (f.school || "Whole institution");
  const yearsLabel = sel.length === 1 ? String(sel[0]) : `${sel[0]}–${sel[sel.length - 1]}`;
  const prev = previousYears(ds, sel);

  const k = kpis(ds, f);
  const t = trend(ds, f);
  const pickYear = (y: number | undefined) => y && set({ year: f.year === y ? null : y });
  const pickDept = (id: string | undefined) => id && set({ dept: f.dept === id ? null : id });
  const filtered = f.school || f.dept || f.year || f.period !== "5y";

  return (
    <div className="space-y-6">
      <p role="note" className="flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/10 p-3 text-sm">
        <Info className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
        <span><strong>Sample data.</strong> Every figure on this page is made up to show how the dashboard will look. Real figures replace them once the reporting service is connected. Figures as of {ds.asOf}.</span>
      </p>

      {/* Filters: one row above all charts. Everything is kept in the URL so a view can be shared. */}
      <Card className="no-print sticky top-[4.5rem] z-30 p-4">
        <div className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-[repeat(4,minmax(0,1fr))_auto]">
          <Field label="Period">{(a) => (
            <Select {...a} value={f.period} onChange={(e) => set({ period: e.target.value, year: null })}>
              {(Object.keys(periodLabel) as Period[]).map((p) => <option key={p} value={p}>{periodLabel[p]} ({periodYears(ds, p)[0]}–{ds.years[ds.years.length - 1]})</option>)}
            </Select>)}</Field>
          <Field label="Year">{(a) => (
            <Select {...a} value={f.year ?? ""} onChange={(e) => set({ year: e.target.value || null })}>
              <option value="">Whole period</option>
              {[...years].reverse().map((y) => <option key={y} value={y}>{y}</option>)}
            </Select>)}</Field>
          <Field label="School">{(a) => (
            <Select {...a} value={f.school} onChange={(e) => set({ school: e.target.value, dept: null })}>
              <option value="">All schools</option>
              {schools.map((s) => <option key={s} value={s}>{s}</option>)}
            </Select>)}</Field>
          <Field label="Department">{(a) => (
            <Select {...a} value={f.dept} onChange={(e) => set({ dept: e.target.value })}>
              <option value="">All departments</option>
              {deptOptions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </Select>)}</Field>
          <Button variant="ghost" disabled={!filtered} onClick={() => set({ period: null, year: null, school: null, dept: null })}><RotateCcw /> Reset</Button>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
          Showing <strong className="text-foreground">{scopeLabel}</strong>, <strong className="text-foreground">{yearsLabel}</strong>
          {prev ? <>, compared with {prev.length === 1 ? prev[0] : `${prev[0]}–${prev[prev.length - 1]}`}</> : <> (no earlier data to compare)</>}
          {f.year && <Chip label={`Year ${f.year}`} onClear={() => set({ year: null })} />}
          {deptName && <Chip label={deptName} onClear={() => set({ dept: null })} />}
        </div>
      </Card>

      <KpiTiles k={k} t={t} focus={f.year} />

      <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        <PublicationsChart t={t} focus={f.year} onPick={pickYear} />
        <ScholarsChart rows={scholarsByStage(ds, f)} />
      </div>

      <DepartmentChart rows={byDepartment(ds, f)} selected={f.dept} onPick={pickDept} yearsLabel={yearsLabel} />

      <div className="grid gap-6 lg:grid-cols-2">
        <FundingChart t={t} focus={f.year} onPick={pickYear} />
        <SuccessRateChart t={t} focus={f.year} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <AgencyChart rows={byAgency(ds, f)} yearsLabel={yearsLabel} />
        <OpenAccessChart t={t} focus={f.year} />
      </div>

      <div className="space-y-6">
        <TopResearchers rows={topResearchers(ds, f)} years={ds.years} focus={f.year} yearsLabel={yearsLabel} />
        <DepartmentTable rows={byDepartment(ds, f)} selected={f.dept} onPick={pickDept} yearsLabel={yearsLabel} />
      </div>
    </div>
  );
}

function Chip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-secondary py-0.5 pl-3 pr-1 text-xs font-semibold text-primary">
      {label}
      <button type="button" onClick={onClear} aria-label={`Clear ${label}`} className="grid size-5 place-items-center rounded-full hover:bg-primary/10"><X className="size-3" aria-hidden /></button>
    </span>
  );
}

/* --------------------------------------------------------------- KPI tiles */

export function KpiTiles({ k, t, focus }: { k: ReturnType<typeof kpis>; t: TrendRow[]; focus: number | null }) {
  const share = (x: Totals, part: (x: Totals) => number, whole: (x: Totals) => number) => (whole(x) ? (part(x) / whole(x)) * 100 : 0);
  const q1 = (x: Totals) => share(x, (y) => y.byQuartile.Q1, (y) => y.byType["Journal article"]);
  const oa = (x: Totals) => share(x, (y) => y.openAccess, (y) => y.publications);
  const sr = (x: Totals) => share(x, (y) => y.grantsSanctioned, (y) => y.grantsApplied);
  const hi = focus ? t.findIndex((r) => r.year === focus) : undefined;
  const tiles = [
    { label: "Publications", icon: BookOpen, value: formatNumber(k.now.publications), now: k.now.publications, before: k.before?.publications, kind: "count" as const, spark: t.map((r) => r.publications), sub: `${(k.now.publications / k.faculty).toFixed(1)} per faculty member` },
    { label: "Citations", icon: Quote, value: formatNumber(k.now.citations), now: k.now.citations, before: k.before?.citations, kind: "count" as const, spark: t.map((r) => r.citations), sub: `${(k.now.citations / Math.max(1, k.now.publications)).toFixed(1)} per paper` },
    { label: "Q1 journal share", icon: Target, value: pctFmt(q1(k.now)), now: q1(k.now), before: k.before && q1(k.before), kind: "points" as const, spark: t.map((r) => r.q1Share), sub: `${formatNumber(k.now.byQuartile.Q1)} Q1 articles` },
    { label: "Open access", icon: Unlock, value: pctFmt(oa(k.now)), now: oa(k.now), before: k.before && oa(k.before), kind: "points" as const, spark: t.map((r) => r.openAccessShare), sub: `Target ${OA_TARGET}%` },
    { label: "Funding sanctioned", icon: Coins, value: formatMoneyCompact(k.now.sanctionedAmount), now: k.now.sanctionedAmount, before: k.before?.sanctionedAmount, kind: "count" as const, spark: t.map((r) => r.funding), sub: `${k.now.grantsSanctioned} grants` },
    { label: "Grant success rate", icon: FlaskConical, value: pctFmt(sr(k.now)), now: sr(k.now), before: k.before && sr(k.before), kind: "points" as const, spark: t.map((r) => r.successRate), sub: `${k.now.grantsSanctioned} of ${k.now.grantsApplied} applications` },
  ];
  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label="Headline figures">
      {tiles.map((x) => {
        const delta = x.before == null ? null : x.kind === "points" ? x.now - x.before : x.before ? ((x.now - x.before) / x.before) * 100 : null;
        const up = (delta ?? 0) >= 0;
        return (
          <li key={x.label}>
            <Card className="flex h-full flex-col p-5">
              <div className="flex items-center gap-2 text-sm text-muted-foreground"><x.icon className="size-4 text-primary" aria-hidden />{x.label}</div>
              <div className="mt-2 text-3xl font-semibold tracking-tight">{x.value}</div>
              {delta !== null ? (
                <p className="mt-1 inline-flex items-center gap-1 text-xs font-semibold" style={{ color: up ? "var(--viz-up)" : "var(--viz-down)" }}>
                  {up ? <ArrowUpRight className="size-3.5" aria-hidden /> : <ArrowDownRight className="size-3.5" aria-hidden />}
                  {up ? "Up" : "Down"} {Math.abs(delta).toFixed(1)}{x.kind === "points" ? " pts" : "%"}
                  <span className="font-normal text-muted-foreground">vs before</span>
                </p>
              ) : <p className="mt-1 text-xs text-muted-foreground">No earlier period</p>}
              <p className="mt-1 text-xs text-muted-foreground">{x.sub}</p>
              <Sparkline values={x.spark} highlight={hi !== undefined && hi >= 0 ? hi : undefined} className="mt-auto pt-3" />
            </Card>
          </li>
        );
      })}
    </ul>
  );
}

/* ------------------------------------------------------------------ charts */

type PickYear = (y: number | undefined) => void;
const yearOf = (d: unknown) => (d as { payload?: { year?: number } })?.payload?.year;
const dim = (focus: number | null, year: number) => (focus && focus !== year ? DIM : 1);

function PublicationsChart({ t, focus, onPick }: { t: TrendRow[]; focus: number | null; onPick: PickYear }) {
  const [mode, setMode] = useState<"type" | "quartile">("type");
  const [hidden, toggle] = useToggleSet();
  const keys: readonly string[] = mode === "type" ? PUB_TYPES : QUARTILES;
  const colors = mode === "type" ? TYPE_COLORS : QUARTILE_COLORS;
  const visible = keys.filter((k) => !hidden.has(k));
  const top = visible[visible.length - 1];
  return (
    <ChartCard title="Publications by year"
      description={mode === "type" ? "Verified publications, by type. Click a bar to focus that year." : "Journal articles by the journal's quartile (Q1 is the strongest). Click a bar to focus that year."}
      actions={<Segmented label="Break down by" value={mode} onChange={setMode} options={[{ value: "type", label: "By type" }, { value: "quartile", label: "By quartile" }]} />}
      table={<Table><THead><tr><TH>Year</TH>{keys.map((k) => <TH key={k} className="text-right">{k}</TH>)}</tr></THead>
        <TBody>{t.map((r) => <TR key={r.year}><TD>{r.year}</TD>{keys.map((k) => <TD key={k} className="text-right tabular-nums">{formatNumber(r[k as keyof TrendRow] as number)}</TD>)}</TR>)}</TBody></Table>}>
      <ToggleLegend series={keys.map((k) => ({ key: k, color: colors[k] }))} hidden={hidden} onToggle={toggle} />
      <div className="h-72" role="img" aria-label={`Stacked bar chart of publications per year ${mode === "type" ? "by type" : "by journal quartile"}. The table view has the same figures.`}>
        <ResponsiveContainer>
          <BarChart data={t} barCategoryGap="22%">
            <CartesianGrid {...grid} vertical={false} />
            <XAxis dataKey="year" {...axis} />
            <YAxis {...axis} width={40} allowDecimals={false} />
            <Tooltip cursor={{ fill: "hsl(var(--secondary))" }} content={<ChartTooltip total />} />
            {keys.map((k) => (
              <Bar key={k} dataKey={k} name={k} stackId="s" fill={colors[k]} hide={hidden.has(k)} stroke="hsl(var(--card))" strokeWidth={2}
                radius={k === top ? [4, 4, 0, 0] : 0} onClick={(d) => onPick(yearOf(d))} className="cursor-pointer">
                {t.map((r) => <Cell key={r.year} fillOpacity={dim(focus, r.year)} />)}
              </Bar>
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

export function ScholarsChart({ rows }: { rows: { stage: string; count: number }[] }) {
  const total = rows.reduce((s, r) => s + r.count, 0);
  return (
    <ChartCard title="PhD scholars by stage" description={`${formatNumber(total)} scholars currently enrolled, by the stage they are in.`}
      table={<Table><THead><tr><TH>Stage</TH><TH className="text-right">Scholars</TH></tr></THead><TBody>{rows.map((r) => <TR key={r.stage}><TD>{r.stage}</TD><TD className="text-right tabular-nums">{r.count}</TD></TR>)}</TBody></Table>}>
      <div className="h-[19.5rem]" role="img" aria-label={`Bar chart of PhD scholars by stage: ${rows.map((r) => `${r.stage} ${r.count}`).join(", ")}.`}>
        <ResponsiveContainer>
          <BarChart data={rows} layout="vertical" margin={{ right: 36 }}>
            <CartesianGrid {...grid} horizontal={false} />
            <XAxis type="number" {...axis} allowDecimals={false} />
            <YAxis type="category" dataKey="stage" {...axis} width={140} />
            <Tooltip cursor={{ fill: "hsl(var(--secondary))" }} content={<ChartTooltip />} />
            <Bar dataKey="count" name="Scholars" fill="var(--viz-1)" radius={[0, 4, 4, 0]} barSize={22}>
              <LabelList dataKey="count" position="right" fontSize={12} fill="hsl(var(--foreground))" />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

type DeptMetric = "publications" | "perFaculty" | "citations" | "q1Share" | "funding";
const deptMetrics: { value: DeptMetric; label: string; fmt: (v: number) => string }[] = [
  { value: "publications", label: "Publications", fmt: formatNumber },
  { value: "perFaculty", label: "Per faculty / yr", fmt: (v) => v.toFixed(2) },
  { value: "citations", label: "Citations", fmt: formatNumber },
  { value: "q1Share", label: "Q1 share", fmt: pctFmt },
  { value: "funding", label: "Funding", fmt: formatMoneyCompact },
];

function DepartmentChart({ rows, selected, onPick, yearsLabel }: { rows: DeptRow[]; selected: string; onPick: (id: string | undefined) => void; yearsLabel: string }) {
  const [metric, setMetric] = useState<DeptMetric>("publications");
  const m = deptMetrics.find((x) => x.value === metric)!;
  const data = [...rows].sort((a, b) => b[metric] - a[metric]);
  const median = (() => { const s = data.map((d) => d[metric]).sort((a, b) => a - b); const i = Math.floor(s.length / 2); return s.length % 2 ? s[i] : (s[i - 1] + s[i]) / 2; })();
  return (
    <ChartCard title="Department comparison" description={<>{m.label} by department, {yearsLabel}. The dashed line is the median department. Click a department to filter the whole page.</>}
      actions={<Segmented label="Measure" value={metric} onChange={setMetric} options={deptMetrics.map(({ value, label }) => ({ value, label }))} />}
      table={<Table><THead><tr><TH>Department</TH><TH className="text-right">{m.label}</TH></tr></THead><TBody>{data.map((d) => <TR key={d.id}><TD>{d.name}</TD><TD className="text-right tabular-nums">{m.fmt(d[metric])}</TD></TR>)}</TBody></Table>}>
      <div style={{ height: Math.max(180, data.length * 44 + 40) }} role="img" aria-label={`Bar chart of ${m.label} by department, highest first. The table view has the same figures.`}>
        <ResponsiveContainer>
          <BarChart data={data} layout="vertical" margin={{ right: 64 }}>
            <CartesianGrid {...grid} horizontal={false} />
            <XAxis type="number" {...axis} tickFormatter={(v: number) => m.fmt(v)} />
            <YAxis type="category" dataKey="name" {...axis} width={190} />
            <Tooltip cursor={{ fill: "hsl(var(--secondary))" }} content={<ChartTooltip format={m.fmt} />} />
            {data.length > 2 && <ReferenceLine x={median} stroke="hsl(var(--muted-foreground))" strokeDasharray="4 4" />}
            <Bar dataKey={metric} name={m.label} fill="var(--viz-1)" radius={[0, 4, 4, 0]} barSize={24} className="cursor-pointer"
              onClick={(d) => onPick((d as { payload?: DeptRow }).payload?.id)}>
              {data.map((d) => <Cell key={d.id} fillOpacity={selected && selected !== d.id ? DIM : 1} />)}
              <LabelList dataKey={metric} position="right" fontSize={12} fill="hsl(var(--foreground))" formatter={(v: unknown) => m.fmt(Number(v))} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

function FundingChart({ t, focus, onPick }: { t: TrendRow[]; focus: number | null; onPick: PickYear }) {
  return (
    <ChartCard title="Funding sanctioned by year" description="Total amount of grants sanctioned. Click a bar to focus that year."
      table={<Table><THead><tr><TH>Year</TH><TH className="text-right">Sanctioned</TH></tr></THead><TBody>{t.map((r) => <TR key={r.year}><TD>{r.year}</TD><TD className="text-right tabular-nums">{formatMoney(r.funding)}</TD></TR>)}</TBody></Table>}>
      <div className="h-64" role="img" aria-label="Bar chart of funding sanctioned per year. The table view has the same figures.">
        <ResponsiveContainer>
          <BarChart data={t}>
            <CartesianGrid {...grid} vertical={false} />
            <XAxis dataKey="year" {...axis} />
            <YAxis {...axis} width={64} tickFormatter={(v: number) => formatMoneyCompact(v)} />
            <Tooltip cursor={{ fill: "hsl(var(--secondary))" }} content={<ChartTooltip format={formatMoney} />} />
            <Bar dataKey="funding" name="Sanctioned" fill="var(--viz-1)" radius={[4, 4, 0, 0]} className="cursor-pointer" onClick={(d) => onPick(yearOf(d))}>
              {t.map((r) => <Cell key={r.year} fillOpacity={dim(focus, r.year)} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

function SuccessRateChart({ t, focus }: { t: TrendRow[]; focus: number | null }) {
  return (
    <ChartCard title="Grant success rate" description="Share of grant applications that were sanctioned, by year applied."
      table={<Table><THead><tr><TH>Year</TH><TH className="text-right">Success rate</TH></tr></THead><TBody>{t.map((r) => <TR key={r.year}><TD>{r.year}</TD><TD className="text-right tabular-nums">{pctFmt(r.successRate)}</TD></TR>)}</TBody></Table>}>
      <div className="h-64" role="img" aria-label="Line chart of grant success rate per year. The table view has the same figures.">
        <ResponsiveContainer>
          <LineChart data={t} margin={{ top: 8, right: 12 }}>
            <CartesianGrid {...grid} vertical={false} />
            <XAxis dataKey="year" {...axis} padding={{ left: 12, right: 12 }} />
            <YAxis {...axis} width={44} domain={[0, "auto"]} tickFormatter={(v: number) => `${v}%`} />
            <Tooltip cursor={{ stroke: "hsl(var(--muted-foreground))", strokeDasharray: "3 3" }} content={<ChartTooltip format={pctFmt} />} />
            {focus && <ReferenceLine x={focus} stroke="hsl(var(--primary))" strokeDasharray="3 3" />}
            <Line type="monotone" dataKey="successRate" name="Success rate" stroke="var(--viz-1)" strokeWidth={2}
              dot={{ r: 4, fill: "var(--viz-1)", stroke: "hsl(var(--card))", strokeWidth: 2 }} activeDot={{ r: 6, stroke: "hsl(var(--card))", strokeWidth: 2 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

export function AgencyChart({ rows, yearsLabel }: { rows: { agency: string; amount: number }[]; yearsLabel: string }) {
  const total = rows.reduce((s, r) => s + r.amount, 0);
  return (
    <ChartCard title="Funding by agency" description={`Where sanctioned money came from, ${yearsLabel}. ${formatMoneyCompact(total)} in all.`}
      table={<Table><THead><tr><TH>Agency</TH><TH className="text-right">Sanctioned</TH><TH className="text-right">Share</TH></tr></THead><TBody>{rows.map((r) => <TR key={r.agency}><TD>{r.agency}</TD><TD className="text-right tabular-nums">{formatMoney(r.amount)}</TD><TD className="text-right tabular-nums">{pctFmt(total ? (r.amount / total) * 100 : 0)}</TD></TR>)}</TBody></Table>}>
      <div className="h-72" role="img" aria-label={`Bar chart of funding by agency, largest first: ${rows.map((r) => `${r.agency} ${formatMoneyCompact(r.amount)}`).join(", ")}.`}>
        <ResponsiveContainer>
          <BarChart data={rows} layout="vertical" margin={{ right: 72 }}>
            <CartesianGrid {...grid} horizontal={false} />
            <XAxis type="number" {...axis} tickFormatter={(v: number) => formatMoneyCompact(v)} />
            <YAxis type="category" dataKey="agency" {...axis} width={96} />
            <Tooltip cursor={{ fill: "hsl(var(--secondary))" }} content={<ChartTooltip format={formatMoney} />} />
            <Bar dataKey="amount" name="Sanctioned" fill="var(--viz-1)" radius={[0, 4, 4, 0]} barSize={22}>
              <LabelList dataKey="amount" position="right" fontSize={12} fill="hsl(var(--foreground))" formatter={(v: unknown) => formatMoneyCompact(Number(v))} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

function OpenAccessChart({ t, focus }: { t: TrendRow[]; focus: number | null }) {
  return (
    <ChartCard title="Open-access share" description={`Share of publications that are open access, against the ${OA_TARGET}% target.`}
      table={<Table><THead><tr><TH>Year</TH><TH className="text-right">Open access</TH></tr></THead><TBody>{t.map((r) => <TR key={r.year}><TD>{r.year}</TD><TD className="text-right tabular-nums">{pctFmt(r.openAccessShare)}</TD></TR>)}</TBody></Table>}>
      <div className="h-72" role="img" aria-label="Line chart of open-access share per year with the target marked. The table view has the same figures.">
        <ResponsiveContainer>
          <LineChart data={t} margin={{ top: 16, right: 12 }}>
            <CartesianGrid {...grid} vertical={false} />
            <XAxis dataKey="year" {...axis} padding={{ left: 12, right: 12 }} />
            <YAxis {...axis} width={44} domain={[0, 100]} tickFormatter={(v: number) => `${v}%`} />
            <Tooltip cursor={{ stroke: "hsl(var(--muted-foreground))", strokeDasharray: "3 3" }} content={<ChartTooltip format={pctFmt} />} />
            <ReferenceLine y={OA_TARGET} stroke="hsl(var(--muted-foreground))" strokeDasharray="4 4"
              label={{ value: `Target ${OA_TARGET}%`, position: "insideTopLeft", fontSize: 12, fill: "hsl(var(--muted-foreground))" }} />
            {focus && <ReferenceLine x={focus} stroke="hsl(var(--primary))" strokeDasharray="3 3" />}
            <Line type="monotone" dataKey="openAccessShare" name="Open access" stroke="var(--viz-1)" strokeWidth={2}
              dot={{ r: 4, fill: "var(--viz-1)", stroke: "hsl(var(--card))", strokeWidth: 2 }} activeDot={{ r: 6, stroke: "hsl(var(--card))", strokeWidth: 2 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

/* ------------------------------------------------------------------ tables */

function useSort<T>(rows: T[], initial: string) {
  const [sort, setSort] = useState(initial);
  const [key, dir] = sort.split(":") as [keyof T, "asc" | "desc"];
  const sorted = [...rows].sort((a, b) => {
    const x = a[key], y = b[key];
    const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
    return dir === "asc" ? c : -c;
  });
  return [sorted, sort, setSort] as const;
}

function TopResearchers({ rows, years, focus, yearsLabel }: { rows: ReturnType<typeof topResearchers>; years: number[]; focus: number | null; yearsLabel: string }) {
  const [sorted, sort, setSort] = useSort(rows, "publications:desc");
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? sorted : sorted.slice(0, 8);
  const hi = focus ? years.indexOf(focus) : undefined;
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 px-6 pt-6 md:px-8 md:pt-8">
        <div><h3 className="text-lg font-semibold tracking-tight md:text-xl">Top researchers</h3>
          <p className="mt-1 text-sm text-muted-foreground">{yearsLabel}. Click a column to re-rank. The line shows publications per year since {years[0]}.</p></div>
      </div>
      <div className="mt-4">
        <Table>
          <THead><tr>
            <TH className="w-8">#</TH>
            <SortHeader label="Researcher" field="name" sort={sort} onSort={setSort} />
            <SortHeader label="Pubs" field="publications" sort={sort} onSort={setSort} />
            <SortHeader label="Citations" field="citations" sort={sort} onSort={setSort} />
            <SortHeader label="h-index" field="hIndex" sort={sort} onSort={setSort} />
            <TH className="hidden w-28 sm:table-cell">Trend</TH>
          </tr></THead>
          <TBody>{shown.map((r, i) => (
            <TR key={r.id}>
              <TD className="text-muted-foreground">{i + 1}</TD>
              <TD><p className="font-medium">{r.name}</p><p className="text-xs text-muted-foreground">{r.designation} · {r.department}</p></TD>
              <TD className="tabular-nums">{r.publications}</TD>
              <TD className="tabular-nums">{formatNumber(r.citations)}</TD>
              <TD className="tabular-nums">{r.hIndex}</TD>
              <TD className="hidden sm:table-cell"><Sparkline values={r.spark} highlight={hi !== undefined && hi >= 0 ? hi : undefined} /></TD>
            </TR>))}
          </TBody>
        </Table>
        {sorted.length > 8 && (
          <div className="border-t px-6 py-3 text-center"><Button variant="ghost" size="sm" onClick={() => setShowAll((v) => !v)}>{showAll ? "Show top 8" : `Show all ${sorted.length}`}</Button></div>
        )}
      </div>
    </Card>
  );
}

function DepartmentTable({ rows, selected, onPick, yearsLabel }: { rows: DeptRow[]; selected: string; onPick: (id: string) => void; yearsLabel: string }) {
  const [sorted, sort, setSort] = useSort(rows, "publications:desc");
  const exportCsv = () => downloadCsv(`department-summary-${yearsLabel}.csv`,
    ["Department", "School", "Faculty", "Publications", "Per faculty per year", "Citations", "Q1 share (%)", "Open access (%)", "Funding (INR)", "Grant success (%)"],
    sorted.map((d) => [d.name, d.school, d.faculty, d.publications, d.perFaculty, d.citations, d.q1Share, d.openAccessShare, d.funding, d.successRate]));
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 px-6 pt-6 md:px-8 md:pt-8">
        <div><h3 className="text-lg font-semibold tracking-tight md:text-xl">Department summary</h3>
          <p className="mt-1 text-sm text-muted-foreground">{yearsLabel}. Click a row to filter the page to that department.</p></div>
        <Button size="sm" variant="secondary" className="no-print" onClick={exportCsv}><Download /> Export CSV</Button>
      </div>
      <div className="mt-4">
        <Table>
          <THead><tr>
            <SortHeader label="Department" field="name" sort={sort} onSort={setSort} />
            <SortHeader label="Pubs" field="publications" sort={sort} onSort={setSort} />
            <SortHeader label="Citations" field="citations" sort={sort} onSort={setSort} />
            <SortHeader label="Q1 %" field="q1Share" sort={sort} onSort={setSort} />
            <SortHeader label="OA %" field="openAccessShare" sort={sort} onSort={setSort} />
            <SortHeader label="Funding" field="funding" sort={sort} onSort={setSort} />
            <SortHeader label="Success" field="successRate" sort={sort} onSort={setSort} />
          </tr></THead>
          <TBody>{sorted.map((d) => (
            <TR key={d.id} className={cn("cursor-pointer", selected === d.id && "bg-secondary/70")} onClick={() => onPick(d.id)}>
              <TD><button type="button" className="text-left font-medium hover:text-primary" aria-pressed={selected === d.id} onClick={(e) => { e.stopPropagation(); onPick(d.id); }}>{d.name}</button>
                <p className="text-xs text-muted-foreground">{d.faculty} faculty</p></TD>
              <TD className="tabular-nums">{formatNumber(d.publications)}</TD>
              <TD className="tabular-nums">{formatNumber(d.citations)}</TD>
              <TD className="tabular-nums">{d.q1Share.toFixed(1)}</TD>
              <TD className="tabular-nums">{d.openAccessShare.toFixed(1)}</TD>
              <TD className="whitespace-nowrap tabular-nums">{formatMoneyCompact(d.funding)}</TD>
              <TD className="tabular-nums">{pctFmt(d.successRate)}</TD>
            </TR>))}
          </TBody>
        </Table>
      </div>
    </Card>
  );
}
