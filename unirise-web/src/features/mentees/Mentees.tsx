import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ArrowLeft, CalendarPlus, CheckCheck, Lock, Pencil, Plus, ShieldCheck } from "lucide-react";
import { api } from "@/lib/api";
import { formatDate, initials } from "@/lib/utils";
import type { MilestoneView } from "@/lib/types";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, MilestoneBadge } from "@/components/ui/badge";
import { EmptyState, ErrorBanner, Skeleton } from "@/components/ui/feedback";
import { Field, Input } from "@/components/ui/form";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { MilestoneTimeline } from "@/features/progress/MilestoneTimeline";
import { RemindersCard } from "@/features/progress/RemindersCard";
import { AddMilestoneDialog, ApproveDialog, EditDueDateDialog, MarkDoneDialog } from "@/features/progress/MilestoneDialogs";
import { PROGRESS_KEYS, Textarea, saveErrorMessage } from "@/features/progress/shared";

const relLabel = { primary: "Primary", co: "Co-supervisor", backup: "Backup" } as const;

export default function MenteeList() {
  const q = useQuery({ queryKey: ["mentees"], queryFn: api.mentees });
  return (
    <div>
      <PageHeader eyebrow="Supervision" title="My mentees" description="Where each scholar is, what is due next, and who needs a nudge." />
      {q.isError && <ErrorBanner error={q.error} onRetry={() => q.refetch()} />}
      <div className="mb-6"><RemindersCard title="Reminders for your mentees" description="Stages due within 14 days or running late. You and the scholar both get these." /></div>
      <Card className="overflow-hidden">
        {q.isLoading ? <div className="space-y-3 p-6">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-12" />)}</div>
          : q.data?.length === 0 ? <EmptyState title="No mentees yet" description="Scholars you supervise will appear here. The research office assigns supervisors." />
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

const MAX_NOTES = 2000;
const todayLocal = () => new Date().toISOString().slice(0, 10);
const meetingSchema = z.object({
  heldOn: z.string().min(1, "Choose the meeting date").refine((d) => d <= todayLocal(), "The date can't be in the future"),
  notes: z.string().trim().min(1, "Write a few notes").max(MAX_NOTES, `Use ${MAX_NOTES} characters or fewer`),
});
type MeetingValues = z.infer<typeof meetingSchema>;

/** Only the scholar's supervisor sees this form; the server refuses anyone else. */
function LogMeetingForm({ scholarId }: { scholarId: number }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const form = useForm<MeetingValues>({ resolver: zodResolver(meetingSchema) as never, defaultValues: { heldOn: todayLocal(), notes: "" } });
  const notes = form.watch("notes") ?? "";
  const save = useMutation({
    mutationFn: (v: MeetingValues) => api.addMeetingLog({ scholarId, ...v }),
    onSuccess: () => {
      PROGRESS_KEYS.forEach((k) => qc.invalidateQueries({ queryKey: [...k] }));
      form.reset({ heldOn: todayLocal(), notes: "" });
      toast({ message: "Meeting logged.", tone: "ok" });
    },
    onError: (e) => toast({ message: saveErrorMessage(e), tone: "error" }),
  });
  const errors = form.formState.errors;
  return (
    <form noValidate onSubmit={form.handleSubmit((v) => save.mutate(v))} className="space-y-4 border-b px-6 py-5 md:px-8">
      <p className="flex items-start gap-2 text-sm text-muted-foreground">
        <Lock className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>Only you and the scholar can read what you write here. The research office, heads of department, deans and executives cannot.</span>
      </p>
      <div className="grid gap-4 md:grid-cols-[12rem_1fr]">
        <Field label="Meeting date" error={errors.heldOn?.message}>{(a) => <Input type="date" max={todayLocal()} {...a} {...form.register("heldOn")} />}</Field>
        <Field label="Notes" error={errors.notes?.message} hint={`${notes.length} / ${MAX_NOTES} characters`}>
          {(a) => <Textarea {...a} {...form.register("notes")} />}
        </Field>
      </div>
      <div className="flex justify-end"><Button type="submit" loading={save.isPending}><CalendarPlus aria-hidden />Log meeting</Button></div>
    </form>
  );
}

export function MenteeDetail() {
  const { id } = useParams();
  const sid = Number(id);
  const q = useQuery({ queryKey: ["mentee", sid], queryFn: () => api.menteeDetail(sid), retry: false });
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<MilestoneView>();
  const [finishing, setFinishing] = useState<MilestoneView>();
  const [approving, setApproving] = useState<MilestoneView>();

  if (q.isError) return <ErrorBanner error={q.error} onRetry={() => q.refetch()} />;
  if (q.isLoading || !q.data) return <Skeleton className="h-64 w-full" />;
  const { researcher, milestones, meetings, canManage, canLogMeeting, canComplete, supervisors } = q.data;
  return (
    <div className="max-w-3xl">
      <Link to="/mentees" className="mb-4 inline-flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-primary"><ArrowLeft className="size-4" aria-hidden />All mentees</Link>
      <PageHeader eyebrow="Mentee" title={researcher.name} description={`${researcher.title} · ${researcher.email}`}
        actions={<Link to={`/people/${researcher.id}`} className="inline-flex h-10 items-center rounded-xl border px-4 text-sm font-semibold hover:bg-secondary/60">View profile</Link>} />
      <Card className="mb-6 overflow-hidden">
        <CardHeader className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Milestones</CardTitle>
            <CardDescription>
              Reminders go to {supervisors.length ? supervisors.join(" and ") : "the supervisor"} and the scholar, and escalate to the head of department when a stage is more than a month late.
            </CardDescription>
          </div>
          {canManage && <Button onClick={() => setAdding(true)}><Plus aria-hidden />Add milestone</Button>}
        </CardHeader>
        <div className="mt-4">
          {milestones.length === 0
            ? <EmptyState title="No milestones yet" description="Add the first stage to start tracking this scholar's progress." action={canManage ? <Button onClick={() => setAdding(true)}><Plus aria-hidden />Add milestone</Button> : undefined} />
            : <MilestoneTimeline milestones={milestones} actions={(m) => (<>
              {canManage && !m.approvedOn && <Button size="sm" variant="secondary" aria-label={`Edit due date of ${m.stage}`} onClick={() => setEditing(m)}><Pencil aria-hidden />Due date</Button>}
              {canComplete && m.status !== "done" && <Button size="sm" variant="secondary" aria-label={`Mark ${m.stage} as done`} onClick={() => setFinishing(m)}><CheckCheck aria-hidden />Mark done</Button>}
              {canManage && m.status === "done" && !m.approvedOn && <Button size="sm" aria-label={`Approve ${m.stage} with feedback`} onClick={() => setApproving(m)}><ShieldCheck aria-hidden />Approve with feedback</Button>}
            </>)} />}
        </div>
      </Card>
      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle className="flex items-center gap-3">Meeting log <Badge className="border-border bg-muted text-muted-foreground"><Lock className="size-3.5" aria-hidden />Confidential</Badge></CardTitle>
          <CardDescription>Visible only to the supervisor who wrote it and the scholar. It never appears in unit or executive views.</CardDescription>
        </CardHeader>
        <div className="mt-4">
          {canLogMeeting && <LogMeetingForm scholarId={sid} />}
          {meetings.length === 0 ? <EmptyState title="No meetings logged" description={canLogMeeting ? "Use the form above to record your first meeting." : "Meeting notes the supervisor records will appear here."} /> : (
            <ul className="divide-y">{meetings.map((m) => (
              <li key={m.id} className="px-6 py-4 md:px-8"><p className="text-sm font-semibold">{formatDate(m.heldOn)}</p><p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{m.notes}</p></li>))}</ul>
          )}
        </div>
      </Card>
      <AddMilestoneDialog open={adding} onClose={() => setAdding(false)} scholarId={sid} scholarName={researcher.name} />
      <EditDueDateDialog milestone={editing} onClose={() => setEditing(undefined)} />
      <MarkDoneDialog milestone={finishing} onClose={() => setFinishing(undefined)} />
      <ApproveDialog milestone={approving} scholarName={researcher.name} onClose={() => setApproving(undefined)} />
    </div>
  );
}
