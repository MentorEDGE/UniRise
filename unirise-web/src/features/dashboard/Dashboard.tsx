import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Award, BookOpen, Building2, CheckSquare, Users } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "@/lib/api";
import { useAuth, can } from "@/app/auth";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorBanner, Skeleton } from "@/components/ui/feedback";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { formatMoney, formatNumber } from "@/lib/utils";

export default function Dashboard() {
  const { user } = useAuth();
  const summary = useQuery({ queryKey: ["summary"], queryFn: api.summary });
  const years = useQuery({ queryKey: ["by-year"], queryFn: api.byYear });
  const top = useQuery({ queryKey: ["top"], queryFn: api.topResearchers });
  const depts = useQuery({ queryKey: ["dept-report"], queryFn: api.departmentReport });

  const s = summary.data;
  const tiles = [
    { label: "Departments", value: s?.departments, icon: Building2, to: "/people" },
    { label: "Researchers", value: s?.researchers, icon: Users, to: "/people" },
    { label: "Verified publications", value: s?.publications, icon: BookOpen, to: "/publications?state=verified" },
    { label: "Awards", value: s?.awards, icon: Award, to: "/awards" },
  ];
  const canReview = can.edit(user?.role);
  const isEmpty = s && s.researchers === 0;

  return (
    <div>
      <PageHeader eyebrow="Research Office" title={`Welcome back, ${user?.name}`}
        description="Verified research output, funding and people across your institution." />

      {summary.isError && <ErrorBanner error={summary.error} onRetry={() => summary.refetch()} />}

      {isEmpty && (
        <Card className="mb-8"><CardHeader><CardTitle>Get started</CardTitle><CardDescription>Four steps to a working institution.</CardDescription></CardHeader>
          <CardContent><ol className="list-decimal space-y-2 pl-5 text-sm"><li>Add departments</li><li>Import staff</li><li>Connect ORCID</li><li>Import first publications</li></ol></CardContent></Card>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {tiles.map((t) => (
          <Link key={t.label} to={t.to} className="rounded-2xl">
            <Card hover className="h-full p-5 md:p-6">
              <div className="mb-4 grid size-10 place-items-center rounded-xl bg-secondary text-primary"><t.icon className="size-5" aria-hidden /></div>
              {summary.isLoading ? <Skeleton className="h-8 w-16" /> : <div className="text-3xl font-semibold tracking-tight">{formatNumber(t.value ?? 0)}</div>}
              <div className="mt-1 text-sm text-muted-foreground">{t.label}</div>
            </Card>
          </Link>
        ))}
      </div>

      {canReview && (s?.pendingReview ?? 0) > 0 && (
        <Card className="mt-6 flex flex-wrap items-center justify-between gap-4 border-violet-200 bg-secondary/60 p-5 md:px-8">
          <div className="flex items-center gap-3"><CheckSquare className="size-6 text-primary" aria-hidden />
            <p className="font-medium">{s!.pendingReview} suggestions awaiting review</p></div>
          <Link to="/review" className="inline-flex h-10 items-center rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/30 transition-transform active:scale-[0.98]">Review now</Link>
        </Card>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader><CardTitle>Publications by year</CardTitle><CardDescription>Verified publications only. Updated when claims are confirmed.</CardDescription></CardHeader>
          <CardContent>
            {years.isLoading ? <Skeleton className="h-64 w-full" /> : (
              <div className="h-64" role="img" aria-label={`Bar chart of verified publications per year, ${years.data?.map((y) => `${y.year}: ${y.count}`).join(", ")}`}>
                <ResponsiveContainer>
                  <BarChart data={years.data}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                    <XAxis dataKey="year" tickLine={false} axisLine={false} stroke="hsl(var(--muted-foreground))" fontSize={12} />
                    <YAxis allowDecimals={false} tickLine={false} axisLine={false} stroke="hsl(var(--muted-foreground))" fontSize={12} width={28} />
                    <Tooltip cursor={{ fill: "hsl(var(--secondary))" }} contentStyle={{ borderRadius: 12, border: "1px solid hsl(var(--border))", background: "hsl(var(--card))", color: "hsl(var(--foreground))" }} />
                    <Bar dataKey="count" name="Publications" fill="hsl(var(--primary))" radius={[8, 8, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
            <details className="mt-3 text-sm"><summary className="cursor-pointer text-muted-foreground">View as table</summary>
              <Table className="mt-2"><THead><tr><TH>Year</TH><TH>Publications</TH></tr></THead><TBody>
                {years.data?.map((y) => <TR key={y.year}><TD>{y.year}</TD><TD>{y.count}</TD></TR>)}</TBody></Table>
            </details>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Top researchers</CardTitle><CardDescription>By verified publications.</CardDescription></CardHeader>
          <CardContent>
            {top.isLoading ? <Skeleton className="h-48 w-full" /> : (
              <ol className="space-y-3">
                {top.data?.map((r, i) => (
                  <li key={r.researcherId} className="flex items-center gap-3">
                    <span className="grid size-7 place-items-center rounded-full bg-secondary text-xs font-bold text-primary">{i + 1}</span>
                    <Link to={`/people/${r.researcherId}`} className="flex-1 truncate font-medium hover:text-primary">{r.name}</Link>
                    <span className="text-sm text-muted-foreground">{r.publications}</span>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader><CardTitle>Departments</CardTitle><CardDescription>Output and funding by department.</CardDescription></CardHeader>
        <CardContent className="px-0 pb-0 md:px-0 md:pb-2">
          {depts.isLoading ? <div className="p-6"><Skeleton className="h-32 w-full" /></div> : (
            <Table><THead><tr><TH>Department</TH><TH>Publications</TH><TH>Awards</TH><TH className="text-right">Funding</TH></tr></THead>
              <TBody>{depts.data?.map((d) => (
                <TR key={d.departmentId}><TD className="font-medium">{d.name}</TD><TD>{d.publications}</TD><TD>{d.awards}</TD><TD className="text-right">{formatMoney(d.funding)}</TD></TR>
              ))}</TBody></Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
