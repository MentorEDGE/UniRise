import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, GraduationCap, Trophy } from "lucide-react";
import { api } from "@/lib/api";
import { formatDate, formatNumber } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MilestoneBadge } from "@/components/ui/badge";
import { EmptyState, ErrorBanner, Skeleton } from "@/components/ui/feedback";

const daysUntil = (iso: string) => Math.round((Date.parse(iso) - Date.parse(new Date().toISOString().slice(0, 10))) / 86_400_000);

/** Scholar home: the one stage that matters next, linking to the full progress page. */
export function NextDueCard() {
  const q = useQuery({ queryKey: ["milestones", "mine"], queryFn: () => api.milestones() });
  const next = q.data?.find((m) => m.status !== "done");
  return (
    <Card className="overflow-hidden">
      <CardHeader><CardTitle className="flex items-center gap-3"><GraduationCap className="size-5 text-primary" aria-hidden />Next due</CardTitle><CardDescription>Your next stage on the way to submission.</CardDescription></CardHeader>
      <CardContent>
        {q.isLoading ? <Skeleton className="h-16 w-full" />
          : q.isError ? <ErrorBanner error={q.error} onRetry={() => q.refetch()} />
          : !q.data?.length ? <EmptyState title="No milestones yet" description="Your supervisor or the research office will set these up." />
          : !next ? <p className="text-sm text-muted-foreground">All {q.data.length} stages are complete.</p>
          : (
            <Link to="/my-progress" className="flex flex-wrap items-center gap-4 rounded-xl hover:text-primary">
              <div className="flex-1">
                <p className="text-xl font-semibold tracking-tight">{next.stage}</p>
                <p className="text-sm text-muted-foreground">Due {formatDate(next.dueDate)}</p>
              </div>
              <MilestoneBadge status={next.status} />
              <span className="inline-flex items-center gap-1 text-sm font-semibold text-primary">Open my progress<ArrowRight className="size-4" aria-hidden /></span>
            </Link>
          )}
      </CardContent>
    </Card>
  );
}

/** Own rank among verified publication counts. Shows the number and aggregate context, never another person's name. */
export function YourStanding() {
  const q = useQuery({ queryKey: ["my-rank"], queryFn: api.myRank });
  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-3"><Trophy className="size-5 text-primary" aria-hidden />Your standing</CardTitle>
        <CardDescription>By verified publications across the institution. Other people's names are not shown.</CardDescription></CardHeader>
      <CardContent>
        {q.isLoading ? <Skeleton className="h-24 w-full" />
          : q.isError ? <ErrorBanner error={q.error} onRetry={() => q.refetch()} />
          : q.data && (
            <div className="space-y-2">
              <p className="text-3xl font-semibold tracking-tight">You are #{q.data.rank} of {formatNumber(q.data.total)}</p>
              <p className="text-sm text-muted-foreground">You have {q.data.publications} verified publication{q.data.publications === 1 ? "" : "s"}. The median across the institution is {q.data.median}.</p>
            </div>
          )}
      </CardContent>
    </Card>
  );
}

/** Supervisor home: mentees with a late stage or one due within 14 days. */
export function MenteesAttention() {
  const q = useQuery({ queryKey: ["mentees"], queryFn: api.mentees });
  const needs = q.data?.filter((m) => m.overdue > 0 || (m.current && daysUntil(m.current.dueDate) <= 14));
  return (
    <Card className="overflow-hidden">
      <CardHeader><CardTitle>Mentees needing attention</CardTitle><CardDescription>A stage is late or due within 14 days.</CardDescription></CardHeader>
      <div className="mt-4">
        {q.isLoading ? <div className="space-y-3 px-6 pb-6 md:px-8"><Skeleton className="h-12" /><Skeleton className="h-12" /></div>
          : q.isError ? <div className="px-6 pb-6 md:px-8"><ErrorBanner error={q.error} onRetry={() => q.refetch()} /></div>
          : q.data?.length === 0 ? <EmptyState title="No mentees yet" description="Scholars you supervise will appear here." />
          : needs?.length === 0 ? <EmptyState title="Everyone is on track" description="No mentee has a late stage or one due in the next 14 days." />
          : (
            <ul className="divide-y">{needs?.map((m) => (
              <li key={m.researcher.id} className="flex flex-wrap items-center gap-3 px-6 py-4 md:px-8">
                <Link to={`/mentees/${m.researcher.id}`} className="flex-1 font-medium hover:text-primary">{m.researcher.name}
                  <span className="block text-xs font-normal text-muted-foreground">{m.current ? `${m.current.stage} · due ${formatDate(m.current.dueDate)}` : "Completed"}</span></Link>
                {m.current && <MilestoneBadge status={m.current.status} />}
              </li>))}</ul>
          )}
      </div>
    </Card>
  );
}

/** Head-of-unit home: scholars by stage and where stages are late, from the unit roll-up. */
export function UnitProgress({ unitId }: { unitId: number }) {
  const q = useQuery({ queryKey: ["rollup", unitId], queryFn: () => api.unitRollup(unitId) });
  const max = Math.max(1, ...(q.data?.byStage.map((s) => s.count) ?? [1]));
  const late = q.data?.children.filter((c) => c.overdue > 0) ?? [];
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader><CardTitle>Scholars by stage</CardTitle><CardDescription>{q.data ? `${q.data.totals.scholars} scholars in ${q.data.unit.name}, as of ${formatDate(q.data.asOf)}.` : "Where each scholar currently is."}</CardDescription></CardHeader>
        <CardContent>
          {q.isLoading ? <Skeleton className="h-40 w-full" />
            : q.isError ? <ErrorBanner error={q.error} onRetry={() => q.refetch()} />
            : q.data?.byStage.length === 0 ? <p className="text-sm text-muted-foreground">No scholars in this unit yet.</p>
            : (
              <ul className="space-y-3">{q.data?.byStage.map((s) => (
                <li key={s.stage} className="text-sm">
                  <div className="mb-1 flex justify-between"><span>{s.stage}</span><span className="font-semibold">{s.count}</span></div>
                  <div className="h-2 rounded-full bg-secondary" aria-hidden><div className="h-2 rounded-full bg-primary" style={{ width: `${(s.count / max) * 100}%` }} /></div>
                </li>))}</ul>
            )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Overdue stages</CardTitle><CardDescription>{q.data ? `${q.data.totals.overdue} late stage${q.data.totals.overdue === 1 ? "" : "s"} across the unit.` : "Late stages by unit."}</CardDescription></CardHeader>
        <CardContent>
          {q.isLoading ? <Skeleton className="h-40 w-full" />
            : q.isError ? <ErrorBanner error={q.error} onRetry={() => q.refetch()} />
            : late.length === 0 ? <p className="text-sm text-muted-foreground">{q.data && q.data.totals.overdue > 0 ? "The late stages sit in this unit itself. Escalated ones are listed under Reminders." : "No stage is overdue."}</p>
            : (
              <ul className="divide-y">{late.map((c) => (
                <li key={c.unitId} className="flex items-center justify-between gap-3 py-2 text-sm"><span>{c.name}</span><span className="font-semibold">{c.overdue} overdue</span></li>))}</ul>
            )}
        </CardContent>
      </Card>
    </div>
  );
}
