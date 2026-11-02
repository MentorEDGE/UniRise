import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, CircleAlert, DownloadCloud } from "lucide-react";
import { api } from "@/lib/api";
import type { HarvestRun } from "@/lib/types";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState, ErrorBanner, Skeleton } from "@/components/ui/feedback";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";

const when = (iso: string) => new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));

function RunStatus({ status }: { status: HarvestRun["status"] }) {
  const m = {
    ok: { icon: CheckCircle2, label: "Succeeded", cls: "border-success/30 bg-success/10 text-success" },
    partial: { icon: CircleAlert, label: "Partly failed", cls: "border-warning/30 bg-warning/10 text-warning" },
    failed: { icon: AlertTriangle, label: "Failed", cls: "border-destructive/30 bg-destructive/10 text-destructive" },
  }[status];
  const Icon = m.icon;
  return <Badge className={m.cls}><Icon className="size-3.5" aria-hidden />{m.label}</Badge>;
}

function Stat({ label, value, detail }: { label: string; value: number; detail?: string }) {
  return (
    <Card className="p-5">
      <p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-1 text-3xl font-semibold tracking-tight">{value}</p>
      {detail && <p className="mt-1 text-xs text-muted-foreground">{detail}</p>}
    </Card>
  );
}

/** Harvest runs from ORCID and OpenAlex (PRD R11). In sample-data mode a run only proposes matches for records already in the system. */
export default function HarvestTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const runs = useQuery({ queryKey: ["harvest-runs"], queryFn: api.harvestRuns });
  const people = useQuery({ queryKey: ["researchers", "all"], queryFn: () => api.researchers() });
  const run = useMutation({
    mutationFn: api.runHarvest,
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["harvest-runs"] }); qc.invalidateQueries({ queryKey: ["suggestions"] }); qc.invalidateQueries({ queryKey: ["summary"] }); qc.invalidateQueries({ queryKey: ["publications"] });
      const n = r.reduce((s, x) => s + x.newSuggestions, 0);
      toast({ tone: "ok", message: n ? `Sample harvest finished: ${n} new suggestion${n === 1 ? "" : "s"} in the review queue.` : "Sample harvest finished: nothing new to suggest." });
    },
    onError: () => toast({ tone: "error", message: "The harvest could not run. Try again." }),
  });

  const active = (people.data ?? []).filter((r) => r.status !== "left");
  const withOrcid = active.filter((r) => r.orcid);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <p className="max-w-2xl text-sm text-muted-foreground">
          Harvests look for works by people with an ORCID iD (ORCID) and by name and affiliation (OpenAlex). Matches go to the review queue and count in reports only after a person confirms them.
          In this demo a run is a <strong>sample</strong>: it proposes matches for records already in the sample data and calls no external service.
        </p>
        <Button onClick={() => run.mutate()} loading={run.isPending}><DownloadCloud /> Run harvest now</Button>
      </div>

      {people.isError ? <ErrorBanner error={people.error} onRetry={() => people.refetch()} /> : (
        <div className="grid gap-4 sm:grid-cols-3">
          {people.isLoading ? Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-24 w-full" />) : (<>
            <Stat label="Active researchers" value={active.length} />
            <Stat label="With an ORCID iD" value={withOrcid.length} detail={`${active.length - withOrcid.length} without one are matched by name only`} />
            <Stat label="ORCID verified by sign-in" value={withOrcid.filter((r) => r.orcidVerified).length} detail="Verified iDs give the strongest matches" />
          </>)}
        </div>
      )}

      {runs.isError && <ErrorBanner error={runs.error} onRetry={() => runs.refetch()} />}
      <Card className="overflow-hidden">
        {runs.isLoading ? (
          <div className="space-y-3 p-6">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
        ) : runs.data && runs.data.length === 0 ? (
          <EmptyState title="No harvest has run yet" description="Run a harvest to look for new works. Scheduled runs will also appear here."
            action={<Button onClick={() => run.mutate()} loading={run.isPending}>Run harvest now</Button>} />
        ) : (
          <>
            <div className="hidden md:block">
              <Table>
                <THead><tr><TH>Time</TH><TH>Source</TH><TH>Researchers</TH><TH>Found</TH><TH>New suggestions</TH><TH>Status</TH><TH>Note</TH></tr></THead>
                <TBody>
                  {runs.data?.map((r) => (
                    <TR key={r.id}>
                      <TD className="whitespace-nowrap">{when(r.at)}</TD><TD>{r.source}</TD><TD>{r.researchers}</TD><TD>{r.found}</TD><TD>{r.newSuggestions}</TD>
                      <TD><RunStatus status={r.status} /></TD><TD className="max-w-xs text-muted-foreground">{r.note ?? "—"}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>
            <ul className="divide-y md:hidden">
              {runs.data?.map((r) => (
                <li key={r.id} className="space-y-1 p-4 text-sm">
                  <div className="flex items-center justify-between gap-2"><span className="font-semibold">{r.source}</span><RunStatus status={r.status} /></div>
                  <p className="text-xs text-muted-foreground">{when(r.at)}</p>
                  <p>{r.researchers} researchers · {r.found} found · {r.newSuggestions} new suggestions</p>
                  {r.note && <p className="text-xs text-muted-foreground">{r.note}</p>}
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>
    </div>
  );
}
