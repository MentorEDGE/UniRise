import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { AlertTriangle, Ban, CheckCircle2, Circle, Clock, Copy, Download, FlaskConical, LifeBuoy, PauseCircle, Plus, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { HttpError } from "@/lib/http";
import { formatDate, formatNumber } from "@/lib/utils";
import type { Tenant, TenantStatus } from "@/lib/types";
import { SUPPORT_MAX_MINUTES, TENANT_TRANSITIONS, type DeletionRecord, type SupportGrant } from "@/mock/ext/tenant";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/form";
import { EmptyState, ErrorBanner, Skeleton } from "@/components/ui/feedback";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";

const statusStyle: Record<TenantStatus, { icon: typeof Circle; label: string; cls: string }> = {
  sandbox: { icon: FlaskConical, label: "Sandbox", cls: "border-border bg-muted text-muted-foreground" },
  pilot: { icon: Clock, label: "Pilot", cls: "border-violet-200 bg-violet-50 text-violet-700 dark:border-white/10 dark:bg-white/5 dark:text-violet-300" },
  active: { icon: CheckCircle2, label: "Active", cls: "border-success/30 bg-success/10 text-success" },
  suspended: { icon: PauseCircle, label: "Suspended", cls: "border-warning/30 bg-warning/10 text-warning" },
  closed: { icon: Ban, label: "Closed", cls: "border-destructive/30 bg-destructive/10 text-destructive" },
};
function StatusPill({ s }: { s: TenantStatus }) {
  const m = statusStyle[s]; const Icon = m.icon;
  return <Badge className={m.cls}><Icon className="size-3.5" aria-hidden />{m.label}</Badge>;
}

const monthLabel = (m: string) => new Date(`${m}-01T00:00:00`).toLocaleDateString("en-IN", { month: "short", year: "2-digit" });
const latest = (t: Tenant) => t.activeResearchers[t.activeResearchers.length - 1];

function download(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = filename; a.click(); URL.revokeObjectURL(a.href);
}
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** What each status change means, spelled out before the operator confirms it. */
function statusCopy(t: Tenant, to: TenantStatus) {
  if (to === "active" && t.status === "pilot") return { title: `Convert ${t.name} to active?`, text: "The pilot becomes a paying tenant. Its data stays exactly where it is; nothing is migrated.", label: "Convert to active" };
  if (to === "active") return { title: `Reactivate ${t.name}?`, text: "People at this tenant can use the system again. Nothing was deleted while it was suspended.", label: "Reactivate" };
  if (to === "suspended") return { title: `Suspend ${t.name}?`, text: "People at this tenant lose access until you reactivate it. Their data is kept.", label: "Suspend" };
  if (to === "pilot") return { title: `Move ${t.name} to pilot?`, text: "Keeps the same data and settings; only the status changes.", label: "Move to pilot" };
  return { title: `Close ${t.name}?`, text: "Closing ends the contract. Access stops and the tenant can't be reactivated. Export its data first, then delete it when the contract allows.", label: "Close tenant" };
}

type Act =
  | { kind: "status"; tenant: Tenant; to: TenantStatus }
  | { kind: "export"; tenant: Tenant }
  | { kind: "delete"; tenant: Tenant }
  | { kind: "support"; tenant: Tenant }
  | null;

export default function Platform() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const q = useQuery({ queryKey: ["platform-tenants"], queryFn: () => api.tenants() });
  const [act, setAct] = useState<Act>(null);
  const [creating, setCreating] = useState(false);
  const [newKey, setNewKey] = useState<{ tenant: Tenant; apiKey: string } | null>(null);
  const [record, setRecord] = useState<DeletionRecord | null>(null);
  const [grant, setGrant] = useState<SupportGrant | null>(null);
  const refresh = () => { qc.invalidateQueries({ queryKey: ["platform-tenants"] }); qc.invalidateQueries({ queryKey: ["audit"] }); qc.invalidateQueries({ queryKey: ["access-log"] }); };
  const fail = (e: unknown) => toast({ tone: "error", message: e instanceof HttpError && e.status === 409 ? "That change isn't allowed from the tenant's current status." : e instanceof HttpError && e.status === 403 ? "You don't have access to this." : "Couldn't complete that. Try again." });

  const create = useMutation({
    mutationFn: (v: { name: string; status: "sandbox" | "pilot" }) => api.createTenant(v),
    onSuccess: (r) => { refresh(); setCreating(false); setNewKey(r); },
    onError: (e) => toast({ tone: "error", message: e instanceof HttpError && e.status === 409 ? "A tenant with that name already exists." : "Couldn't create the tenant. Try again." }),
  });
  const setStatus = useMutation({
    mutationFn: (v: { id: number; status: TenantStatus }) => api.setTenantStatus(v),
    onSuccess: (t) => { refresh(); setAct(null); toast({ tone: "ok", message: `${t.name} is now ${statusStyle[t.status].label.toLowerCase()}.` }); },
    onError: (e) => { setAct(null); fail(e); },
  });
  const exp = useMutation({
    mutationFn: (t: Tenant) => api.exportTenant(t.id),
    onSuccess: (r) => { refresh(); setAct(null); download(`${slug(r.tenant.name)}-export.json`, r); toast({ tone: "ok", message: "Export downloaded. The export is recorded in the logs." }); },
    onError: (e) => { setAct(null); fail(e); },
  });
  const del = useMutation({
    mutationFn: (v: { id: number; confirmName: string }) => api.deleteTenant(v),
    onSuccess: (r) => { refresh(); setAct(null); setRecord(r); },
    onError: (e) => { setAct(null); fail(e); },
  });
  const support = useMutation({
    mutationFn: (v: { id: number; minutes: number; reason: string }) => api.supportAccess(v),
    onSuccess: (g) => { refresh(); setAct(null); setGrant(g); },
    onError: (e) => { setAct(null); fail(e); },
  });

  const rows = q.data ?? [];
  const months = rows.reduce<string[]>((m, t) => (t.activeResearchers.length > m.length ? t.activeResearchers.map((x) => x.month) : m), []);
  const max = Math.max(1, ...rows.map((t) => latest(t)?.count ?? 0));
  const statusAct = act?.kind === "status" ? statusCopy(act.tenant, act.to) : null;

  return (
    <div>
      <PageHeader eyebrow="Operator console" title="Platform console" description="Create and manage customer tenants. This console is for the platform operator only and is not reachable by tenant users. Sample data until a backend is connected."
        actions={<Button onClick={() => setCreating(true)}><Plus /> New tenant</Button>} />

      {q.isError && <ErrorBanner error={q.error} onRetry={() => q.refetch()} />}
      <Card className="mb-8 overflow-hidden">
        {q.isLoading ? <div className="space-y-3 p-6">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14" />)}</div>
          : rows.length === 0 ? <EmptyState title="No tenants yet" description="Create a sandbox or pilot tenant to start onboarding a customer." action={<Button onClick={() => setCreating(true)}><Plus /> New tenant</Button>} />
          : (<>
            <div className="hidden lg:block"><Table>
              <THead><tr><TH>Tenant</TH><TH>Status</TH><TH>Plan</TH><TH>Created</TH><TH className="text-right">Active researchers</TH><TH><span className="sr-only">Actions</span></TH></tr></THead>
              <TBody>{rows.map((t) => (
                <TR key={t.id}>
                  <TD className="font-medium">{t.name}</TD><TD><StatusPill s={t.status} /></TD><TD>{t.plan}</TD><TD>{formatDate(t.createdOn)}</TD>
                  <TD className="text-right">{latest(t) ? formatNumber(latest(t).count) : "—"}</TD>
                  <TD><Actions t={t} onAct={setAct} /></TD>
                </TR>))}</TBody></Table></div>
            <ul className="divide-y lg:hidden">{rows.map((t) => (
              <li key={t.id} className="space-y-2 p-4">
                <div className="flex items-center justify-between gap-3"><p className="font-medium">{t.name}</p><StatusPill s={t.status} /></div>
                <p className="text-xs text-muted-foreground">{t.plan} · created {formatDate(t.createdOn)} · {latest(t) ? `${formatNumber(latest(t).count)} active researchers` : "no usage yet"}</p>
                <Actions t={t} onAct={setAct} />
              </li>))}</ul>
          </>)}
      </Card>

      <Card>
        <CardHeader><CardTitle>Monthly active researchers</CardTitle><CardDescription>Usage metering: researchers who were active in the month. Sample figures, and no billing is calculated here.</CardDescription></CardHeader>
        <CardContent>
          {q.isLoading ? <Skeleton className="h-32" /> : months.length === 0 ? <p className="text-sm text-muted-foreground">No usage has been recorded yet.</p> : (
            <Table>
              <caption className="sr-only">Active researchers per tenant per month</caption>
              <THead><tr><TH>Tenant</TH>{months.map((m) => <TH key={m} className="text-right">{monthLabel(m)}</TH>)}<TH className="w-40"><span className="sr-only">Latest month, as a bar</span></TH></tr></THead>
              <TBody>{rows.map((t) => (
                <TR key={t.id}>
                  <TD className="font-medium">{t.name}</TD>
                  {months.map((m, i) => <TD key={m} className="text-right tabular-nums">{t.activeResearchers[i] ? formatNumber(t.activeResearchers[i].count) : "—"}</TD>)}
                  <TD aria-hidden><div className="h-2 rounded-full bg-secondary"><div className="h-2 rounded-full bg-primary" style={{ width: `${((latest(t)?.count ?? 0) / max) * 100}%` }} /></div></TD>
                </TR>))}</TBody>
            </Table>)}
        </CardContent>
      </Card>

      {creating && <CreateDialog loading={create.isPending} onClose={() => setCreating(false)} onSubmit={(v) => create.mutate(v)} />}
      {newKey && <KeyDialog data={newKey} onClose={() => setNewKey(null)} />}

      <ConfirmDialog open={act?.kind === "status"} onClose={() => setAct(null)} loading={setStatus.isPending}
        title={statusAct?.title ?? ""} description={statusAct?.text ?? ""} confirmLabel={statusAct?.label ?? "Confirm"}
        onConfirm={() => act?.kind === "status" && setStatus.mutate({ id: act.tenant.id, status: act.to })} />
      <ConfirmDialog open={act?.kind === "export"} onClose={() => setAct(null)} loading={exp.isPending}
        title={`Export ${act?.kind === "export" ? act.tenant.name : ""}?`} description="Downloads a copy of the tenant's data as JSON. The export is written to the audit and access logs." confirmLabel="Export data"
        onConfirm={() => act?.kind === "export" && exp.mutate(act.tenant)} />
      {act?.kind === "delete" && <DeleteDialog tenant={act.tenant} loading={del.isPending} onClose={() => setAct(null)} onConfirm={(confirmName) => del.mutate({ id: act.tenant.id, confirmName })} />}
      {act?.kind === "support" && <SupportDialog tenant={act.tenant} loading={support.isPending} onClose={() => setAct(null)} onSubmit={(v) => support.mutate({ id: act.tenant.id, ...v })} />}
      {record && <RecordDialog record={record} onClose={() => setRecord(null)} />}
      {grant && (
        <Dialog open onClose={() => setGrant(null)} title="Support access granted" description={`${grant.tenantName}. Recorded in the access log.`}>
          <div className="space-y-3 text-sm">
            <p><strong>Expires:</strong> {new Date(grant.expiresAt).toLocaleString("en-IN")}</p>
            <p><strong>Reason:</strong> {grant.reason}</p>
            <p className="text-xs text-muted-foreground">Sample: no session is opened in this demo. The tenant's administrators can see this entry in their access log.</p>
            <div className="flex justify-end"><Button onClick={() => setGrant(null)}>Done</Button></div>
          </div>
        </Dialog>)}
    </div>
  );
}

function Actions({ t, onAct }: { t: Tenant; onAct: (a: Act) => void }) {
  const next = TENANT_TRANSITIONS[t.status];
  const btn = (label: string, to: TenantStatus, icon: React.ReactNode) => next.includes(to) && (
    <Button size="sm" variant="secondary" aria-label={`${label} ${t.name}`} onClick={() => onAct({ kind: "status", tenant: t, to })}>{icon}{label}</Button>);
  return (
    <div className="flex flex-wrap gap-2 lg:justify-end">
      {btn("Promote to pilot", "pilot", <Clock />)}
      {btn(t.status === "suspended" ? "Reactivate" : "Convert to active", "active", <CheckCircle2 />)}
      {btn("Suspend", "suspended", <PauseCircle />)}
      {btn("Close", "closed", <Ban />)}
      <Button size="sm" variant="secondary" aria-label={`Export ${t.name}`} onClick={() => onAct({ kind: "export", tenant: t })}><Download /> Export</Button>
      <Button size="sm" variant="secondary" aria-label={`Support access to ${t.name}`} onClick={() => onAct({ kind: "support", tenant: t })}><LifeBuoy /> Support access</Button>
      {t.status !== "active" && <Button size="sm" variant="destructive" aria-label={`Delete ${t.name}`} onClick={() => onAct({ kind: "delete", tenant: t })}><Trash2 /> Delete</Button>}
    </div>
  );
}

/* --------------------------------- dialogs --------------------------------- */
const createSchema = z.object({ name: z.string().trim().min(3, "Enter at least 3 characters").max(80, "Use at most 80 characters"), status: z.enum(["sandbox", "pilot"]) });
function CreateDialog({ onClose, onSubmit, loading }: { onClose: () => void; onSubmit: (v: { name: string; status: "sandbox" | "pilot" }) => void; loading: boolean }) {
  const { register, handleSubmit, formState: { errors } } = useForm<z.infer<typeof createSchema>>({ resolver: zodResolver(createSchema) as never, defaultValues: { name: "", status: "sandbox" } });
  return (
    <Dialog open onClose={onClose} title="New tenant" description="The first API key is shown once after you create it.">
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
        <Field label="Institution name" error={errors.name?.message}>{(p) => <Input {...p} autoFocus {...register("name")} />}</Field>
        <Field label="Start as" hint="A pilot converts to a paying tenant later without moving any data." error={errors.status?.message}>
          {(p) => <Select {...p} {...register("status")}><option value="sandbox">Sandbox (synthetic data)</option><option value="pilot">Pilot (limited, real data)</option></Select>}
        </Field>
        <div className="flex justify-end gap-3 pt-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={loading}>Create tenant</Button></div>
      </form>
    </Dialog>
  );
}

function KeyDialog({ data, onClose }: { data: { tenant: Tenant; apiKey: string }; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => { try { await navigator.clipboard.writeText(data.apiKey); setCopied(true); } catch { setCopied(false); } };
  return (
    <Dialog open onClose={onClose} title={`${data.tenant.name} created`} description="Copy the first API key now. For security it is not shown again.">
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <input readOnly aria-label="API key" value={data.apiKey} onFocus={(e) => e.currentTarget.select()} className="h-10 w-full rounded-xl border border-input bg-muted px-3 font-mono text-xs" />
          <Button variant="secondary" onClick={copy}><Copy /> {copied ? "Copied" : "Copy"}</Button>
        </div>
        <p role="status" className="text-xs text-muted-foreground">{copied ? "Copied to the clipboard." : "Hand it to the customer's administrator through a secure channel."}</p>
        <div className="flex justify-end"><Button onClick={onClose}>I have saved it</Button></div>
      </div>
    </Dialog>
  );
}

function DeleteDialog({ tenant, onClose, onConfirm, loading }: { tenant: Tenant; onClose: () => void; onConfirm: (name: string) => void; loading: boolean }) {
  const [typed, setTyped] = useState("");
  const match = typed === tenant.name;
  return (
    <Dialog open onClose={onClose} title={`Delete ${tenant.name}?`} description="This removes all of the tenant's data and can't be undone. A written deletion record is produced.">
      <div className="space-y-4">
        <p className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm"><AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />Export the data first if the customer needs a copy.</p>
        <Field label={`Type "${tenant.name}" to confirm`} hint="The name must match exactly, including capital letters.">
          {(p) => <Input {...p} autoFocus autoComplete="off" spellCheck={false} value={typed} onChange={(e) => setTyped(e.target.value)} />}
        </Field>
        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="destructive" disabled={!match} loading={loading} onClick={() => onConfirm(typed)}>Delete tenant</Button>
        </div>
      </div>
    </Dialog>
  );
}

const supportSchema = z.object({
  reason: z.string().trim().min(10, "Describe why in at least 10 characters").max(300, "Use at most 300 characters"),
  minutes: z.coerce.number({ error: "Enter the number of minutes" }).int("Use whole minutes").min(15, "At least 15 minutes").max(SUPPORT_MAX_MINUTES, `At most ${SUPPORT_MAX_MINUTES} minutes`),
});
function SupportDialog({ tenant, onClose, onSubmit, loading }: { tenant: Tenant; onClose: () => void; onSubmit: (v: { minutes: number; reason: string }) => void; loading: boolean }) {
  const { register, handleSubmit, formState: { errors } } = useForm<z.infer<typeof supportSchema>>({ resolver: zodResolver(supportSchema) as never, defaultValues: { reason: "", minutes: 60 } });
  return (
    <Dialog open onClose={onClose} title={`Support access to ${tenant.name}`} description="Break-glass access is time-limited and recorded in the tenant's access log together with your reason.">
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
        <Field label="Reason" hint="For example: investigating a failed CSV import (ticket number)" error={errors.reason?.message}>{(p) => <Input {...p} autoFocus autoComplete="off" {...register("reason")} />}</Field>
        <Field label="Access lasts (minutes)" error={errors.minutes?.message}>{(p) => <Input {...p} type="number" inputMode="numeric" min={15} max={SUPPORT_MAX_MINUTES} {...register("minutes")} />}</Field>
        <div className="flex justify-end gap-3 pt-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={loading}>Grant access</Button></div>
      </form>
    </Dialog>
  );
}

function RecordDialog({ record, onClose }: { record: DeletionRecord; onClose: () => void }) {
  return (
    <Dialog open onClose={onClose} title="Deletion record" description={`${record.tenantName} was deleted.`}>
      <div className="space-y-3 text-sm">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
          <dt className="text-muted-foreground">Tenant</dt><dd>{record.tenantName}</dd>
          <dt className="text-muted-foreground">Status at deletion</dt><dd>{statusStyle[record.statusAtDeletion].label}</dd>
          <dt className="text-muted-foreground">Deleted</dt><dd>{new Date(record.deletedAt).toLocaleString("en-IN")}</dd>
          <dt className="text-muted-foreground">Deleted by</dt><dd>{record.deletedBy}</dd>
          <dt className="text-muted-foreground">Removed</dt><dd>{record.removed.join(", ")}</dd>
        </dl>
        <p className="text-xs text-muted-foreground">{record.note}</p>
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={() => download(`${slug(record.tenantName)}-deletion-record.json`, record)}><Download /> Download record</Button>
          <Button onClick={onClose}>Done</Button>
        </div>
      </div>
    </Dialog>
  );
}
