import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, Building2, Download, Printer, Trophy, TrendingUp } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "@/lib/api";
import { downloadCsv, formatMoney } from "@/lib/utils";
import { grantReports, publicationReports } from "@/lib/reportDefs";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";
import { ErrorBanner, Skeleton } from "@/components/ui/feedback";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";

const catalogue = [
  { slug: "summary", title: "Institution summary", icon: BarChart3, text: "Totals for departments, researchers, publications and awards.", counts: "verified publications only" },
  { slug: "by-year", title: "Publications by year", icon: TrendingUp, text: "Verified output per year.", counts: "verified publications only" },
  { slug: "top-researchers", title: "Top researchers", icon: Trophy, text: "Researchers ranked by verified publications.", counts: "verified publications only" },
  { slug: "departments", title: "Department output and funding", icon: Building2, text: "Publications, awards and funding per department.", counts: "verified publications and recorded awards" },
] as const;

export function ReportList() {
  return (
    <div>
      <PageHeader eyebrow="Reporting" title="Reports" description="Built-in reports. Annual faculty and accreditation templates will appear here." />
      <div className="grid gap-6 sm:grid-cols-2">
        {catalogue.map((r) => (
          <Link key={r.slug} to={`/reports/${r.slug}`} className="rounded-2xl">
            <Card hover className="h-full px-8 py-8">
              <div className="mb-4 grid size-11 place-items-center rounded-xl bg-secondary text-primary"><r.icon className="size-5" aria-hidden /></div>
              <h3 className="mb-2 text-lg font-semibold tracking-tight md:text-xl">{r.title}</h3>
              <p className="text-base leading-relaxed text-muted-foreground">{r.text}</p>
            </Card>
          </Link>
        ))}
      </div>
      {([["Publication reports", publicationReports], ["Grant reports", grantReports]] as const).map(([heading, defs]) => (
        <section key={heading} className="mt-10" aria-labelledby={heading}>
          <h2 id={heading} className="mb-3 text-xl font-semibold tracking-tight">{heading}</h2>
          <ul className="grid gap-3 sm:grid-cols-2">{defs.map((d) => (
            <li key={d.slug}><Link to={`/reports/${d.slug}`} className="block rounded-2xl"><Card hover className="h-full px-6 py-5"><p className="font-semibold">{d.title}</p><p className="mt-1 text-sm text-muted-foreground">{d.text}</p></Card></Link></li>))}</ul>
        </section>))}
    </div>
  );
}

function toCsv(rows: Record<string, string | number>[]) {
  if (!rows.length) return "";
  const cols = Object.keys(rows[0]);
  const esc = (v: string | number) => {
    let s = String(v);
    if (/^[=+\-@]/.test(s)) s = "'" + s; // neutralise spreadsheet formulas
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
}

function CoreReportView() {
  const { slug } = useParams();
  const meta = catalogue.find((c) => c.slug === slug);
  const { toast } = useToast();
  const summary = useQuery({ queryKey: ["summary"], queryFn: api.summary, enabled: slug === "summary" });
  const years = useQuery({ queryKey: ["by-year"], queryFn: api.byYear, enabled: slug === "by-year" });
  const top = useQuery({ queryKey: ["top"], queryFn: api.topResearchers, enabled: slug === "top-researchers" });
  const depts = useQuery({ queryKey: ["dept-report"], queryFn: api.departmentReport, enabled: slug === "departments" });

  if (!meta) return <ErrorBanner error={{ status: 404 }} />;
  const active = { summary, "by-year": years, "top-researchers": top, departments: depts }[meta.slug];

  const rows = (): Record<string, string | number>[] => {
    if (slug === "summary" && summary.data) { const { pendingReview: _p, ...rest } = summary.data; return [rest]; }
    if (slug === "by-year") return years.data?.map((y) => ({ Year: y.year, Publications: y.count })) ?? [];
    if (slug === "top-researchers") return top.data?.map((r) => ({ Researcher: r.name, Publications: r.publications })) ?? [];
    return depts.data?.map((d) => ({ Department: d.name, Publications: d.publications, Awards: d.awards, Funding: d.funding })) ?? [];
  };

  const exportCsv = () => {
    const blob = new Blob([toCsv(rows())], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = `${meta.slug}.csv`; a.click(); URL.revokeObjectURL(a.href);
    toast({ tone: "ok", message: "CSV downloaded. It matches what's on screen." });
  };

  return (
    <div>
      <PageHeader eyebrow="Report" title={meta.title} description={`Counts ${meta.counts}. Data as of ${new Date().toLocaleDateString()}.`}
        actions={<><Button variant="secondary" onClick={() => window.print()}><Printer /> Print / PDF</Button><Button onClick={exportCsv} disabled={!active?.data}><Download /> Export CSV</Button></>} />
      {active?.isError && <ErrorBanner error={active.error} onRetry={() => active.refetch()} />}
      {active?.isLoading && <Skeleton className="h-72 w-full" />}

      {slug === "summary" && summary.data && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {(["departments", "researchers", "publications", "awards"] as const).map((k) => (
            <Card key={k} className="p-6"><div className="text-3xl font-semibold">{summary.data[k]}</div><div className="mt-1 text-sm capitalize text-muted-foreground">{k}</div></Card>))}
        </div>
      )}

      {slug === "by-year" && years.data && (
        <Card><CardHeader><CardTitle>Publications per year</CardTitle><CardDescription>Table below shows the same figures.</CardDescription></CardHeader><CardContent>
          <div className="h-72" role="img" aria-label="Bar chart of publications per year"><ResponsiveContainer><BarChart data={years.data}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
            <XAxis dataKey="year" tickLine={false} axisLine={false} fontSize={12} stroke="hsl(var(--muted-foreground))" />
            <YAxis allowDecimals={false} tickLine={false} axisLine={false} fontSize={12} width={28} stroke="hsl(var(--muted-foreground))" />
            <Tooltip cursor={{ fill: "hsl(var(--secondary))" }} contentStyle={{ borderRadius: 12, border: "1px solid hsl(var(--border))", background: "hsl(var(--card))", color: "hsl(var(--foreground))" }} />
            <Bar dataKey="count" name="Publications" fill="hsl(var(--primary))" radius={[8, 8, 0, 0]} /></BarChart></ResponsiveContainer></div>
          <Table className="mt-6"><THead><tr><TH>Year</TH><TH>Publications</TH></tr></THead><TBody>{years.data.map((y) => <TR key={y.year}><TD>{y.year}</TD><TD>{y.count}</TD></TR>)}</TBody></Table>
        </CardContent></Card>
      )}

      {slug === "top-researchers" && top.data && (
        <Card className="overflow-hidden"><Table><THead><tr><TH>#</TH><TH>Researcher</TH><TH>Publications</TH></tr></THead>
          <TBody>{top.data.map((r, i) => <TR key={r.researcherId}><TD>{i + 1}</TD><TD><Link className="font-medium hover:text-primary" to={`/people/${r.researcherId}`}>{r.name}</Link></TD><TD>{r.publications}</TD></TR>)}</TBody></Table></Card>
      )}

      {slug === "departments" && depts.data && (
        <Card className="overflow-hidden"><Table><THead><tr><TH>Department</TH><TH>Publications</TH><TH>Awards</TH><TH className="text-right">Funding</TH></tr></THead>
          <TBody>{depts.data.map((d) => <TR key={d.departmentId}><TD className="font-medium">{d.name}</TD><TD>{d.publications}</TD><TD>{d.awards}</TD><TD className="text-right">{formatMoney(d.funding)}</TD></TR>)}</TBody></Table></Card>
      )}
    </div>
  );
}

export function ReportView() {
  const { slug } = useParams();
  return /^(pub|grant)-/.test(slug ?? "") ? <TableReport slug={slug!} /> : <CoreReportView />;
}

function TableReport({ slug }: { slug: string }) {
  const def = [...publicationReports, ...grantReports].find((r) => r.slug === slug);
  const isGrant = slug.startsWith("grant-");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [basis, setBasis] = useState<"applied" | "entered" | "sanctioned">("applied");
  const q = useQuery({
    queryKey: ["report", slug, from, to, basis],
    queryFn: () => api.report(slug, { from: from || undefined, to: to || undefined, basis: isGrant ? basis : undefined }),
    enabled: !!def,
  });
  if (!def) return <ErrorBanner error={{ status: 404 }} />;
  const money = (col: string) => col.includes("(INR)");
  const useBasis = isGrant && slug !== "grant-year-received";

  return (
    <div>
      <PageHeader eyebrow={isGrant ? "Grant report" : "Publication report"} title={def.title}
        description={`${def.text} ${isGrant ? "Grants you are allowed to see." : "Counts verified publications only."}`}
        actions={<><Button variant="secondary" onClick={() => window.print()}><Printer /> Print / PDF</Button>
          <Button disabled={!q.data} onClick={() => q.data && downloadCsv(`${slug}.csv`, q.data.columns, q.data.rows)}><Download /> Export CSV</Button></>} />
      <Card className="mb-4 p-4"><div className="grid gap-3 sm:grid-cols-3">
        <Field label={isGrant ? "From date" : "From year"}>{(a) => <Input {...a} type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />}</Field>
        <Field label={isGrant ? "To date" : "To year"}>{(a) => <Input {...a} type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />}</Field>
        {useBasis && <Field label="Date basis">{(a) => <Select {...a} value={basis} onChange={(e) => setBasis(e.target.value as typeof basis)}><option value="applied">Applied date</option><option value="entered">Entry date</option><option value="sanctioned">Sanction date</option></Select>}</Field>}
      </div></Card>
      {q.isError && <ErrorBanner error={q.error} onRetry={() => q.refetch()} />}
      {q.isLoading && <Skeleton className="h-72 w-full" />}
      {q.data && (q.data.rows.length === 0 ? <Card className="p-8 text-center text-muted-foreground">Nothing matches these filters.</Card> : (
        <Card className="overflow-hidden"><Table>
          <THead><tr>{q.data.columns.map((c) => <TH key={c} className={money(c) ? "text-right" : undefined}>{c}</TH>)}</tr></THead>
          <TBody>{q.data.rows.map((r, i) => <TR key={i}>{r.map((v, j) => <TD key={j} className={money(q.data!.columns[j]) ? "text-right" : undefined}>{money(q.data!.columns[j]) && typeof v === "number" ? formatMoney(v) : v}</TD>)}</TR>)}</TBody>
        </Table></Card>))}
    </div>
  );
}
