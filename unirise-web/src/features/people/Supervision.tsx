import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Search, UserPlus, X } from "lucide-react";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/utils";
import type { DirectoryEntry, RelationshipType } from "@/lib/types";
import type { SupervisionRow } from "@/mock/ext/people";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import { ConfirmDialog } from "@/components/ui/dialog";
import { EmptyState, ErrorBanner, Skeleton } from "@/components/ui/feedback";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { AssignDialog, relationshipLabel } from "./AssignDialog";
import { LeftBadge } from "./LeftBadge";

const chip = "border-violet-200 bg-violet-50 text-violet-700 dark:border-white/10 dark:bg-white/5 dark:text-violet-300";

export default function Supervision() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const reassign = useQuery({ queryKey: ["reassignments"], queryFn: api.reassignments, retry: false });
  const rows = useQuery({ queryKey: ["supervision-rows"], queryFn: api.supervisionRows, retry: false });
  const [dialog, setDialog] = useState<{ scholar: DirectoryEntry; type: RelationshipType; title?: string } | null>(null);
  const [ending, setEnding] = useState<SupervisionRow | null>(null);
  const [q, setQ] = useState("");

  const end = useMutation({
    mutationFn: (id: number) => api.endRelationship(id),
    onSuccess: () => { for (const k of ["supervision-rows", "reassignments", "supervision"]) qc.invalidateQueries({ queryKey: [k] }); toast({ tone: "ok", message: "Supervision ended." }); },
    onError: () => toast({ tone: "error", message: "Couldn't end this relationship. Try again." }),
  });

  const needing = reassign.data ?? [];
  const shown = (rows.data ?? []).filter((r) => !q || (r.scholar.name + " " + r.mentor.name).toLowerCase().includes(q.toLowerCase()));

  return (
    <div>
      <PageHeader eyebrow="Directory" title="Supervision" description="Who supervises which scholar. When a supervisor leaves, their scholars are listed here until a new supervisor is assigned." />

      {reassign.isError && <div className="mb-4"><ErrorBanner error={reassign.error} onRetry={() => reassign.refetch()} /></div>}
      {reassign.isLoading ? <Skeleton className="mb-6 h-24" /> : needing.length > 0 && (
        <section aria-labelledby="needs-heading" className="mb-6">
          <div role="alert" className="mb-3 flex items-center gap-3 rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm">
            <AlertTriangle className="size-5 shrink-0 text-warning" aria-hidden />
            <h2 id="needs-heading" className="font-semibold">{needing.length} {needing.length === 1 ? "scholar needs" : "scholars need"} a new supervisor</h2>
            <span className="text-muted-foreground">Their only supervisor has left and no backup is set.</span>
          </div>
          <Card><ul className="divide-y">{needing.map((n) => (
            <li key={n.scholar.id} className="flex flex-wrap items-center gap-3 px-6 py-4">
              <div className="min-w-0 flex-1">
                <Link to={`/people/${n.scholar.id}`} className="font-medium hover:text-primary">{n.scholar.name}</Link>
                <p className="text-xs text-muted-foreground">Was supervised by {n.leftSupervisor.name}{n.leftOn ? `, who left on ${formatDate(n.leftOn)}` : ""}</p>
              </div>
              <LeftBadge leftOn={n.leftOn} />
              <Button size="sm" onClick={() => setDialog({ scholar: n.scholar, type: "primary", title: `Reassign ${n.scholar.name}` })}>Reassign</Button>
            </li>))}</ul></Card>
        </section>)}
      {!reassign.isLoading && !reassign.isError && needing.length === 0 && (
        <p className="mb-6 rounded-xl border bg-secondary/40 p-3 text-sm text-muted-foreground" role="status">Every scholar in your scope has an active supervisor.</p>)}

      <Card className="mb-4 p-4"><div className="relative"><Search className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground" aria-hidden />
        <Input aria-label="Search by scholar or supervisor" className="pl-9" placeholder="Search by scholar or supervisor" value={q} onChange={(e) => setQ(e.target.value)} /></div></Card>

      {rows.isError && <ErrorBanner error={rows.error} onRetry={() => rows.refetch()} />}
      <Card className="overflow-hidden">
        {rows.isLoading ? <div className="space-y-3 p-6">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-12" />)}</div>
          : shown.length === 0 ? (q ? <EmptyState title="No match" description="Try a different name." action={<Button variant="secondary" onClick={() => setQ("")}>Clear search</Button>} />
            : <EmptyState title="No supervision recorded" description="Scholars appear here once a supervisor is assigned. Open a scholar's profile to assign one." action={<Link to="/people" className="inline-flex h-10 items-center rounded-xl border px-4 text-sm font-semibold hover:bg-secondary/60">Go to people</Link>} />)
          : (<>
            <div className="hidden md:block"><Table>
              <THead><tr><TH>Scholar</TH><TH>Supervisor</TH><TH>Role</TH><TH>Since</TH><TH><span className="sr-only">Actions</span></TH></tr></THead>
              <TBody>{shown.map((r) => (
                <TR key={r.relationship.id}>
                  <TD><Link to={`/people/${r.scholar.id}`} className="font-medium hover:text-primary">{r.scholar.name}</Link></TD>
                  <TD><span className="flex flex-wrap items-center gap-2">{r.mentor.name}{r.mentorLeft && <LeftBadge />}</span></TD>
                  <TD><Badge className={chip}>{relationshipLabel[r.relationship.type]}</Badge></TD>
                  <TD>{r.relationship.validFrom ? formatDate(r.relationship.validFrom) : <span className="text-muted-foreground">—</span>}</TD>
                  <TD><div className="flex justify-end gap-1">
                    <Button size="sm" variant="ghost" aria-label={`Add a backup supervisor for ${r.scholar.name}`} onClick={() => setDialog({ scholar: r.scholar, type: "backup", title: `Add a supervisor for ${r.scholar.name}` })}><UserPlus /> Add</Button>
                    <Button size="sm" variant="ghost" aria-label={`End ${r.mentor.name} as supervisor of ${r.scholar.name}`} onClick={() => setEnding(r)}><X /> End</Button>
                  </div></TD>
                </TR>))}</TBody></Table></div>
            <ul className="divide-y md:hidden">{shown.map((r) => (
              <li key={r.relationship.id} className="space-y-2 p-4">
                <Link to={`/people/${r.scholar.id}`} className="font-medium">{r.scholar.name}</Link>
                <p className="flex flex-wrap items-center gap-2 text-sm">{r.mentor.name}<Badge className={chip}>{relationshipLabel[r.relationship.type]}</Badge>{r.mentorLeft && <LeftBadge />}</p>
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" onClick={() => setDialog({ scholar: r.scholar, type: "backup", title: `Add a supervisor for ${r.scholar.name}` })}><UserPlus /> Add</Button>
                  <Button size="sm" variant="secondary" onClick={() => setEnding(r)}><X /> End</Button>
                </div>
              </li>))}</ul>
          </>)}
      </Card>

      <AssignDialog scholar={dialog?.scholar} open={dialog !== null} onClose={() => setDialog(null)} defaultType={dialog?.type} title={dialog?.title} />
      <ConfirmDialog open={ending !== null} onClose={() => setEnding(null)} confirmLabel="End supervision" loading={end.isPending}
        title={`End ${ending?.mentor.name ?? "this"} as supervisor?`}
        description={`It stops applying from today for ${ending?.scholar.name ?? "this scholar"}. Past supervision stays on record.${ending?.relationship.type === "primary" ? " The scholar will need a new primary supervisor." : ""}`}
        onConfirm={() => { if (ending) end.mutate(ending.relationship.id, { onSettled: () => setEnding(null) }); }} />
    </div>
  );
}
