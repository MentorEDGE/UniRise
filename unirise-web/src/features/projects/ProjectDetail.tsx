import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Link2, Link2Off, Lock, Pencil } from "lucide-react";
import { api } from "@/lib/api";
import { formatMoney } from "@/lib/utils";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/form";
import { EmptyState, ErrorBanner, Skeleton } from "@/components/ui/feedback";
import { useToast } from "@/components/ui/toast";
import { ProjectDialog, SensitivityBadge } from "./Projects";

type Kind = "award" | "grant" | "publication";

function LinkPicker({ kind, options, onAdd }: { kind: Kind; options: { id: number; label: string }[]; onAdd: (id: number) => void }) {
  const [value, setValue] = useState("");
  return (
    <form className="mt-3 flex gap-2 px-6 pb-4 md:px-8" onSubmit={(e) => { e.preventDefault(); if (value) { onAdd(Number(value)); setValue(""); } }}>
      <Select aria-label={`Add a ${kind}`} value={value} onChange={(e) => setValue(e.target.value)}><option value="">Add a {kind}…</option>{options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</Select>
      <Button type="submit" variant="secondary" disabled={!value}><Link2 /> Link</Button>
    </form>
  );
}

export default function ProjectDetail() {
  const { id } = useParams();
  const pid = Number(id);
  const qc = useQueryClient();
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const q = useQuery({ queryKey: ["project", pid], queryFn: () => api.project(pid), retry: false });
  const awards = useQuery({ queryKey: ["awards"], queryFn: api.awards, enabled: !!q.data?.canEdit });
  const grants = useQuery({ queryKey: ["grants"], queryFn: api.grants, enabled: !!q.data?.canEdit });
  const pubs = useQuery({ queryKey: ["publications", "for-project"], queryFn: () => api.publications({ page: 0, size: 200, sort: "year:desc" }), enabled: !!q.data?.canEdit });
  const done = () => { qc.invalidateQueries({ queryKey: ["project", pid] }); qc.invalidateQueries({ queryKey: ["projects"] }); };
  const link = useMutation({ mutationFn: (v: { kind: Kind; itemId: number }) => api.linkToProject({ id: pid, ...v }), onSuccess: done, onError: () => toast({ tone: "error", message: "Couldn't link that item." }) });
  const unlink = useMutation({ mutationFn: (v: { kind: Kind; itemId: number }) => api.unlinkFromProject({ id: pid, ...v }), onSuccess: done, onError: () => toast({ tone: "error", message: "Couldn't unlink that item." }) });

  if (q.isError) return <ErrorBanner error={q.error} />;
  if (q.isLoading || !q.data) return <Skeleton className="h-64 w-full" />;
  const p = q.data;

  if (p.restricted) return (
    <div className="max-w-2xl">
      <Link to="/projects" className="mb-4 inline-flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-primary"><ArrowLeft className="size-4" aria-hidden />All projects</Link>
      <Card><EmptyState icon={<Lock className="size-6" aria-hidden />} title="Restricted project" description="This project is confidential. Its title, budget and links are visible only to the people on it and the research office." /></Card>
    </div>
  );

  const unlinkBtn = (kind: Kind, itemId: number, label: string) => p.canEdit && <Button size="sm" variant="ghost" aria-label={`Unlink ${label}`} onClick={() => unlink.mutate({ kind, itemId })}><Link2Off /></Button>;
  const sections: { kind: Kind; title: string; rows: { id: number; label: string; sub: string }[]; options: { id: number; label: string }[] }[] = [
    { kind: "award", title: "Awards", rows: (p.awards ?? []).map((a) => ({ id: a.id, label: a.title, sub: `${a.funder} · ${formatMoney(a.amount)}` })), options: (awards.data ?? []).filter((a) => !p.awardIds.includes(a.id)).map((a) => ({ id: a.id, label: a.title })) },
    { kind: "grant", title: "Grants", rows: (p.grants ?? []).map((g) => ({ id: g.id, label: g.title, sub: `${g.agency} · ${g.status}` })), options: (grants.data ?? []).filter((g) => !p.grantIds.includes(g.id)).map((g) => ({ id: g.id, label: g.title })) },
    { kind: "publication", title: "Publications", rows: (p.publications ?? []).map((x) => ({ id: x.id, label: x.title, sub: `${x.venue} · ${x.year}` })), options: (pubs.data?.items ?? []).filter((x) => !p.publicationIds.includes(x.id)).map((x) => ({ id: x.id, label: x.title })) },
  ];

  return (
    <div className="max-w-4xl">
      <Link to="/projects" className="mb-4 inline-flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-primary"><ArrowLeft className="size-4" aria-hidden />All projects</Link>
      <PageHeader eyebrow="Project" title={p.title} description={p.summary}
        actions={p.canEdit && <Button variant="secondary" onClick={() => setEditing(true)}><Pencil /> Edit</Button>} />
      <div className="mb-6 flex flex-wrap items-center gap-3"><SensitivityBadge value={p.sensitivity} /><Badge className="border-border bg-muted capitalize text-muted-foreground">{p.status}</Badge>
        <span className="text-sm text-muted-foreground">Lead: {p.leadName}</span>
        <span className="text-sm font-semibold">Funding linked: {formatMoney(p.funding ?? 0)}</span></div>
      <div className="space-y-6">
        {sections.map((s) => (
          <Card key={s.kind} className="overflow-hidden">
            <CardHeader><CardTitle>{s.title}</CardTitle><CardDescription>{s.rows.length} linked</CardDescription></CardHeader>
            <CardContent className="px-0 pb-0 md:px-0 md:pb-2">
              {s.rows.length === 0 ? <p className="px-6 pb-2 text-sm text-muted-foreground md:px-8">Nothing linked yet.</p> : (
                <ul className="divide-y">{s.rows.map((r) => (
                  <li key={r.id} className="flex items-center gap-3 px-6 py-3 md:px-8">
                    <div className="min-w-0 flex-1"><p className="font-medium">{r.label}</p><p className="text-xs text-muted-foreground">{r.sub}</p></div>
                    {unlinkBtn(s.kind, r.id, r.label)}
                  </li>))}</ul>)}
              {p.canEdit && <LinkPicker kind={s.kind} options={s.options} onAdd={(itemId) => link.mutate({ kind: s.kind, itemId })} />}
            </CardContent>
          </Card>))}
      </div>
      <ProjectDialog open={editing} onClose={() => setEditing(false)} initial={{ id: p.id, title: p.title, leadId: p.leadId, status: p.status, sensitivity: p.sensitivity, summary: p.summary ?? "" }} />
    </div>
  );
}
