import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { FolderKanban, Lock, Plus } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth, can } from "@/app/auth";
import { formatMoney } from "@/lib/utils";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/form";
import { EmptyState, ErrorBanner, Skeleton } from "@/components/ui/feedback";
import { useToast } from "@/components/ui/toast";

export const projectSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(160, "Use 160 characters or fewer"),
  leadId: z.coerce.number().int().positive("Choose the lead"),
  status: z.enum(["proposed", "active", "completed"]),
  sensitivity: z.enum(["internal", "confidential"]),
  summary: z.string().trim().max(500, "Use 500 characters or fewer").optional(),
});
export type ProjectValues = z.infer<typeof projectSchema>;

export function SensitivityBadge({ value, restricted }: { value: "internal" | "confidential"; restricted?: boolean }) {
  return value === "confidential"
    ? <Badge className="border-warning/30 bg-warning/10 text-warning"><Lock className="size-3.5" aria-hidden />{restricted ? "Restricted" : "Confidential"}</Badge>
    : <Badge className="border-border bg-muted text-muted-foreground">Internal</Badge>;
}

export function ProjectDialog({ open, onClose, initial }: { open: boolean; onClose: () => void; initial?: { id: number } & ProjectValues }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const people = useQuery({ queryKey: ["directory"], queryFn: api.directory });
  const form = useForm<ProjectValues>({
    resolver: zodResolver(projectSchema) as never,
    values: initial ?? { title: "", leadId: 0, status: "proposed", sensitivity: "internal", summary: "" },
  });
  const save = useMutation({
    mutationFn: (v: ProjectValues) => api.saveProject({ ...v, id: initial?.id }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["projects"] }); qc.invalidateQueries({ queryKey: ["project"] }); toast({ tone: "ok", message: "Project saved." }); onClose(); },
    onError: () => toast({ tone: "error", message: "Couldn't save the project. Check the fields and your access." }),
  });
  const e = form.formState.errors;
  return (
    <Dialog open={open} onClose={onClose} title={initial ? "Edit project" : "New project"} description="A project groups awards, grants and publications. Confidential projects show as Restricted to people outside them.">
      <form onSubmit={form.handleSubmit((v) => save.mutate(v))} className="space-y-4" noValidate>
        <Field label="Title" error={e.title?.message}>{(a) => <Input {...a} {...form.register("title")} />}</Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Lead" error={e.leadId?.message}>{(a) => <Select {...a} {...form.register("leadId")}><option value="">Select…</option>{people.data?.filter((r) => r.kind !== "scholar").map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select>}</Field>
          <Field label="Status">{(a) => <Select {...a} {...form.register("status")}><option value="proposed">Proposed</option><option value="active">Active</option><option value="completed">Completed</option></Select>}</Field>
        </div>
        <Field label="Sensitivity" hint="Confidential: NDA or industry work. Budgets and links are hidden from non-members.">{(a) => <Select {...a} {...form.register("sensitivity")}><option value="internal">Internal</option><option value="confidential">Confidential</option></Select>}</Field>
        <Field label="Summary" error={e.summary?.message}>{(a) => <textarea {...a} rows={3} {...form.register("summary")} className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm" />}</Field>
        <div className="flex justify-end gap-3 pt-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={save.isPending}>Save project</Button></div>
      </form>
    </Dialog>
  );
}

export default function Projects() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const list = useQuery({ queryKey: ["projects"], queryFn: api.projects });
  return (
    <div>
      <PageHeader eyebrow="Research" title="Projects" description="Awards, grants and publications grouped by project. Confidential projects show only as Restricted to people outside them."
        actions={can.admin(user?.role) && <Button onClick={() => setOpen(true)}><Plus /> New project</Button>} />
      {list.isError && <ErrorBanner error={list.error} onRetry={() => list.refetch()} />}
      {list.isLoading ? <div className="grid gap-4 sm:grid-cols-2">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-32" />)}</div>
        : list.data?.length === 0 ? <Card><EmptyState title="No projects yet" description="Create a project to group the awards, grants and publications that belong together." icon={<FolderKanban className="size-6" aria-hidden />} /></Card>
        : (
          <ul className="grid gap-4 sm:grid-cols-2">{list.data?.map((p) => (
            <li key={p.id}>
              <Link to={`/projects/${p.id}`} className="block rounded-2xl">
                <Card hover className="h-full px-6 py-5">
                  <div className="mb-2 flex flex-wrap items-center gap-2"><SensitivityBadge value={p.sensitivity} restricted={p.restricted} />{!p.restricted && <Badge className="border-border bg-muted capitalize text-muted-foreground">{p.status}</Badge>}</div>
                  <h3 className="text-lg font-semibold tracking-tight">{p.title}</h3>
                  {p.restricted ? <p className="mt-1 text-sm text-muted-foreground">Details are limited to people on the project.</p> : (
                    <><p className="mt-1 text-sm text-muted-foreground">Lead: {p.leadName}</p>
                    <p className="mt-3 text-sm">{p.awardIds.length} awards · {p.grantIds.length} grants · {p.publicationIds.length} publications{p.funding ? ` · ${formatMoney(p.funding)}` : ""}</p></>)}
                </Card>
              </Link>
            </li>))}</ul>)}
      <ProjectDialog open={open} onClose={() => setOpen(false)} />
    </div>
  );
}
