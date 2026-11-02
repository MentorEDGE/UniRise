import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { AlertTriangle, Pencil, Plus, UserPlus, X } from "lucide-react";
import { api } from "@/lib/api";
import { HttpError } from "@/lib/http";
import { formatDate } from "@/lib/utils";
import type { Researcher } from "@/lib/types";
import type { AppointmentRow } from "@/mock/ext/people";
import { Badge, SourceChip, VerificationBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, ConfirmDialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/form";
import { EmptyState, ErrorBanner, Skeleton } from "@/components/ui/feedback";
import { useToast } from "@/components/ui/toast";
import { AssignDialog, relationshipLabel } from "./AssignDialog";
import { LeftBadge } from "./LeftBadge";

const List = () => <div className="space-y-3 p-6">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12" />)}</div>;

/* ---------------------------------- Claims ---------------------------------- */
export function ClaimsTab({ rid, own }: { rid: number; own: boolean }) {
  const claims = useQuery({ queryKey: ["claims", rid], queryFn: () => api.claims(rid), retry: false });
  if (claims.isLoading) return <List />;
  if (claims.isError) return <div className="p-6"><ErrorBanner error={claims.error} onRetry={() => claims.refetch()} /></div>;
  if (!claims.data?.length) return <EmptyState title="Nothing waiting to be confirmed" description="Publications that were found automatically but are not yet confirmed appear here." />;
  return (
    <div>
      <p className="border-b px-6 py-3 text-xs text-muted-foreground">Items found automatically that are not yet confirmed as this person's work. They do not count in reports until confirmed.
        {own && <> <Link to="/review" className="font-semibold text-primary hover:underline">Open your review queue</Link>.</>}</p>
      <ul className="divide-y">{claims.data.map((c) => (
        <li key={c.id} className="flex flex-wrap items-center gap-3 px-6 py-4">
          <div className="min-w-0 flex-1"><Link to={`/publications/${c.publication.id}`} className="font-medium hover:text-primary">{c.publication.title}</Link>
            <p className="text-xs text-muted-foreground">{c.publication.venue} · {c.publication.year}</p></div>
          <VerificationBadge state={c.state} /><SourceChip source={c.source} />
        </li>))}</ul>
    </div>
  );
}

/* -------------------------------- Supervision -------------------------------- */
export function SupervisionTab({ person, canAssign }: { person: Researcher; canAssign: boolean }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const view = useQuery({ queryKey: ["supervision", person.id], queryFn: () => api.supervision(person.id), retry: false });
  const [assign, setAssign] = useState<"primary" | "backup" | null>(null);
  const end = useMutation({
    mutationFn: (id: number) => api.endRelationship(id),
    onSuccess: () => { for (const k of ["supervision", "supervision-rows", "reassignments"]) qc.invalidateQueries({ queryKey: [k] }); toast({ tone: "ok", message: "Supervision ended." }); },
    onError: () => toast({ tone: "error", message: "Couldn't end this relationship. Try again." }),
  });
  const [ending, setEnding] = useState<number | null>(null);
  const scholar = person.kind === "scholar";

  if (view.isLoading) return <List />;
  if (view.isError) return <div className="p-6"><ErrorBanner error={view.error} onRetry={() => view.refetch()} /></div>;
  const v = view.data!;
  const entry = { id: person.id, name: person.name, title: person.title, departmentId: person.departmentId, kind: person.kind };

  return (
    <div>
      {v.needsReassignment && (
        <div role="alert" className="flex flex-wrap items-center gap-3 border-b border-warning/30 bg-warning/10 px-6 py-3 text-sm">
          <AlertTriangle className="size-4 shrink-0 text-warning" aria-hidden />
          <span className="flex-1">Their supervisor has left and there is no backup. This scholar needs a new supervisor.</span>
          {canAssign && <Button size="sm" onClick={() => setAssign("primary")}>Assign supervisor</Button>}
        </div>)}
      <section className="px-6 py-4" aria-label="Supervisors">
        <div className="mb-2 flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold">Supervised by</h3>
          {canAssign && scholar && <Button size="sm" variant="secondary" onClick={() => setAssign("backup")}><UserPlus /> Add supervisor</Button>}
        </div>
        {v.supervisors.length === 0 ? <p className="text-sm text-muted-foreground">{scholar ? "No active supervisor on record." : "Not supervised."}</p> : (
          <ul className="divide-y rounded-xl border">{v.supervisors.map((s) => (
            <li key={s.relationship.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1"><p className="font-medium">{s.mentor.name}</p><p className="text-xs text-muted-foreground">{s.mentor.title}{s.relationship.validFrom ? ` · since ${formatDate(s.relationship.validFrom)}` : ""}</p></div>
              <Badge className="border-violet-200 bg-violet-50 text-violet-700 dark:border-white/10 dark:bg-white/5 dark:text-violet-300">{relationshipLabel[s.relationship.type]}</Badge>
              {s.mentorLeft && <LeftBadge />}
              {canAssign && <Button size="sm" variant="ghost" aria-label={`End supervision by ${s.mentor.name}`} onClick={() => setEnding(s.relationship.id)}><X /> End</Button>}
            </li>))}</ul>)}
      </section>
      {v.mentees.length > 0 && (
        <section className="border-t px-6 py-4" aria-label="Scholars supervised">
          <h3 className="mb-2 text-sm font-semibold">Supervises</h3>
          <ul className="divide-y rounded-xl border">{v.mentees.map((m) => (
            <li key={m.relationship.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <Link to={`/people/${m.mentee.id}`} className="min-w-0 flex-1 font-medium hover:text-primary">{m.mentee.name}</Link>
              <Badge className="border-violet-200 bg-violet-50 text-violet-700 dark:border-white/10 dark:bg-white/5 dark:text-violet-300">{relationshipLabel[m.relationship.type]}</Badge>
            </li>))}</ul>
        </section>)}
      <AssignDialog scholar={entry} open={assign !== null} onClose={() => setAssign(null)} defaultType={assign ?? "primary"} />
      <ConfirmDialog open={ending !== null} onClose={() => setEnding(null)} confirmLabel="End supervision" title="End this supervision?"
        description="It stops applying from today. Past supervision stays on record."
        loading={end.isPending} onConfirm={() => { if (ending !== null) end.mutate(ending, { onSettled: () => setEnding(null) }); }} />
    </div>
  );
}

/* -------------------------------- Appointments -------------------------------- */
const apptSchema = z.object({
  unitId: z.coerce.number().int().positive("Choose a unit"),
  designation: z.string().trim().min(1, "Designation is required"),
  fte: z.coerce.number().gt(0, "Enter a share above 0").max(1, "Enter a share of 1 or less"),
  validFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a start date"),
  validTo: z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/, "Choose a valid date").optional(),
}).refine((v) => !v.validTo || v.validTo >= v.validFrom, { path: ["validTo"], message: "The end date can't be before the start date" });
type ApptValues = z.input<typeof apptSchema>;

function AppointmentDialog({ rid, initial, open, onClose }: { rid: number; initial?: AppointmentRow; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const units = useQuery({ queryKey: ["org-units"], queryFn: api.orgUnits, enabled: open });
  const form = useForm<ApptValues>({
    resolver: zodResolver(apptSchema) as never,
    values: initial ? { unitId: initial.unitId, designation: initial.designation, fte: initial.fte, validFrom: initial.validFrom, validTo: initial.validTo ?? "" }
      : { unitId: 0, designation: "", fte: 0.25, validFrom: new Date().toISOString().slice(0, 10), validTo: "" },
  });
  const save = useMutation({
    mutationFn: (v: ApptValues) => {
      const p = apptSchema.parse(v);
      return api.saveAppointment({ id: initial?.id, researcherId: rid, unitId: p.unitId, designation: p.designation, fte: p.fte, validFrom: p.validFrom, validTo: p.validTo || undefined });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["appointments", rid] }); toast({ tone: "ok", message: "Appointment saved." }); onClose(); },
    onError: (e) => toast({ tone: "error", message: e instanceof HttpError && e.status === 409 ? "This person already has an appointment in that unit for these dates." : "Couldn't save the appointment. Check the details and try again." }),
  });
  const e = form.formState.errors;
  return (
    <Dialog open={open} onClose={onClose} title={initial ? "Edit appointment" : "Add appointment"} description="A joint appointment is a second appointment in another unit, valid at the same time.">
      <form className="space-y-4" noValidate onSubmit={form.handleSubmit((v) => save.mutate(v))}>
        <Field label="Unit" error={e.unitId?.message}>{(a) => <Select {...a} {...form.register("unitId")}><option value="">Select…</option>
          {units.data?.filter((u) => u.type !== "institution").map((u) => <option key={u.id} value={u.id}>{u.name} ({u.type})</option>)}</Select>}</Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Designation" error={e.designation?.message}>{(a) => <Input {...a} {...form.register("designation")} />}</Field>
          <Field label="Share of full time (0 to 1)" error={e.fte?.message} hint="1 = full time, 0.25 = a quarter.">{(a) => <Input {...a} type="number" step="0.05" min="0" max="1" {...form.register("fte")} />}</Field>
          <Field label="From" error={e.validFrom?.message}>{(a) => <Input {...a} type="date" {...form.register("validFrom")} />}</Field>
          <Field label="Until (optional)" error={e.validTo?.message}>{(a) => <Input {...a} type="date" {...form.register("validTo")} />}</Field>
        </div>
        <div className="flex justify-end gap-3 pt-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={save.isPending}>Save</Button></div>
      </form>
    </Dialog>
  );
}

export function AppointmentsTab({ rid, admin }: { rid: number; admin: boolean }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const rows = useQuery({ queryKey: ["appointments", rid], queryFn: () => api.appointments(rid), retry: false });
  const [editing, setEditing] = useState<AppointmentRow | undefined>();
  const [open, setOpen] = useState(false);
  const [ending, setEnding] = useState<AppointmentRow | null>(null);
  const end = useMutation({
    mutationFn: (id: number) => api.endAppointment(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["appointments", rid] }); toast({ tone: "ok", message: "Appointment ended." }); },
    onError: () => toast({ tone: "error", message: "Couldn't end the appointment. Try again." }),
  });
  const now = new Date().toISOString().slice(0, 10);

  if (rows.isLoading) return <List />;
  if (rows.isError) return <div className="p-6"><ErrorBanner error={rows.error} onRetry={() => rows.refetch()} /></div>;
  return (
    <div>
      <div className="flex items-center justify-between gap-3 border-b px-6 py-3">
        <p className="text-xs text-muted-foreground">Publications and grants are credited to the units a person belonged to on the date, so past moves are kept.</p>
        {admin && <Button size="sm" onClick={() => { setEditing(undefined); setOpen(true); }}><Plus /> Add appointment</Button>}
      </div>
      {rows.data?.length === 0 ? <EmptyState title="No appointments on record" description="Appointments say which units this person belongs to, and for how long."
        action={admin ? <Button onClick={() => { setEditing(undefined); setOpen(true); }}><Plus /> Add appointment</Button> : undefined} /> : (
        <ul className="divide-y">{rows.data?.map((a) => {
          const current = a.validFrom <= now && (!a.validTo || a.validTo >= now);
          return (
            <li key={a.id} className="flex flex-wrap items-center gap-3 px-6 py-4">
              <div className="min-w-0 flex-1"><p className="font-medium">{a.unitName}</p>
                <p className="text-xs text-muted-foreground">{a.designation} · {Math.round(a.fte * 100)}% time · {formatDate(a.validFrom)} to {a.validTo ? formatDate(a.validTo) : "now"}</p></div>
              <Badge className={current ? "border-success/30 bg-success/10 text-success" : "border-border bg-muted text-muted-foreground"}>{current ? "Current" : a.validFrom > now ? "Upcoming" : "Ended"}</Badge>
              {admin && (<>
                <Button variant="ghost" size="icon" aria-label={`Edit appointment in ${a.unitName}`} onClick={() => { setEditing(a); setOpen(true); }}><Pencil /></Button>
                {(!a.validTo || a.validTo > now) && <Button variant="ghost" size="sm" aria-label={`End appointment in ${a.unitName}`} onClick={() => setEnding(a)}>End</Button>}
              </>)}
            </li>);
        })}</ul>)}
      <AppointmentDialog rid={rid} initial={editing} open={open} onClose={() => setOpen(false)} />
      <ConfirmDialog open={ending !== null} onClose={() => setEnding(null)} confirmLabel="End appointment" title={`End the appointment in ${ending?.unitName ?? "this unit"}?`}
        description="It stops applying from today. Work already credited to this unit stays credited." loading={end.isPending}
        onConfirm={() => { if (ending) end.mutate(ending.id, { onSettled: () => setEnding(null) }); }} />
    </div>
  );
}
