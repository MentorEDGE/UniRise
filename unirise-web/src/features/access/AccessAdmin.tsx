import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { AlertTriangle, Clock, FileClock, Info, Plus, UserCog, XCircle } from "lucide-react";
import { api } from "@/lib/api";
import { HttpError } from "@/lib/http";
import { useAuth } from "@/app/auth";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { EmptyState, ErrorBanner, Skeleton } from "@/components/ui/feedback";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { GrantDialog } from "./GrantDialog";
import { KindPill, StatusPill, validityText } from "./GrantParts";
import { grantStatus, roleLabel, type AccessReviewItem, type GrantRow, type ReviewReason } from "./types";

const todayIso = () => new Date().toISOString().slice(0, 10);
const addDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const refresh = (qc: ReturnType<typeof useQueryClient>) => { for (const k of ["role-grants", "access-review", "users", "audit-log"]) qc.invalidateQueries({ queryKey: [k] }); };

/** The scope a grant covers, as text. */
function useScopeName() {
  const units = useQuery({ queryKey: ["org-units"], queryFn: api.orgUnits });
  return (id?: number) => (id === undefined ? "Whole institution" : units.data?.find((u) => u.id === id)?.name ?? "—");
}

const renewSchema = z.object({ validTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter an end date") });

function RenewDialog({ grant, onClose }: { grant?: GrantRow; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const form = useForm<{ validTo: string }>({ resolver: zodResolver(renewSchema) as never, values: { validTo: addDays(90) } });
  const save = useMutation({
    mutationFn: (v: { validTo: string }) => api.renewGrant({ id: grant!.id, validTo: v.validTo }),
    onSuccess: () => { refresh(qc); toast({ tone: "ok", message: "Access renewed." }); onClose(); },
    onError: (err) => toast({ tone: "error", message: err instanceof HttpError && err.status === 400 ? "Choose an end date later than the current one." : err instanceof HttpError && err.status === 403 ? "You can't renew this grant." : "Couldn't renew. Try again." }),
  });
  return (
    <Dialog open={!!grant} onClose={onClose} title="Renew access" description={grant ? `${grant.holder}, ${roleLabel[grant.role]}. Choose the new end date.` : undefined}>
      <form onSubmit={form.handleSubmit((v) => save.mutate(v))} className="space-y-4" noValidate>
        <Field label="New end date" error={form.formState.errors.validTo?.message} hint="Pick a date you will check again; open-ended access is what the review is meant to catch.">
          {(a) => <Input {...a} type="date" min={todayIso()} {...form.register("validTo")} />}
        </Field>
        <div className="flex justify-end gap-3"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={save.isPending}>Renew</Button></div>
      </form>
    </Dialog>
  );
}

function useEnd(onDone?: () => void) {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: (g: GrantRow) => api.endGrant(g.id),
    onSuccess: () => { refresh(qc); toast({ tone: "ok", message: "Done. The change is in the audit log." }); onDone?.(); },
    onError: (err) => toast({ tone: "error", message: err instanceof HttpError && err.status === 409 ? "That can't be ended: it is already handled, or it is the last research administrator." : err instanceof HttpError && err.status === 403 ? "You can't change this grant." : "Couldn't save. Try again." }),
  });
}

function GrantsSection() {
  const { user } = useAuth();
  const scopeName = useScopeName();
  const list = useQuery({ queryKey: ["role-grants"], queryFn: api.roleGrants });
  const [dialog, setDialog] = useState<"role" | "acting" | null>(null);
  const [filter, setFilter] = useState<"current" | "all">("current");
  const [q, setQ] = useState("");
  const [renew, setRenew] = useState<GrantRow>();
  const [ending, setEnding] = useState<GrantRow>();
  const end = useEnd(() => setEnding(undefined));
  const isAdmin = user?.role === "RESEARCH_ADMIN" || user?.role === "IT_ADMIN";
  const on = todayIso();

  const rows = (list.data ?? []).filter((g) => (filter === "all" || grantStatus(g, on) !== "ended") && (!q.trim() || `${g.holder} ${roleLabel[g.role]} ${scopeName(g.scopeUnitId)}`.toLowerCase().includes(q.trim().toLowerCase())));
  const canManage = (g: GrantRow) => isAdmin || g.kind !== "direct";
  const actions = (g: GrantRow) => (grantStatus(g, on) === "ended" || !canManage(g) ? null : (
    <div className="flex gap-2">
      {(user?.role !== "IT_ADMIN" || g.role === "IT_ADMIN") && <Button size="sm" variant="secondary" onClick={() => setRenew(g)}>Renew</Button>}
      <Button size="sm" variant="ghost" onClick={() => setEnding(g)} aria-label={`End access for ${g.holder}`}>End</Button>
    </div>));

  return (
    <section aria-labelledby="grants-h" className="mb-10">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div><h2 id="grants-h" className="text-xl font-semibold tracking-tight">Role grants</h2>
          <p className="text-sm text-muted-foreground">Who holds which role, over which part of the university, and for how long.</p></div>
        <div className="flex flex-wrap gap-2">
          {isAdmin && <Button onClick={() => setDialog("role")}><Plus /> Grant a role</Button>}
          {user?.role !== "IT_ADMIN" && <Button variant="secondary" onClick={() => setDialog("acting")}><UserCog /> Acting or delegated</Button>}
        </div>
      </div>
      <Card className="mb-4 p-4">
        <form role="search" className="grid gap-3 sm:grid-cols-[2fr_1fr]" onSubmit={(e) => e.preventDefault()}>
          <Input aria-label="Search role grants" placeholder="Search a name, role or unit" value={q} onChange={(e) => setQ(e.target.value)} />
          <Select aria-label="Which grants" value={filter} onChange={(e) => setFilter(e.target.value as "current" | "all")}><option value="current">Current and upcoming</option><option value="all">Include ended</option></Select>
        </form>
      </Card>
      {list.isError && <ErrorBanner error={list.error} onRetry={() => list.refetch()} />}
      <Card className="overflow-hidden">
        {list.isLoading ? <div className="space-y-3 p-6">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-12" />)}</div>
          : rows.length === 0 ? <EmptyState title="No role grants to show" description={isAdmin ? "Grant a role to give someone access, or include ended grants." : "Appoint an acting or delegated role to cover for someone."}
              action={isAdmin ? <Button onClick={() => setDialog("role")}><Plus /> Grant a role</Button> : undefined} />
          : (<>
            <div className="hidden md:block"><Table>
              <THead><tr><TH>Person</TH><TH>Role</TH><TH>Covers</TH><TH>Valid</TH><TH>Status</TH><TH>Granted by</TH><TH><span className="sr-only">Actions</span></TH></tr></THead>
              <TBody>{rows.map((g) => (
                <TR key={g.id}>
                  <TD className="font-medium">{g.holder}{g.note && <p className="mt-0.5 max-w-xs text-xs font-normal text-muted-foreground">{g.note}</p>}</TD>
                  <TD><div className="flex flex-wrap items-center gap-1.5">{roleLabel[g.role]} <KindPill kind={g.kind} /></div></TD>
                  <TD>{scopeName(g.scopeUnitId)}</TD>
                  <TD className="whitespace-nowrap">{validityText(g)}</TD>
                  <TD><StatusPill status={grantStatus(g, on)} /></TD>
                  <TD>{g.grantedBy}</TD>
                  <TD>{actions(g)}</TD>
                </TR>))}</TBody></Table></div>
            <ul className="divide-y md:hidden">{rows.map((g) => (
              <li key={g.id} className="space-y-1.5 p-4">
                <p className="font-medium">{g.holder}</p>
                <p className="text-sm">{roleLabel[g.role]} · {scopeName(g.scopeUnitId)}</p>
                <p className="text-xs text-muted-foreground">{validityText(g)} · granted by {g.grantedBy}</p>
                <div className="flex flex-wrap items-center gap-2"><StatusPill status={grantStatus(g, on)} /><KindPill kind={g.kind} />{actions(g)}</div>
              </li>))}</ul>
          </>)}
      </Card>
      <GrantDialog open={dialog !== null} mode={dialog ?? "role"} onClose={() => setDialog(null)} />
      <RenewDialog grant={renew} onClose={() => setRenew(undefined)} />
      <ConfirmDialog open={!!ending} onClose={() => setEnding(undefined)} onConfirm={() => ending && end.mutate(ending)} loading={end.isPending} confirmLabel="End access"
        title="End this access now?" description={ending ? `${ending.holder} will lose the ${roleLabel[ending.role]} role straight away. The change is recorded in the audit log.` : ""} />
    </section>
  );
}

const reasonStyle: Record<ReviewReason, { icon: typeof Clock; label: string; cls: string }> = {
  expired: { icon: XCircle, label: "Ended", cls: "border-border bg-muted text-muted-foreground" },
  "ends-soon": { icon: Clock, label: "Ends soon", cls: "border-warning/30 bg-warning/10 text-warning" },
  "no-end-date": { icon: AlertTriangle, label: "No end date", cls: "border-destructive/30 bg-destructive/10 text-destructive" },
};

function ReviewSection() {
  const list = useQuery({ queryKey: ["access-review"], queryFn: api.accessReview });
  const [renew, setRenew] = useState<GrantRow>();
  const [ending, setEnding] = useState<AccessReviewItem>();
  const end = useEnd(() => setEnding(undefined));
  const { user } = useAuth();

  return (
    <section aria-labelledby="review-h" className="mb-10">
      <div className="mb-4">
        <h2 id="review-h" className="text-xl font-semibold tracking-tight">Access review</h2>
        <p className="text-sm text-muted-foreground">Grants that have ended, end within 30 days, or have had no end date for over a year. An old HR import can leave people with access they no longer need.</p>
      </div>
      {list.isError && <ErrorBanner error={list.error} onRetry={() => list.refetch()} />}
      <Card className="overflow-hidden">
        {list.isLoading ? <div className="space-y-3 p-6">{Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-14" />)}</div>
          : (list.data ?? []).length === 0 ? <EmptyState icon={<FileClock className="size-6" aria-hidden />} title="Nothing to review" description="No grant has ended, is about to end, or has been open-ended for over a year. Check again next month." />
          : <ul className="divide-y">{list.data!.map((i) => {
            const s = reasonStyle[i.reason]; const Icon = s.icon;
            return (
              <li key={i.grant.id} className="flex flex-wrap items-start justify-between gap-3 p-4">
                <div className="min-w-0 space-y-1">
                  <p className="font-medium">{i.grant.holder} <span className="font-normal text-muted-foreground">· {roleLabel[i.grant.role]}</span></p>
                  <p className="max-w-xl text-sm text-muted-foreground">{i.message}</p>
                  <div className="flex flex-wrap items-center gap-2"><Badge className={s.cls}><Icon className="size-3.5" aria-hidden />{s.label}</Badge><span className="text-xs text-muted-foreground">{validityText(i.grant)}</span></div>
                </div>
                <div className="flex gap-2">
                  {(user?.role !== "IT_ADMIN" || i.grant.role === "IT_ADMIN") && <Button size="sm" variant={i.suggested === "confirm-ended" ? "secondary" : "primary"} onClick={() => setRenew(i.grant)}>Renew</Button>}
                  <Button size="sm" variant="secondary" onClick={() => (i.suggested === "confirm-ended" ? end.mutate(i.grant) : setEnding(i))} loading={end.isPending && end.variables?.id === i.grant.id}
                    aria-label={`${i.suggested === "confirm-ended" ? "Confirm ended" : "End"}: ${i.grant.holder}`}>{i.suggested === "confirm-ended" ? "Confirm ended" : "End"}</Button>
                </div>
              </li>);
          })}</ul>}
      </Card>
      <RenewDialog grant={renew} onClose={() => setRenew(undefined)} />
      <ConfirmDialog open={!!ending} onClose={() => setEnding(undefined)} onConfirm={() => ending && end.mutate(ending.grant)} loading={end.isPending} confirmLabel="End access"
        title="End this access now?" description={ending ? `${ending.grant.holder} will lose the ${roleLabel[ending.grant.role]} role straight away. The change is recorded in the audit log.` : ""} />
    </section>
  );
}

export default function AccessAdmin() {
  const { user } = useAuth();
  const reviewer = user?.role === "RESEARCH_ADMIN" || user?.role === "IT_ADMIN";
  return (
    <div>
      <PageHeader eyebrow="Administration" title="Roles and access" description="Grant, renew and end access, and check it regularly. This is sample data until a backend is connected." />
      <Card className="mb-8">
        <CardHeader><CardTitle className="flex items-center gap-2"><Info className="size-5 text-primary" aria-hidden />A designation is a title, not a permission</CardTitle>
          <CardDescription>Being a Professor, a Head of Department or a Dean in the HR records does not give anyone access. Access comes only from a role grant here, with a scope and dates. Acting and delegated roles always end on a date. The IT administrator manages access and sees the logs, never research content.</CardDescription></CardHeader>
        <CardContent className="pt-4 md:pt-4"><Link to="/settings" className="text-sm font-semibold text-primary hover:underline">Open the audit log and access log in Settings</Link></CardContent>
      </Card>
      <GrantsSection />
      {reviewer && <ReviewSection />}
      {reviewer && <p className="text-xs text-muted-foreground">Every change on this page is written to the audit log.</p>}
    </div>
  );
}
