import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, GitMerge, ThumbsUp } from "lucide-react";
import { api } from "@/lib/api";
import { HttpError } from "@/lib/http";
import { MERGE_FIELDS, authorRows, buildMerged, type MergeField, type MergeTake } from "@/mock/ext/quality";
import { cn } from "@/lib/utils";
import type { DuplicatePair, Publication } from "@/lib/types";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ui/dialog";
import { EmptyState, ErrorBanner, Skeleton } from "@/components/ui/feedback";
import { useToast } from "@/components/ui/toast";

const FIELD_LABEL: Record<MergeField, string> = {
  title: "Title", doi: "DOI", venue: "Venue", type: "Type", year: "Year", month: "Month", issn: "ISSN", category: "Category",
  oaStatus: "Open access", funderMandate: "Funder mandate", repositoryUrl: "Repository link", projectDetails: "Project",
};
const show = (v: unknown) => (v === undefined || v === null || v === "" ? "—" : String(v));
const sameValue = (a: unknown, b: unknown) => show(a).toLowerCase() === show(b).toLowerCase();

export default function Duplicates() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const pairs = useQuery({ queryKey: ["duplicates"], queryFn: api.duplicates });
  const people = useQuery({ queryKey: ["directory"], queryFn: api.directory });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [survivorSide, setSurvivorSide] = useState<"a" | "b">("a");
  const [take, setTake] = useState<Partial<Record<MergeField, boolean>>>({});
  const [confirming, setConfirming] = useState(false);
  const [conflictMsg, setConflictMsg] = useState<string | null>(null);

  const selected: DuplicatePair | undefined = pairs.data?.find((p) => p.id === selectedId) ?? pairs.data?.[0];
  const survivor: Publication | undefined = selected?.[survivorSide];
  const removed: Publication | undefined = selected ? selected[survivorSide === "a" ? "b" : "a"] : undefined;
  const nameOf = (id: number) => people.data?.find((r) => r.id === id)?.name ?? `#${id}`;

  const takeValues: MergeTake = useMemo(() => {
    const t: Record<string, unknown> = {};
    if (removed) for (const f of MERGE_FIELDS) if (take[f]) t[f] = (removed as unknown as Record<string, unknown>)[f];
    return t as MergeTake;
  }, [take, removed]);
  const preview = survivor && removed ? buildMerged(survivor, removed, takeValues) : undefined;

  const pick = (id: string) => { setSelectedId(id); setSurvivorSide("a"); setTake({}); setConflictMsg(null); };

  const done = () => { qc.invalidateQueries({ queryKey: ["duplicates"] }); qc.invalidateQueries({ queryKey: ["publications"] }); qc.invalidateQueries({ queryKey: ["summary"] }); qc.invalidateQueries({ queryKey: ["by-year"] }); setSelectedId(null); setTake({}); };
  const merge = useMutation({
    mutationFn: () => api.mergePublications({ survivorId: survivor!.id, removedId: removed!.id, take: takeValues }),
    onSuccess: () => { done(); setConfirming(false); toast({ tone: "ok", message: "Merged. The other record no longer appears in lists or reports." }); },
    onError: (e) => {
      setConfirming(false);
      if (e instanceof HttpError && e.status === 409) { setConflictMsg("One of these records was already merged. The list has been refreshed."); qc.invalidateQueries({ queryKey: ["duplicates"] }); }
      else toast({ tone: "error", message: "Couldn't merge. Try again." });
    },
  });
  const dismiss = useMutation({
    mutationFn: (id: string) => api.dismissDuplicate(id),
    onSuccess: () => { done(); toast({ tone: "ok", message: "Marked as not a duplicate. It won't be suggested again." }); },
    onError: () => toast({ tone: "error", message: "Couldn't save. Try again." }),
  });

  return (
    <div>
      <PageHeader eyebrow="Data quality" title="Duplicates" description="Records that look like the same work. Choose which one to keep, take the better value per field, then merge. Authors from both records are always kept." />
      {pairs.isError && <ErrorBanner error={pairs.error} onRetry={() => pairs.refetch()} />}
      {conflictMsg && <div role="alert" className="mb-4 rounded-xl border border-warning/30 bg-warning/10 p-4 text-sm">{conflictMsg}</div>}

      {pairs.isLoading ? <Skeleton className="h-96 w-full" /> : pairs.data && pairs.data.length === 0 ? (
        <Card><EmptyState icon={<ThumbsUp className="size-6" aria-hidden />} title="No duplicates to review" description="New probable duplicates appear here after a harvest or an import. Pairs marked as not a duplicate are not shown again." /></Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[20rem_1fr]">
          <Card className="h-fit">
            <h2 className="px-5 pt-5 text-sm font-semibold">{pairs.data?.length ?? 0} probable duplicate{pairs.data?.length === 1 ? "" : "s"}</h2>
            <ul className="p-2" aria-label="Probable duplicates">
              {pairs.data?.map((p) => (
                <li key={p.id}>
                  <button type="button" onClick={() => pick(p.id)} aria-current={selected?.id === p.id}
                    className={cn("w-full rounded-xl p-3 text-left transition-colors hover:bg-secondary", selected?.id === p.id && "bg-secondary")}>
                    <span className="line-clamp-2 text-sm font-medium">{p.a.title}</span>
                    <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <Badge className="border-warning/30 bg-warning/10 text-warning">{Math.round(p.score * 100)}%</Badge>{p.reason}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </Card>

          {selected && survivor && removed && preview && (
            <Card><CardContent className="space-y-6">
              <fieldset>
                <legend className="text-sm font-semibold">Keep which record?</legend>
                <div className="mt-2 grid gap-3 sm:grid-cols-2">
                  {(["a", "b"] as const).map((side) => {
                    const p = selected[side];
                    return (
                      <label key={side} className={cn("flex cursor-pointer gap-3 rounded-xl border p-3 text-sm", survivorSide === side && "border-primary bg-primary/5")}>
                        <input type="radio" name="survivor" className="mt-1 accent-[hsl(var(--primary))]" checked={survivorSide === side} onChange={() => { setSurvivorSide(side); setTake({}); }} />
                        <span><span className="font-semibold">Record #{p.id}</span> <span className="text-muted-foreground">({p.source}, {p.state})</span><br />
                          <span className="text-muted-foreground">{p.venue}, {p.year}</span></span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>

              <div>
                <h2 className="mb-2 text-sm font-semibold">Compare</h2>
                <div className="overflow-x-auto rounded-xl border">
                  <table className="w-full text-sm">
                    <caption className="sr-only">Field-by-field comparison of the two records. Differences are marked.</caption>
                    <thead className="bg-secondary/60 text-left text-xs uppercase tracking-wider text-muted-foreground">
                      <tr><th scope="col" className="p-3">Field</th><th scope="col" className="p-3">Keeping #{survivor.id}</th><th scope="col" className="p-3">Other (#{removed.id})</th><th scope="col" className="p-3">Use value from other</th></tr>
                    </thead>
                    <tbody>
                      {MERGE_FIELDS.map((f) => {
                        const a = (survivor as unknown as Record<string, unknown>)[f], b = (removed as unknown as Record<string, unknown>)[f];
                        const differs = !sameValue(a, b);
                        const canTake = differs && show(b) !== "—";
                        return (
                          <tr key={f} className={cn("border-t align-top", differs && "bg-warning/5")}>
                            <th scope="row" className="p-3 text-left font-medium">{FIELD_LABEL[f]} {differs && <span className="ml-1 inline-flex items-center gap-1 text-xs font-semibold text-warning"><AlertTriangle className="size-3" aria-hidden />Differs</span>}</th>
                            <td className="break-words p-3">{show(a)}</td>
                            <td className="break-words p-3">{show(b)}</td>
                            <td className="p-3">
                              {canTake ? (
                                <label className="inline-flex items-center gap-2 text-xs">
                                  <input type="checkbox" className="size-4 accent-[hsl(var(--primary))]" checked={!!take[f]} onChange={(e) => setTake((t) => ({ ...t, [f]: e.target.checked }))} />
                                  Take <span className="sr-only">{FIELD_LABEL[f]}</span> from other
                                </label>
                              ) : <span className="text-xs text-muted-foreground">{differs ? "Nothing to take" : "Same"}</span>}
                            </td>
                          </tr>
                        );
                      })}
                      <tr className="border-t align-top">
                        <th scope="row" className="p-3 text-left font-medium">Authors</th>
                        <td className="p-3">{authorRows(survivor).map((x) => x.name).join(", ") || "—"}</td>
                        <td className="p-3">{authorRows(removed).map((x) => x.name).join(", ") || "—"}</td>
                        <td className="p-3 text-xs text-muted-foreground">Always combined</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              <section aria-label="Merge preview" className="rounded-xl bg-secondary/60 p-4 text-sm">
                <h2 className="font-semibold">Result of the merge</h2>
                <p className="mt-1 font-medium">{preview.title}</p>
                <p className="text-muted-foreground">{preview.venue} · {preview.year}{preview.doi ? ` · ${preview.doi}` : ""}</p>
                <p className="mt-2"><span className="text-muted-foreground">Authors:</span> {authorRows(preview).map((x) => x.name).join(", ") || preview.authorIds.map(nameOf).join(", ") || "—"}</p>
                <p className="mt-2 text-muted-foreground">Record #{removed.id} is kept for the audit trail but disappears from lists, counts and reports.</p>
              </section>

              <div className="flex flex-wrap justify-end gap-3">
                <Button variant="secondary" loading={dismiss.isPending} onClick={() => dismiss.mutate(selected.id)}>Not a duplicate</Button>
                <Button onClick={() => setConfirming(true)}><GitMerge /> Merge records…</Button>
              </div>
            </CardContent></Card>
          )}
        </div>
      )}

      <ConfirmDialog open={confirming} onClose={() => setConfirming(false)} loading={merge.isPending} confirmLabel="Merge records"
        title={`Merge #${removed?.id} into #${survivor?.id}?`}
        description="Authors from both records are combined and the other record is hidden everywhere. A reviewer can see the merge in the audit log."
        onConfirm={() => merge.mutate()} />
    </div>
  );
}
