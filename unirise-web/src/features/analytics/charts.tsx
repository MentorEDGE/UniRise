import { useState, type ReactNode } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/** Recessive axis styling shared by every chart. */
export const axis = { tickLine: false, axisLine: false, fontSize: 12, stroke: "hsl(var(--muted-foreground))" } as const;
export const grid = { strokeDasharray: "3 3", stroke: "hsl(var(--border))" } as const;

interface TipEntry { name?: string | number; value?: number | string | (number | string)[]; color?: string; fill?: string; stroke?: string; dataKey?: unknown }
interface TipProps { active?: boolean; payload?: readonly TipEntry[]; label?: string | number; format?: (v: number) => string; total?: boolean; labelPrefix?: string }

/** Card-styled tooltip. Values in text colour; the swatch carries the series identity. */
export function ChartTooltip({ active, payload, label, format = (v) => v.toLocaleString(), total, labelPrefix = "" }: TipProps) {
  if (!active || !payload?.length) return null;
  const items = payload.filter((p) => typeof p.value === "number");
  const sum = items.reduce((s, p) => s + (p.value as number), 0);
  return (
    <div className="min-w-44 rounded-xl border bg-card px-3 py-2.5 text-sm shadow-lg">
      <p className="mb-1.5 font-semibold">{labelPrefix}{label}</p>
      <ul className="space-y-1">
        {[...items].reverse().map((p) => (
          <li key={String(p.dataKey ?? p.name)} className="flex items-center gap-2">
            <span className="size-2.5 shrink-0 rounded-sm" style={{ background: p.color ?? p.fill ?? p.stroke }} aria-hidden />
            <span className="flex-1 text-muted-foreground">{p.name}</span>
            <span className="font-medium tabular-nums">{format(p.value as number)}</span>
          </li>
        ))}
      </ul>
      {total && items.length > 1 && (
        <p className="mt-1.5 flex justify-between border-t pt-1.5 font-semibold"><span>Total</span><span className="tabular-nums">{format(sum)}</span></p>
      )}
    </div>
  );
}

/** Legend that doubles as a series toggle. Hidden series keep their colour so nothing repaints. */
export function ToggleLegend({ series, hidden, onToggle }: { series: { key: string; color: string }[]; hidden: Set<string>; onToggle: (key: string) => void }) {
  return (
    <ul className="mb-3 flex flex-wrap gap-2" aria-label="Series">
      {series.map((s) => {
        const off = hidden.has(s.key);
        return (
          <li key={s.key}>
            <button type="button" aria-pressed={!off} onClick={() => onToggle(s.key)}
              className={cn("inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium transition-colors hover:bg-secondary/60", off && "text-muted-foreground line-through opacity-60")}>
              <span className="size-2.5 rounded-sm" style={{ background: s.color }} aria-hidden />{s.key}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function useToggleSet() {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const toggle = (k: string) => setHidden((h) => { const n = new Set(h); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  return [hidden, toggle] as const;
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-xl border bg-background p-0.5">
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)}
          className={cn("rounded-[0.6rem] px-3 py-1.5 text-xs font-semibold transition-colors", value === o.value ? "bg-secondary text-primary" : "text-muted-foreground hover:text-foreground")}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Tiny trend line for tiles and table rows. The last point (or the picked one) gets a dot. */
export function Sparkline({ values, highlight, className, color = "var(--viz-1)" }: { values: number[]; highlight?: number; className?: string; color?: string }) {
  if (values.length < 2) return null;
  const w = 100, h = 28, pad = 3;
  const min = Math.min(...values), max = Math.max(...values);
  const y = (v: number) => h - pad - ((v - min) / (max - min || 1)) * (h - pad * 2);
  const x = (i: number) => pad + (i / (values.length - 1)) * (w - pad * 2);
  const d = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const hi = highlight ?? values.length - 1;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className={cn("h-7 w-full overflow-visible", className)} aria-hidden>
      <path d={d} fill="none" stroke={color} strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(hi)} cy={y(values[hi])} r={3} fill={color} stroke="hsl(var(--card))" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** Chart card with an optional "view as table" so no figure lives in colour alone. */
export function ChartCard({ title, description, actions, children, table, className }: {
  title: string; description?: ReactNode; actions?: ReactNode; children: ReactNode; table?: ReactNode; className?: string;
}) {
  return (
    <Card className={cn("flex flex-col", className)}>
      <CardHeader className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0"><CardTitle>{title}</CardTitle>{description && <CardDescription>{description}</CardDescription>}</div>
        {actions && <div className="no-print flex flex-wrap items-center gap-2">{actions}</div>}
      </CardHeader>
      <CardContent className="flex-1 pt-4 md:pt-4">
        {children}
        {table && (
          <details className="mt-3 text-sm">
            <summary className="cursor-pointer text-muted-foreground hover:text-foreground">View as table</summary>
            <div className="mt-2">{table}</div>
          </details>
        )}
      </CardContent>
    </Card>
  );
}
