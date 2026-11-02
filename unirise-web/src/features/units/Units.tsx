import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Award, BookOpen, GraduationCap, Lock, Users, Wallet } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth, can } from "@/app/auth";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { formatDate, formatMoney, formatNumber } from "@/lib/utils";
import type { OrgUnit } from "@/lib/types";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState, ErrorBanner, Skeleton } from "@/components/ui/feedback";
import { Select } from "@/components/ui/form";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

function depthOf(u: OrgUnit, all: OrgUnit[]): number {
  const p = all.find((x) => x.id === u.parentId);
  return p ? 1 + depthOf(p, all) : 0;
}

// Figures are live ("as of today") until a period is closed; a closed period shows its frozen snapshot (PRD R28).
export default function Units() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [periodId, setPeriodId] = useState<number | undefined>(undefined);
  const [closing, setClosing] = useState(false);
  const periods = useQuery({ queryKey: ["periods"], queryFn: api.periods });
  const period = periods.data?.find((x) => x.id === periodId);
  const units = useQuery({ queryKey: ["org-units"], queryFn: api.orgUnits });
  const [picked, setPicked] = useState<number | null>(null);
  const root = units.data?.find((u) => u.id === user?.scopeUnitId) ?? units.data?.find((u) => u.parentId === undefined);
  const unitId = picked ?? root?.id;
  const roll = useQuery({ queryKey: ["unit-rollup", unitId, periodId], queryFn: () => api.unitRollup(unitId!, periodId), enabled: unitId !== undefined });
  const close = useMutation({
    mutationFn: () => api.closePeriod(periodId!),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["periods"] }); qc.invalidateQueries({ queryKey: ["unit-rollup"] }); setClosing(false); toast({ tone: "ok", message: "Period closed. The figures are now frozen." }); },
    onError: () => { setClosing(false); toast({ tone: "error", message: "Couldn't close the period. It may already be closed." }); },
  });

  const options = (units.data ?? []).filter((u) => u.type !== "group");
  const t = roll.data?.totals;
  const tiles = [
    { label: "Researchers", value: t?.researchers, icon: Users },
    { label: "PhD scholars", value: t?.scholars, icon: GraduationCap },
    { label: "Verified publications", value: t?.publications, icon: BookOpen },
    { label: "Awards", value: t?.awards, icon: Award },
    { label: "Overdue milestones", value: t?.overdue, icon: AlertTriangle },
  ];
  const maxStage = Math.max(1, ...(roll.data?.byStage.map((s) => s.count) ?? []));

  return (
    <div>
      <PageHeader eyebrow="Overview" title="Units" description="Output, funding and scholar progress for a part of the university. Totals count each publication once."
        actions={<>
          <Select aria-label="Period" className="min-w-44" value={periodId ?? ""} onChange={(e) => setPeriodId(e.target.value ? Number(e.target.value) : undefined)}>
            <option value="">All time (live)</option>
            {periods.data?.map((x) => <option key={x.id} value={x.id}>{x.label}{x.closedAt ? " (closed)" : ""}</option>)}
          </Select>
          <Select aria-label="Unit" className="min-w-56" value={unitId ?? ""} onChange={(e) => setPicked(Number(e.target.value))}>
            {options.map((u) => <option key={u.id} value={u.id}>{"— ".repeat(depthOf(u, units.data ?? []))}{u.name}</option>)}
          </Select></>} />

      {roll.isError && <ErrorBanner error={roll.error} onRetry={() => roll.refetch()} />}
      {roll.data && (
        <p className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-muted-foreground">
          {roll.data.closed
            ? <span className="inline-flex items-center gap-1.5 font-medium text-foreground"><Lock className="size-4" aria-hidden />{roll.data.periodLabel}: snapshot taken {formatDate(roll.data.takenAt ?? roll.data.asOf)}. These figures no longer change.</span>
            : <span>{roll.data.periodLabel ? `${roll.data.periodLabel}: ` : ""}Live figures as of {formatDate(roll.data.asOf)}. No confidential notes are included.</span>}
          {period && !period.closedAt && can.admin(user?.role) && <Button size="sm" variant="secondary" onClick={() => setClosing(true)}><Lock /> Close this period</Button>}
        </p>)}
      <ConfirmDialog open={closing} onClose={() => setClosing(false)} onConfirm={() => close.mutate()} loading={close.isPending} confirmLabel="Close period"
        title={`Close ${period?.label ?? "this period"}?`} description="This freezes the reported figures for every unit so submitted numbers stop changing. It can't be reopened." />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        {tiles.map((x) => (
          <Card key={x.label} className="p-5 md:p-6">
            <div className="mb-4 grid size-10 place-items-center rounded-xl bg-secondary text-primary"><x.icon className="size-5" aria-hidden /></div>
            {roll.isLoading ? <Skeleton className="h-8 w-16" /> : <div className="text-3xl font-semibold tracking-tight">{formatNumber(x.value ?? 0)}</div>}
            <div className="mt-1 text-sm text-muted-foreground">{x.label}</div>
          </Card>))}
      </div>
      {t && <p className="mt-4 flex items-center gap-2 text-sm text-muted-foreground"><Wallet className="size-4" aria-hidden />Funding in scope: <span className="font-semibold text-foreground">{formatMoney(t.funding)}</span></p>}

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <Card className="overflow-hidden">
          <CardHeader><CardTitle>Compare units</CardTitle><CardDescription>Child units of {roll.data?.unit.name ?? "the selected unit"}. Pick one above to look inside.</CardDescription></CardHeader>
          <CardContent className="px-0 pb-0 md:px-0 md:pb-2">
            {roll.isLoading ? <div className="p-6"><Skeleton className="h-32 w-full" /></div>
              : roll.data?.children.length === 0 ? <EmptyState title="No units below this one" description="This is the lowest level. Choose a parent unit to compare its children." />
              : (<div className="overflow-x-auto"><Table>
                <THead><tr><TH>Unit</TH><TH>Researchers</TH><TH>Scholars</TH><TH>Publications</TH><TH>Overdue</TH><TH className="text-right">Funding</TH></tr></THead>
                <TBody>{roll.data?.children.map((c) => (
                  <TR key={c.unitId}>
                    <TD className="font-medium"><button className="text-left hover:text-primary" onClick={() => setPicked(c.unitId)}>{c.name}</button> <Badge className="ml-1 border-border bg-muted capitalize text-muted-foreground">{c.type}</Badge></TD>
                    <TD>{c.researchers}</TD><TD>{c.scholars}</TD><TD>{c.publications}</TD><TD>{c.overdue}</TD><TD className="text-right">{formatMoney(c.funding)}</TD>
                  </TR>))}</TBody></Table></div>)}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Scholars by stage</CardTitle><CardDescription>Where PhD scholars in this unit are now.</CardDescription></CardHeader>
          <CardContent>
            {roll.isLoading ? <Skeleton className="h-32 w-full" /> : roll.data?.byStage.length === 0 ? <p className="text-sm text-muted-foreground">No scholars in this unit.</p> : (
              <ul className="space-y-3">{roll.data?.byStage.map((s) => (
                <li key={s.stage}>
                  <div className="mb-1 flex justify-between text-sm"><span>{s.stage}</span><span className="font-semibold">{s.count}</span></div>
                  <div className="h-2 rounded-full bg-muted" aria-hidden><div className="h-2 rounded-full bg-primary" style={{ width: `${(s.count / maxStage) * 100}%` }} /></div>
                </li>))}</ul>)}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
