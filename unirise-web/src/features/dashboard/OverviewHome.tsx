import { useState, type CSSProperties } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowDownRight, ArrowRight, ArrowUpRight, BookOpen, Coins, FlaskConical, Quote, Sparkles } from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "@/lib/api";
import type { AnalyticsDataset } from "@/mock/analytics";
import { Card } from "@/components/ui/card";
import { ErrorBanner, Skeleton } from "@/components/ui/feedback";
import { cn, formatMoney, formatMoneyCompact, formatNumber } from "@/lib/utils";
import { kpis, pct, periodLabel, periodYears, trend, type Filters, type Period, type Totals } from "@/features/analytics/aggregate";
import { ChartCard, ChartTooltip, Segmented, Sparkline, axis, grid } from "@/features/analytics/charts";
import { pctFmt } from "@/features/analytics/Analytics";

/** Home for the research office and unit heads: four headline numbers, one trend, the schools. Everything else lives in Analytics. */
export function OverviewHome() {
  const q = useQuery({ queryKey: ["analytics"], queryFn: api.analytics });
  const [period, setPeriod] = useState<Period>("5y");
  if (q.isError) return <ErrorBanner error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) return <div className="space-y-6"><Skeleton className="h-28 w-full" /><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-36" />)}</div><Skeleton className="h-80 w-full" /></div>;
  return <Overview ds={q.data} period={period} setPeriod={setPeriod} />;
}

/* The four measures on Home. Each keeps its colour on the tile, the sparkline and the trend chart. */
type Metric = "publications" | "citations" | "funding" | "successRate";
const METRICS: { key: Metric; label: string; short: string; icon: typeof BookOpen; color: string; fmt: (v: number) => string; axisFmt: (v: number) => string; points?: boolean }[] = [
  { key: "publications", label: "Publications", short: "Publications", icon: BookOpen, color: "var(--viz-1)", fmt: formatNumber, axisFmt: formatNumber },
  { key: "citations", label: "Citations", short: "Citations", icon: Quote, color: "var(--viz-2)", fmt: formatNumber, axisFmt: (v) => (v >= 1000 ? `${Math.round(v / 100) / 10}k` : String(v)) },
  { key: "funding", label: "Funding sanctioned", short: "Funding", icon: Coins, color: "var(--viz-3)", fmt: formatMoney, axisFmt: formatMoneyCompact },
  { key: "successRate", label: "Grant success rate", short: "Success rate", icon: FlaskConical, color: "var(--viz-4)", fmt: pctFmt, axisFmt: (v) => `${v}%`, points: true },
];
const valueOf = (t: Totals, m: Metric) =>
  m === "publications" ? t.publications : m === "citations" ? t.citations : m === "funding" ? t.sanctionedAmount : pct(t.grantsSanctioned, t.grantsApplied);
const SCHOOL_COLORS = ["var(--viz-1)", "var(--viz-2)", "var(--viz-3)"];
const tint = (c: string, p = 14) => `color-mix(in srgb, ${c} ${p}%, transparent)`;
const BRAND = "hsl(263 70% 42%)";

function Overview({ ds, period, setPeriod }: { ds: AnalyticsDataset; period: Period; setPeriod: (p: Period) => void }) {
  const [metric, setMetric] = useState<Metric>("publications");
  const f: Filters = { period, school: "", dept: "", year: null };
  const years = periodYears(ds, period);
  const yearsLabel = `${years[0]}–${years[years.length - 1]}`;
  const k = kpis(ds, f);
  const t = trend(ds, f);
  const growth = k.before ? ((k.now.publications - k.before.publications) / k.before.publications) * 100 : null;

  return (
    <div className="space-y-6">
      {/* Brand-gradient summary band */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[hsl(263_70%_42%)] via-[hsl(268_72%_52%)] to-[hsl(318_70%_50%)] p-6 text-white shadow-[0_18px_40px_hsl(263_70%_42%/0.28)] md:p-8">
        <div className="pointer-events-none absolute -right-16 -top-20 size-64 rounded-full bg-white/10 blur-2xl" aria-hidden />
        <div className="pointer-events-none absolute -bottom-24 right-40 size-56 rounded-full bg-pink-300/20 blur-2xl" aria-hidden />
        <div className="relative flex flex-wrap items-end justify-between gap-5">
          <div className="max-w-2xl">
            <p className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.2em] text-white/80"><Sparkles className="size-3.5" aria-hidden />Research pulse · {yearsLabel}</p>
            <p className="mt-2 text-xl font-semibold leading-snug md:text-2xl">
              {formatNumber(k.now.publications)} publications and {formatMoneyCompact(k.now.sanctionedAmount)} in sanctioned grants
              {growth !== null && <>, output {growth >= 0 ? "up" : "down"} {Math.abs(growth).toFixed(0)}% on the {years.length} years before</>}.
            </p>
            <p className="mt-2 text-xs text-white/75">Sample data, to show how Home will look once real figures flow in.</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div role="radiogroup" aria-label="Period" className="inline-flex rounded-xl bg-white/15 p-0.5 backdrop-blur">
              {(Object.keys(periodLabel) as Period[]).map((p) => (
                <button key={p} type="button" role="radio" aria-checked={period === p} onClick={() => setPeriod(p)}
                  className={cn("rounded-[0.6rem] px-3 py-1.5 text-xs font-semibold transition-colors", period === p ? "bg-white" : "text-white/85 hover:text-white")}
                  style={period === p ? { color: BRAND } : undefined}>
                  {periodLabel[p]}
                </button>
              ))}
            </div>
            <Link to={`/analytics?period=${period}`} style={{ color: BRAND }}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-white px-4 text-sm font-semibold shadow-lg transition-transform active:scale-[0.98]">
              Full analytics <ArrowRight className="size-4" aria-hidden />
            </Link>
          </div>
        </div>
      </div>

      {/* Four tiles; picking one switches the trend chart below */}
      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Headline figures">
        {METRICS.map((m) => {
          const now = valueOf(k.now, m.key);
          const before = k.before ? valueOf(k.before, m.key) : null;
          const delta = before === null ? null : m.points ? now - before : before ? ((now - before) / before) * 100 : null;
          const up = (delta ?? 0) >= 0;
          const active = metric === m.key;
          return (
            <li key={m.key}>
              <button type="button" aria-pressed={active} onClick={() => setMetric(m.key)}
                className={cn("surface-card surface-card-hover relative flex h-full w-full flex-col overflow-hidden p-5 text-left", active && "ring-2 ring-offset-2 ring-offset-background")}
                style={active ? ({ "--tw-ring-color": m.color } as CSSProperties) : undefined}>
                <span className="absolute inset-x-0 top-0 h-1" style={{ background: m.color }} aria-hidden />
                <div className="flex items-center gap-3">
                  <span className="grid size-10 place-items-center rounded-xl" style={{ background: tint(m.color), color: m.color }}><m.icon className="size-5" aria-hidden /></span>
                  <span className="text-sm font-medium text-muted-foreground">{m.label}</span>
                </div>
                <div className="mt-4 text-3xl font-semibold tracking-tight">{m.key === "funding" ? formatMoneyCompact(now) : m.fmt(now)}</div>
                {delta !== null && (
                  <p className="mt-1 inline-flex items-center gap-1 text-xs font-semibold" style={{ color: up ? "var(--viz-up)" : "var(--viz-down)" }}>
                    {up ? <ArrowUpRight className="size-3.5" aria-hidden /> : <ArrowDownRight className="size-3.5" aria-hidden />}
                    {up ? "Up" : "Down"} {Math.abs(delta).toFixed(1)}{m.points ? " pts" : "%"}<span className="font-normal text-muted-foreground">vs before</span>
                  </p>
                )}
                <Sparkline values={t.map((r) => r[m.key])} color={m.color} className="mt-auto pt-4" />
              </button>
            </li>
          );
        })}
      </ul>

      <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        <TrendCard t={t} period={period} metric={metric} setMetric={setMetric} />
        <SchoolsCard ds={ds} f={f} yearsLabel={yearsLabel} />
      </div>
    </div>
  );
}

function TrendCard({ t, period, metric, setMetric }: { t: ReturnType<typeof trend>; period: Period; metric: Metric; setMetric: (m: Metric) => void }) {
  const nav = useNavigate();
  const m = METRICS.find((x) => x.key === metric)!;
  const gid = `home-trend-${metric}`;
  return (
    <ChartCard title="How we are trending" description="Pick a measure here or on a tile. Click a point to open that year in Analytics."
      actions={<Segmented label="Measure" value={metric} onChange={setMetric} options={METRICS.map((x) => ({ value: x.key, label: x.short }))} />}>
      <div className="h-72" role="img" aria-label={`Area chart of ${m.label} per year: ${t.map((r) => `${r.year} ${m.fmt(r[metric])}`).join(", ")}.`}>
        <ResponsiveContainer>
          <AreaChart data={t} margin={{ top: 8, right: 12 }}
            onClick={(s) => { const y = Number((s as { activeLabel?: string | number })?.activeLabel); if (y) nav(`/analytics?period=${period}&year=${y}`); }}>
            <defs>
              <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={m.color} stopOpacity={0.35} />
                <stop offset="100%" stopColor={m.color} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid {...grid} vertical={false} />
            <XAxis dataKey="year" {...axis} padding={{ left: 12, right: 12 }} />
            <YAxis {...axis} width={64} tickFormatter={m.axisFmt} domain={[0, "auto"]} />
            <Tooltip cursor={{ stroke: "hsl(var(--muted-foreground))", strokeDasharray: "3 3" }} content={<ChartTooltip format={m.fmt} />} />
            <Area key={metric} type="monotone" dataKey={metric} name={m.label} stroke={m.color} strokeWidth={2.5} fill={`url(#${gid})`}
              dot={{ r: 4, fill: m.color, stroke: "hsl(var(--card))", strokeWidth: 2 }} activeDot={{ r: 7, fill: m.color, stroke: "hsl(var(--card))", strokeWidth: 2, className: "cursor-pointer" }} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

function SchoolsCard({ ds, f, yearsLabel }: { ds: AnalyticsDataset; f: Filters; yearsLabel: string }) {
  const schools = [...new Set(ds.departments.map((d) => d.school))].map((school, i) => {
    const k = kpis(ds, { ...f, school });
    return { school, color: SCHOOL_COLORS[i % SCHOOL_COLORS.length], publications: k.now.publications, funding: k.now.sanctionedAmount, faculty: k.faculty };
  });
  const total = schools.reduce((s, x) => s + x.publications, 0);
  return (
    <Card className="flex flex-col p-6 md:p-8">
      <h3 className="text-lg font-semibold tracking-tight md:text-xl">Schools</h3>
      <p className="mt-1 text-sm text-muted-foreground">Share of {formatNumber(total)} publications, {yearsLabel}. Open one to see its departments.</p>
      {/* One bar split by school; the list below names each part */}
      <div className="mt-5 flex h-3 gap-0.5 overflow-hidden rounded-full" aria-hidden>
        {schools.map((s) => <span key={s.school} className="h-full transition-[width] duration-700 ease-out-strong" style={{ width: `${(s.publications / total) * 100}%`, background: s.color }} />)}
      </div>
      <ul className="mt-5 flex-1 space-y-2">
        {schools.map((s) => (
          <li key={s.school}>
            <Link to={`/analytics?period=${f.period}&school=${encodeURIComponent(s.school)}`}
              className="group flex items-center gap-3 rounded-xl p-3 transition-colors hover:bg-secondary/60">
              <span className="size-3 shrink-0 rounded-full" style={{ background: s.color }} aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium group-hover:text-primary">{s.school}</span>
                <span className="block text-xs text-muted-foreground">{formatNumber(s.publications)} publications · {formatMoneyCompact(s.funding)} · {s.faculty} faculty</span>
              </span>
              <span className="text-sm font-semibold tabular-nums">{pctFmt((s.publications / total) * 100)}</span>
              <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
