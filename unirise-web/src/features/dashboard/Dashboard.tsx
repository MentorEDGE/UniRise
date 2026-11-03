import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Award, BookOpen, CheckSquare, GraduationCap } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "@/lib/api";
import { useAuth, can } from "@/app/auth";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorBanner, Skeleton } from "@/components/ui/feedback";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { formatNumber } from "@/lib/utils";
import { RemindersCard } from "@/features/progress/RemindersCard";
import { MenteesAttention, NextDueCard, UnitProgress, YourStanding } from "./RoleSections";
import { OverviewHome } from "./OverviewHome";

export default function Dashboard() {
  const { user } = useAuth();
  const role = user?.role;
  const isScholar = role === "RESEARCHER" && !!user?.isScholar;
  const isOwnView = role === "RESEARCHER" || role === "SUPERVISOR"; // own numbers; a ranking never names anyone else
  const isHead = (role === "HOD" || role === "DEAN" || role === "EXECUTIVE") && user?.scopeUnitId !== undefined;

  const summary = useQuery({ queryKey: ["summary"], queryFn: api.summary });
  const years = useQuery({ queryKey: ["by-year"], queryFn: api.byYear, enabled: isOwnView });
  const mentees = useQuery({ queryKey: ["mentees"], queryFn: api.mentees, enabled: role === "SUPERVISOR" });

  const s = summary.data;
  // Overview roles get the analytics overview instead (OverviewHome).
  const tiles = [
    ...(role === "SUPERVISOR" ? [{ label: "Mentees", value: mentees.data?.length, icon: GraduationCap, to: "/mentees", loading: mentees.isLoading }] : []),
    { label: "Verified publications", value: s?.publications, icon: BookOpen, to: "/publications?state=verified", loading: summary.isLoading },
    { label: "Awards", value: s?.awards, icon: Award, to: "/awards", loading: summary.isLoading },
  ];
  const canReview = can.edit(role);
  const isEmpty = s && s.researchers === 0;

  return (
    <div>
      <PageHeader eyebrow={isOwnView ? "Home" : "Research Office"} title={`Welcome back, ${user?.name}`}
        description={isScholar ? "Your next stage, reminders and your own research output."
          : role === "SUPERVISOR" ? "Your mentees, what needs attention, and your own research output."
          : isOwnView ? "Your own verified research output."
          : "Verified research output, funding and people across your institution."} />

      {summary.isError && <ErrorBanner error={summary.error} onRetry={() => summary.refetch()} />}

      {isEmpty && (
        <Card className="mb-8"><CardHeader><CardTitle>Get started</CardTitle><CardDescription>Four steps to a working institution.</CardDescription></CardHeader>
          <CardContent><ol className="list-decimal space-y-2 pl-5 text-sm"><li>Add departments</li><li>Import staff</li><li>Connect ORCID</li><li>Import first publications</li></ol></CardContent></Card>
      )}

      {isScholar && <div className="mb-6 grid gap-6 lg:grid-cols-2"><NextDueCard /><RemindersCard limit={3} description="Stages due soon or late, and who was told." /></div>}
      {role === "SUPERVISOR" && <div className="mb-6 grid gap-6 lg:grid-cols-2"><MenteesAttention /><RemindersCard limit={4} title="Mentee reminders" /></div>}

      {isOwnView && <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        {tiles.map((t) => (
          <Link key={t.label} to={t.to} className="rounded-2xl">
            <Card hover className="h-full p-5 md:p-6">
              <div className="mb-4 grid size-10 place-items-center rounded-xl bg-secondary text-primary"><t.icon className="size-5" aria-hidden /></div>
              {t.loading ? <Skeleton className="h-8 w-16" /> : <div className="text-3xl font-semibold tracking-tight">{formatNumber(t.value ?? 0)}</div>}
              <div className="mt-1 text-sm text-muted-foreground">{t.label}</div>
            </Card>
          </Link>
        ))}
      </div>}
      {role === "SUPERVISOR" && <p className="mt-2 text-xs text-muted-foreground">Publication and award counts cover you and your mentees.</p>}

      {canReview && (s?.pendingReview ?? 0) > 0 && (
        <Card className={`${isOwnView ? "mt-6" : "mb-6"} flex flex-wrap items-center justify-between gap-4 border-violet-200 bg-secondary/60 p-5 md:px-8`}>
          <div className="flex items-center gap-3"><CheckSquare className="size-6 text-primary" aria-hidden />
            <p className="font-medium">{s!.pendingReview} suggestions awaiting review</p></div>
          <Link to="/review" className="inline-flex h-10 items-center rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/30 transition-transform active:scale-[0.98]">Review now</Link>
        </Card>
      )}

      {!isOwnView && <OverviewHome />}

      {isHead && (
        <div className="mt-6 space-y-6">
          <UnitProgress unitId={user!.scopeUnitId!} />
          {role !== "EXECUTIVE" && <RemindersCard title="Escalated to you" description="Stages more than a month late. Only escalated ones reach heads of unit." />}
        </div>
      )}

      {isOwnView && <div className="mt-6 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
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

        <YourStanding />
      </div>}
    </div>
  );
}
