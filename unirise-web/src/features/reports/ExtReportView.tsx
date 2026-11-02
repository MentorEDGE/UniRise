import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Download, Printer } from "lucide-react";
import { CartesianGrid, Legend, Line, LineChart, Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "@/lib/api";
import { useAuth } from "@/app/auth";
import { formatMoney } from "@/lib/utils";
import { analyticsReports, templateReports } from "@/lib/reportDefs";
import type { ExtReportSlug, ReportSection } from "@/mock/ext/reporting";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";
import { ErrorBanner, Skeleton } from "@/components/ui/feedback";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { ExportDialog } from "./ExportDialog";
import { SaveReportButton } from "./SaveReportButton";

const COLORS = ["hsl(var(--primary))", "hsl(var(--accent))", "#16a34a", "#d97706"];
const money = (c: string) => c.includes("(INR)");

function Chart({ section }: { section: ReportSection }) {
  const c = section.chart!;
  const data = section.table.rows.map((r) => Object.fromEntries(section.table.columns.map((col, i) => [col, typeof r[i] === "number" ? r[i] : Number.isNaN(Number(r[i])) ? r[i] : Number(r[i])])));
  const common = (
    <>
      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
      <XAxis dataKey={c.x} tickLine={false} axisLine={false} fontSize={12} stroke="hsl(var(--muted-foreground))" />
      <YAxis tickLine={false} axisLine={false} fontSize={12} width={32} stroke="hsl(var(--muted-foreground))" />
      <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid hsl(var(--border))", background: "hsl(var(--card))", color: "hsl(var(--foreground))" }} />
      <Legend />
    </>
  );
  return (
    <div className="mb-4 h-64" role="img" aria-label={`${c.kind === "line" ? "Line" : "Bar"} chart of ${c.series.join(" and ")} by ${c.x}. The table below has the same figures.`}>
      <ResponsiveContainer>
        {c.kind === "line"
          ? <LineChart data={data}>{common}{c.series.map((s, i) => <Line key={s} type="monotone" dataKey={s} stroke={COLORS[i % COLORS.length]} strokeWidth={2.5} dot />)}</LineChart>
          : <BarChart data={data}>{common}{c.series.map((s, i) => <Bar key={s} dataKey={s} fill={COLORS[i % COLORS.length]} radius={[6, 6, 0, 0]} />)}</BarChart>}
      </ResponsiveContainer>
    </div>
  );
}

/** Templates (annual faculty, accreditation summary) and analytics reports. Each section is a table, some with a chart. */
export default function ExtReportView({ slug }: { slug: ExtReportSlug }) {
  const { user } = useAuth();
  const [sp, setSp] = useSearchParams();
  const from = sp.get("from") ?? "";
  const to = sp.get("to") ?? "";
  const researcherId = sp.get("researcherId") ? Number(sp.get("researcherId")) : user?.researcherId;
  const set = (k: string, v: string) => setSp((p) => { const n = new URLSearchParams(p); if (v) n.set(k, v); else n.delete(k); return n; }, { replace: true });
  const [exportFormat, setExportFormat] = useState<"csv" | "pdf" | null>(null);

  const def = [...templateReports, ...analyticsReports].find((d) => d.slug === slug);
  const isFaculty = slug === "annual-faculty";
  const params = { from: from || undefined, to: to || undefined, researcherId: isFaculty ? researcherId : undefined };
  const directory = useQuery({ queryKey: ["directory"], queryFn: api.directory, enabled: isFaculty });
  const q = useQuery({ queryKey: ["ext-report", slug, params], queryFn: () => api.extReport(slug, params), retry: false, enabled: !isFaculty || !!researcherId });

  const columns = ["Section", ...(q.data ? [...new Set(q.data.sections.flatMap((s) => s.table.columns))] : [])];
  const rows = q.data?.sections.flatMap((s) => s.table.rows.map((r) => [s.heading, ...columns.slice(1).map((c) => { const i = s.table.columns.indexOf(c); return i >= 0 ? r[i] : ""; })])) ?? [];

  return (
    <div className="report-page">
      <PageHeader eyebrow={isFaculty || slug === "accreditation-summary" ? "Template" : "Analytics"} title={q.data?.title ?? def?.title ?? "Report"} description={def?.text}
        actions={<div className="no-print flex flex-wrap gap-3">
          <SaveReportButton slug={slug} params={params} defaultName={def?.title ?? slug} />
          <Button variant="secondary" disabled={!q.data} onClick={() => setExportFormat("pdf")}><Printer /> Print / PDF</Button>
          <Button disabled={!q.data} onClick={() => setExportFormat("csv")}><Download /> Export CSV</Button>
        </div>} />

      {slug !== "trends" && slug !== "benchmark" && slug !== "oa-compliance" && (
        <Card className="no-print mb-4 p-4"><div className="grid gap-3 sm:grid-cols-3">
          {isFaculty && <Field label="Faculty member">{(a) => (
            <Select {...a} value={researcherId ?? ""} onChange={(e) => set("researcherId", e.target.value)}>
              {directory.data?.filter((r) => r.kind !== "scholar").map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </Select>)}</Field>}
          <Field label="From date">{(a) => <Input {...a} type="date" value={from} max={to || undefined} onChange={(e) => set("from", e.target.value)} />}</Field>
          <Field label="To date">{(a) => <Input {...a} type="date" value={to} min={from || undefined} onChange={(e) => set("to", e.target.value)} />}</Field>
        </div></Card>)}

      {q.isError && <ErrorBanner error={q.error} onRetry={() => q.refetch()} />}
      {q.isLoading && <Skeleton className="h-72 w-full" />}
      {q.data?.notice && <p role="note" className="mb-4 rounded-xl border border-warning/30 bg-warning/10 p-3 text-sm">{q.data.notice}</p>}
      {q.data && <p className="mb-4 text-sm text-muted-foreground">Figures as of {q.data.asOf}. Verified publications and recorded grants only.</p>}

      <div className="space-y-6">
        {q.data?.sections.map((s) => (
          <Card key={s.heading} className="overflow-hidden">
            <CardHeader><CardTitle>{s.heading}</CardTitle>{s.note && <CardDescription>{s.note}</CardDescription>}</CardHeader>
            <CardContent className="px-0 pb-0 md:px-0 md:pb-2">
              {s.chart && <div className="px-6 md:px-8"><Chart section={s} /></div>}
              {s.table.rows.length === 0 ? <p className="px-6 py-4 text-sm text-muted-foreground md:px-8">Nothing to show for these filters.</p> : (
                <div className="overflow-x-auto"><Table>
                  <THead><tr>{s.table.columns.map((c) => <TH key={c} className={money(c) ? "text-right" : undefined}>{c}</TH>)}</tr></THead>
                  <TBody>{s.table.rows.map((r, i) => <TR key={i}>{r.map((v, j) => <TD key={j} className={money(s.table.columns[j]) ? "text-right" : undefined}>{money(s.table.columns[j]) && typeof v === "number" ? formatMoney(v) : v}</TD>)}</TR>)}</TBody>
                </Table></div>)}
            </CardContent>
          </Card>))}
      </div>

      {exportFormat && <ExportDialog open onClose={() => setExportFormat(null)} slug={slug} params={params} format={exportFormat} columns={columns} rows={rows} />}
    </div>
  );
}
