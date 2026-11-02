import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Lock } from "lucide-react";
import { api } from "@/lib/api";
import { formatDate, initials } from "@/lib/utils";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, MilestoneBadge } from "@/components/ui/badge";
import { EmptyState, ErrorBanner, Skeleton } from "@/components/ui/feedback";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { MilestoneTimeline } from "@/features/progress/MilestoneTimeline";

const relLabel = { primary: "Primary", co: "Co-supervisor", backup: "Backup" } as const;

export default function MenteeList() {
  const q = useQuery({ queryKey: ["mentees"], queryFn: api.mentees });
  return (
    <div>
      <PageHeader eyebrow="Supervision" title="My mentees" description="Where each scholar is, what is due next, and who needs a nudge." />
      {q.isError && <ErrorBanner error={q.error} onRetry={() => q.refetch()} />}
      <Card className="overflow-hidden">
        {q.isLoading ? <div className="space-y-3 p-6">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-12" />)}</div>
          : q.data?.length === 0 ? <EmptyState title="No mentees yet" description="Scholars you supervise will appear here." />
          : (<>
            <div className="hidden md:block"><Table>
              <THead><tr><TH>Scholar</TH><TH>Current stage</TH><TH>Next due</TH><TH>Overdue</TH><TH>Last meeting</TH></tr></THead>
              <TBody>{q.data?.map((m) => (
                <TR key={m.researcher.id}>
                  <TD><Link to={`/mentees/${m.researcher.id}`} className="flex items-center gap-3 font-medium hover:text-primary">
                    <span className="grid size-9 place-items-center rounded-full bg-secondary text-xs font-bold text-primary" aria-hidden>{initials(m.researcher.name)}</span>
                    <span>{m.researcher.name}<span className="block text-xs font-normal text-muted-foreground">{relLabel[m.relationship]}</span></span></Link></TD>
                  <TD>{m.current?.stage ?? "Completed"}</TD>
                  <TD>{m.current ? <span className="flex items-center gap-2">{formatDate(m.current.dueDate)} <MilestoneBadge status={m.current.status} /></span> : "—"}</TD>
                  <TD>{m.overdue}</TD>
                  <TD>{m.lastMeeting ? formatDate(m.lastMeeting) : "None logged"}</TD>
                </TR>))}</TBody></Table></div>
            <ul className="divide-y md:hidden">{q.data?.map((m) => (
              <li key={m.researcher.id} className="space-y-1 p-4">
                <Link to={`/mentees/${m.researcher.id}`} className="font-medium">{m.researcher.name}</Link>
                <p className="text-xs text-muted-foreground">{m.current?.stage ?? "Completed"}{m.current ? ` · due ${formatDate(m.current.dueDate)}` : ""}</p>
                {m.current && <MilestoneBadge status={m.current.status} />}
              </li>))}</ul>
          </>)}
      </Card>
    </div>
  );
}

export function MenteeDetail() {
  const { id } = useParams();
  const sid = Number(id);
  const q = useQuery({ queryKey: ["mentee", sid], queryFn: () => api.menteeDetail(sid), retry: false });

  if (q.isError) return <ErrorBanner error={q.error} />;
  if (q.isLoading || !q.data) return <Skeleton className="h-64 w-full" />;
  const { researcher, milestones, meetings } = q.data;
  return (
    <div className="max-w-3xl">
      <Link to="/mentees" className="mb-4 inline-flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-primary"><ArrowLeft className="size-4" aria-hidden />All mentees</Link>
      <PageHeader eyebrow="Mentee" title={researcher.name} description={`${researcher.title} · ${researcher.email}`}
        actions={<Link to={`/people/${researcher.id}`} className="inline-flex h-10 items-center rounded-xl border px-4 text-sm font-semibold hover:bg-secondary/60">View profile</Link>} />
      <Card className="mb-6 overflow-hidden">
        <CardHeader><CardTitle>Milestones</CardTitle><CardDescription>Reminders go to you and the scholar and escalate when overdue.</CardDescription></CardHeader>
        <div className="mt-4"><MilestoneTimeline milestones={milestones} /></div>
      </Card>
      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle className="flex items-center gap-3">Meeting log <Badge className="border-border bg-muted text-muted-foreground"><Lock className="size-3.5" aria-hidden />Confidential</Badge></CardTitle>
          <CardDescription>Visible only to you and the scholar. It never appears in unit or executive views.</CardDescription>
        </CardHeader>
        {meetings.length === 0 ? <EmptyState title="No meetings logged" description="Meeting notes you record will appear here." /> : (
          <ul className="mt-4 divide-y">{meetings.map((m) => (
            <li key={m.id} className="px-6 py-4 md:px-8"><p className="text-sm font-semibold">{formatDate(m.heldOn)}</p><p className="mt-1 text-sm text-muted-foreground">{m.notes}</p></li>))}</ul>
        )}
      </Card>
    </div>
  );
}
