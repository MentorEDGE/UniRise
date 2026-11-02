import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Pencil, Plus, Search } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth, can } from "@/app/auth";
import { useListParams } from "@/lib/useListParams";
import { ORCID_RE, orcidUrl, initials } from "@/lib/utils";
import type { Researcher } from "@/lib/types";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";
import { EmptyState, ErrorBanner, Skeleton } from "@/components/ui/feedback";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";

const schema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  email: z.string().trim().email("Enter a valid email"),
  title: z.string().trim().min(1, "Title is required"),
  orcid: z.string().trim().refine((v) => v === "" || ORCID_RE.test(v), "Use the format 0000-0002-1825-0097").optional(),
  departmentId: z.coerce.number().int().positive("Choose a department"),
});
type Values = z.infer<typeof schema>;

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
    </Dialog>
  );
}

export default function People() {
  const { user } = useAuth();
  const { get, set } = useListParams({});
  const [editing, setEditing] = useState<Researcher | undefined>();
  const [open, setOpen] = useState(false);
  const deptId = get("dept") ? Number(get("dept")) : undefined;
  const q = get("q");
  const people = useQuery({ queryKey: ["researchers", deptId, q], queryFn: () => api.researchers(deptId, q || undefined) });
  const depts = useQuery({ queryKey: ["departments"], queryFn: api.departments });
  const deptName = (id: number) => depts.data?.find((d) => d.id === id)?.name ?? "—";
  const admin = can.admin(user?.role);

  return (
    <div>
      <PageHeader eyebrow="Directory" title="People" description="Researchers and their ORCID connection status."
        actions={<>{admin && <Link to="/organisation" className="inline-flex h-10 items-center rounded-xl border px-4 text-sm font-semibold hover:bg-secondary/60">Organisation</Link>}
          {admin && <Button onClick={() => { setEditing(undefined); setOpen(true); }}><Plus /> Add researcher</Button>}</>} />

      <Card className="mb-4 p-4">
        <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
          <div className="relative"><Search className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground" aria-hidden />
            <Input aria-label="Search people" className="pl-9" placeholder="Search by name" defaultValue={q} onChange={(e) => set({ q: e.target.value })} /></div>
          <Select aria-label="Department" value={get("dept")} onChange={(e) => set({ dept: e.target.value })}>
            <option value="">All departments</option>{depts.data?.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select>
        </div>
      </Card>

      {people.isError && <ErrorBanner error={people.error} onRetry={() => people.refetch()} />}
      <Card className="overflow-hidden">
        {people.isLoading ? <div className="space-y-3 p-6">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-12" />)}</div>
          : people.data?.length === 0 ? <EmptyState title="No researchers yet" description="Add researchers or import staff to start harvesting publications." />
          : (<>
            <div className="hidden md:block"><Table>
              <THead><tr><TH>Name</TH><TH>Department</TH><TH>ORCID</TH><TH>Publications</TH><TH><span className="sr-only">Actions</span></TH></tr></THead>
              <TBody>{people.data?.map((r) => (
                <TR key={r.id}>
                  <TD><Link to={`/people/${r.id}`} className="flex items-center gap-3 font-medium hover:text-primary">
                    <span className="grid size-9 place-items-center rounded-full bg-secondary text-xs font-bold text-primary" aria-hidden>{initials(r.name.replace("Dr. ", ""))}</span>
                    <span>{r.name}<span className="block text-xs font-normal text-muted-foreground">{r.title}</span></span></Link></TD>
                  <TD>{deptName(r.departmentId)}</TD>
                  <TD>{r.orcid ? <a className="text-primary hover:underline" href={orcidUrl(r.orcid)} target="_blank" rel="noopener noreferrer">{r.orcid}</a> : <span className="text-muted-foreground">Not connected</span>}</TD>
                  <TD>{r.publicationCount ?? 0}</TD>
                  <TD>{admin && <Button variant="ghost" size="icon" aria-label={`Edit ${r.name}`} onClick={() => { setEditing(r); setOpen(true); }}><Pencil /></Button>}</TD>
                </TR>))}</TBody></Table></div>
            <ul className="divide-y md:hidden">{people.data?.map((r) => (
              <li key={r.id} className="p-4"><Link to={`/people/${r.id}`} className="font-medium">{r.name}</Link>
                <p className="text-xs text-muted-foreground">{r.title} · {deptName(r.departmentId)}</p></li>))}</ul>
          </>)}
      </Card>
      <ResearcherDialog open={open} onClose={() => setOpen(false)} initial={editing} />
    </div>
  );
}
