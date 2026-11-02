import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { AlertTriangle, FileUp, LogOut, Pencil, Plus, Search, Undo2 } from "lucide-react";
import { api } from "@/lib/api";
import { HttpError } from "@/lib/http";
import { useAuth, can } from "@/app/auth";
import { useListParams } from "@/lib/useListParams";
import { ORCID_RE, orcidUrl, initials } from "@/lib/utils";
import type { Researcher } from "@/lib/types";
import type { StatusFilter } from "@/mock/ext/people";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";
import { EmptyState, ErrorBanner, Skeleton } from "@/components/ui/feedback";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { ImportDialog } from "./ImportDialog";
import { LeftBadge } from "./LeftBadge";

const schema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  email: z.string().trim().email("Enter a valid email"),
  title: z.string().trim().min(1, "Title is required"),
  orcid: z.string().trim().refine((v) => v === "" || ORCID_RE.test(v), "Use the format 0000-0002-1825-0097").optional(),
  departmentId: z.coerce.number().int().positive("Choose a department"),
});
type Values = z.infer<typeof schema>;

const dateSchema = z.object({ leftOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the last day") });

/** Mark as left (R8): a date and a plain warning before anything changes. */
function LeavePanel({ person, onDone }: { person: Researcher; onDone: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const form = useForm<{ leftOn: string }>({ resolver: zodResolver(dateSchema) as never, defaultValues: { leftOn: new Date().toISOString().slice(0, 10) } });
  const refresh = () => { for (const k of ["researchers", "researcher", "summary", "reassignments", "supervision", "supervision-rows", "appointments", "role-grants"]) qc.invalidateQueries({ queryKey: [k] }); };
  const leave = useMutation({
    mutationFn: (v: { leftOn: string }) => api.markLeft({ researcherId: person.id, leftOn: v.leftOn }),
    onSuccess: (r) => { refresh(); toast({ tone: "ok", message: `${person.name} is marked as left. ${r.endedAppointments} appointment(s) and ${r.endedRoleGrants} role grant(s) ended.` }); onDone(); },
    onError: (e) => toast({ tone: "error", message: e instanceof HttpError && e.status === 409 ? "This person is already marked as left." : "Couldn't update this person. Try again." }),
  });
  const back = useMutation({
    mutationFn: () => api.reinstate(person.id),
    onSuccess: () => { refresh(); toast({ tone: "ok", message: `${person.name} is active again. Ended appointments and roles are not restored; add them again if needed.` }); onDone(); },
    onError: () => toast({ tone: "error", message: "Couldn't reinstate this person. Try again." }),
  });

  if (person.status === "left") {
    return (
      <div className="rounded-xl border bg-secondary/40 p-4 text-sm">
        <p className="flex items-center gap-2 font-medium"><LeftBadge leftOn={person.leftOn} /></p>
        <p className="mt-2 text-muted-foreground">Reinstating makes this person active again. Appointments and roles that ended are not restored automatically.</p>
        <Button className="mt-3" variant="secondary" size="sm" loading={back.isPending} onClick={() => back.mutate()}><Undo2 /> Reinstate</Button>
      </div>
    );
  }
  if (!open) return <div className="border-t pt-4"><Button variant="secondary" size="sm" onClick={() => setOpen(true)}><LogOut /> Mark as left…</Button></div>;
  return (
    <form className="space-y-3 rounded-xl border border-warning/40 bg-warning/10 p-4" noValidate onSubmit={form.handleSubmit((v) => leave.mutate(v))}>
      <p className="flex items-start gap-2 text-sm"><AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
        <span>This ends their access, their appointments and their role grants on the date you choose. Their publications, awards and grants stay in reports. Scholars they supervise will need a new supervisor.</span></p>
      <Field label="Last day at the institution" error={form.formState.errors.leftOn?.message}>{(a) => <Input {...a} type="date" {...form.register("leftOn")} />}</Field>
      <div className="flex justify-end gap-3"><Button variant="secondary" size="sm" onClick={() => setOpen(false)}>Cancel</Button><Button variant="destructive" size="sm" type="submit" loading={leave.isPending}>Mark {person.name} as left</Button></div>
    </form>
  );
}

function ResearcherDialog({ open, onClose, initial }: { open: boolean; onClose: () => void; initial?: Researcher }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const depts = useQuery({ queryKey: ["departments"], queryFn: api.departments });
  const form = useForm<Values>({
    resolver: zodResolver(schema) as never,
    values: initial ? { ...initial, orcid: initial.orcid ?? "" } : { name: "", email: "", title: "", orcid: "", departmentId: 0 },
  });
  const save = useMutation({
    mutationFn: (v: Values) => api.saveResearcher({ ...v, orcid: v.orcid || undefined, id: initial?.id }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["researchers"] }); qc.invalidateQueries({ queryKey: ["summary"] });
      toast({ tone: "ok", message: "Researcher saved." }); onClose(); form.reset();
    },
    onError: () => toast({ tone: "error", message: "Couldn't save. Try again." }),
  });
  const e = form.formState.errors;
  return (
    <Dialog open={open} onClose={onClose} title={initial ? "Edit researcher" : "Add researcher"}>
      <form onSubmit={form.handleSubmit((v) => save.mutate(v))} className="space-y-4" noValidate>
        <Field label="Full name" error={e.name?.message}>{(a) => <Input {...a} {...form.register("name")} />}</Field>
        <Field label="Email" error={e.email?.message}>{(a) => <Input {...a} type="email" {...form.register("email")} />}</Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Title" error={e.title?.message}>{(a) => <Input {...a} {...form.register("title")} />}</Field>
          <Field label="Department" error={e.departmentId?.message}>
            {(a) => <Select {...a} {...form.register("departmentId")}><option value="">Select…</option>{depts.data?.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select>}
          </Field>
        </div>
        <Field label="ORCID iD" error={e.orcid?.message} hint="Optional. Lets us find publications automatically.">{(a) => <Input {...a} {...form.register("orcid")} placeholder="0000-0002-1825-0097" />}</Field>
        <div className="flex justify-end gap-3 pt-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={save.isPending}>Save</Button></div>
      </form>
      {initial && <div className="mt-6"><LeavePanel person={initial} onDone={onClose} /></div>}
    </Dialog>
  );
}

const statusOptions: { value: StatusFilter; label: string }[] = [{ value: "active", label: "Active" }, { value: "left", label: "Left" }, { value: "all", label: "Active and left" }];

export default function People() {
  const { user } = useAuth();
  const { get, set } = useListParams({ status: "active" });
  const [editing, setEditing] = useState<Researcher | undefined>();
  const [open, setOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const deptId = get("dept") ? Number(get("dept")) : undefined;
  const q = get("q");
  const status = (statusOptions.some((o) => o.value === get("status")) ? get("status") : "active") as StatusFilter;
  const people = useQuery({ queryKey: ["researchers", deptId, q, status], queryFn: () => api.researchers(deptId, q || undefined, status) });
  const depts = useQuery({ queryKey: ["departments"], queryFn: api.departments });
  const deptName = (id: number) => depts.data?.find((d) => d.id === id)?.name ?? "—";
  const admin = can.admin(user?.role);
  const filtered = !!(q || deptId || status !== "active");

  return (
    <div>
      <PageHeader eyebrow="Directory" title="People" description="Researchers and their ORCID connection status."
        actions={<>{admin && <Link to="/organisation" className="inline-flex h-10 items-center rounded-xl border px-4 text-sm font-semibold hover:bg-secondary/60">Organisation</Link>}
          {admin && <Button variant="secondary" onClick={() => setImporting(true)}><FileUp /> Import CSV</Button>}
          {admin && <Button onClick={() => { setEditing(undefined); setOpen(true); }}><Plus /> Add researcher</Button>}</>} />

      <Card className="mb-4 p-4">
        <div className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr]">
          <div className="relative"><Search className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground" aria-hidden />
            <Input aria-label="Search people" className="pl-9" placeholder="Search by name" defaultValue={q} onChange={(e) => set({ q: e.target.value })} /></div>
          <Select aria-label="Department" value={get("dept")} onChange={(e) => set({ dept: e.target.value })}>
            <option value="">All departments</option>{depts.data?.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select>
          <Select aria-label="Status" value={status} onChange={(e) => set({ status: e.target.value === "active" ? "" : e.target.value })}>
            {statusOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select>
        </div>
      </Card>

      {people.isError && <ErrorBanner error={people.error} onRetry={() => people.refetch()} />}
      <Card className="overflow-hidden">
        {people.isLoading ? <div className="space-y-3 p-6">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-12" />)}</div>
          : people.data?.length === 0 ? (filtered
            ? <EmptyState title="No one matches" description="Try a different search, department or status." action={<Button variant="secondary" onClick={() => set({ q: "", dept: "", status: "" })}>Clear filters</Button>} />
            : <EmptyState title="No researchers yet" description="Add researchers or import staff to start harvesting publications."
              action={admin ? <Button onClick={() => setImporting(true)}><FileUp /> Import CSV</Button> : undefined} />)
          : (<>
            <div className="hidden md:block"><Table>
              <THead><tr><TH>Name</TH><TH>Department</TH><TH>ORCID</TH><TH>Publications</TH><TH><span className="sr-only">Actions</span></TH></tr></THead>
              <TBody>{people.data?.map((r) => (
                <TR key={r.id}>
                  <TD><Link to={`/people/${r.id}`} className="flex items-center gap-3 font-medium hover:text-primary">
                    <span className="grid size-9 place-items-center rounded-full bg-secondary text-xs font-bold text-primary" aria-hidden>{initials(r.name.replace("Dr. ", ""))}</span>
                    <span>{r.name}<span className="block text-xs font-normal text-muted-foreground">{r.title}</span></span></Link>
                    {r.status === "left" && <div className="mt-1 pl-12"><LeftBadge leftOn={r.leftOn} /></div>}</TD>
                  <TD>{deptName(r.departmentId)}</TD>
                  <TD>{r.orcid ? <a className="text-primary hover:underline" href={orcidUrl(r.orcid)} target="_blank" rel="noopener noreferrer">{r.orcid}</a> : <span className="text-muted-foreground">Not connected</span>}</TD>
                  <TD>{r.publicationCount ?? 0}</TD>
                  <TD>{admin && <Button variant="ghost" size="icon" aria-label={`Edit ${r.name}`} onClick={() => { setEditing(r); setOpen(true); }}><Pencil /></Button>}</TD>
                </TR>))}</TBody></Table></div>
            <ul className="divide-y md:hidden">{people.data?.map((r) => (
              <li key={r.id} className="flex items-start justify-between gap-3 p-4"><div><Link to={`/people/${r.id}`} className="font-medium">{r.name}</Link>
                <p className="text-xs text-muted-foreground">{r.title} · {deptName(r.departmentId)}</p>
                {r.status === "left" && <div className="mt-1"><LeftBadge leftOn={r.leftOn} /></div>}</div>
                {admin && <Button variant="ghost" size="icon" aria-label={`Edit ${r.name}`} onClick={() => { setEditing(r); setOpen(true); }}><Pencil /></Button>}</li>))}</ul>
          </>)}
      </Card>
      <ResearcherDialog open={open} onClose={() => setOpen(false)} initial={editing} />
      {admin && <ImportDialog kind="people" open={importing} onClose={() => setImporting(false)} />}
    </div>
  );
}
