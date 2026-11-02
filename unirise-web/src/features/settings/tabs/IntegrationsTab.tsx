import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Ban, Copy, KeyRound, Pencil, Plus, RefreshCw, Send, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { HttpError } from "@/lib/http";
import { formatDate } from "@/lib/utils";
import { WEBHOOK_EVENTS, type ApiKeyRow, type Webhook } from "@/lib/types";
import type { NewKey } from "@/mock/ext/tenant";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/form";
import { EmptyState, ErrorBanner, Skeleton } from "@/components/ui/feedback";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";

const keySchema = z.object({ name: z.string().trim().min(2, "Enter a name of at least 2 characters").max(60, "Use at most 60 characters") });
const hookSchema = z.object({
  url: z.string().trim().url("Enter a full address such as https://erp.example.edu/hook").refine((u) => u.startsWith("https://"), "The address must start with https://"),
  events: z.array(z.string()).min(1, "Choose at least one event"),
  active: z.boolean(),
});
type HookValues = z.infer<typeof hookSchema>;

const errMessage = (e: unknown) => (e instanceof HttpError && e.status === 403 ? "You don't have access to this." : e instanceof HttpError && e.status === 400 ? "Some values are not valid." : "Couldn't complete that. Try again.");

export default function IntegrationsTab() {
  return (
    <div className="space-y-8">
      <p className="rounded-xl border bg-secondary/60 px-4 py-3 text-sm">
        The integration API is versioned under <code className="rounded bg-muted px-1.5 py-0.5 text-xs">/api/v1</code>. Send a key as <code className="rounded bg-muted px-1.5 py-0.5 text-xs">Authorization: Bearer &lt;key&gt;</code>. Keys and webhooks here are sample data until a backend is connected.
      </p>
      <ApiKeys />
      <Webhooks />
    </div>
  );
}

/* --------------------------------- API keys -------------------------------- */
function ApiKeys() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const q = useQuery({ queryKey: ["api-keys"], queryFn: () => api.apiKeys() });
  const [creating, setCreating] = useState(false);
  const [shown, setShown] = useState<{ key: NewKey; action: "created" | "rotated" } | null>(null);
  const [confirm, setConfirm] = useState<{ row: ApiKeyRow; action: "rotate" | "revoke" } | null>(null);
  const refresh = () => { qc.invalidateQueries({ queryKey: ["api-keys"] }); qc.invalidateQueries({ queryKey: ["audit"] }); };

  const create = useMutation({
    mutationFn: (name: string) => api.createApiKey(name),
    onSuccess: (k) => { refresh(); setCreating(false); setShown({ key: k, action: "created" }); },
    onError: (e) => toast({ tone: "error", message: errMessage(e) }),
  });
  const act = useMutation({
    mutationFn: async ({ row, action }: { row: ApiKeyRow; action: "rotate" | "revoke" }) => (action === "rotate" ? api.rotateApiKey(row.id) : (await api.revokeApiKey(row.id), null)),
    onSuccess: (k, v) => { refresh(); setConfirm(null); if (k) setShown({ key: k, action: "rotated" }); else toast({ tone: "ok", message: `${v.row.name} was revoked.` }); },
    onError: (e) => { setConfirm(null); toast({ tone: "error", message: errMessage(e) }); },
  });
  const rows = q.data ?? [];

  return (
    <section aria-labelledby="keys-h">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div><h2 id="keys-h" className="text-xl font-semibold tracking-tight">API keys</h2><p className="text-sm text-muted-foreground">For HR, finance and other systems that call the API. A key is shown once, when it is created.</p></div>
        <Button onClick={() => setCreating(true)}><Plus /> Create key</Button>
      </div>
      {q.isError && <ErrorBanner error={q.error} onRetry={() => q.refetch()} />}
      <Card className="overflow-hidden">
        {q.isLoading ? <div className="space-y-3 p-6">{[0, 1].map((i) => <Skeleton key={i} className="h-12" />)}</div>
          : rows.length === 0 ? <EmptyState title="No API keys yet" description="Create a key for the first system that needs to connect." icon={<KeyRound className="size-6" aria-hidden />} action={<Button onClick={() => setCreating(true)}><Plus /> Create key</Button>} />
          : (<>
            <div className="hidden md:block"><Table>
              <THead><tr><TH>Name</TH><TH>Key starts with</TH><TH>Created</TH><TH>Last used</TH><TH>Status</TH><TH><span className="sr-only">Actions</span></TH></tr></THead>
              <TBody>{rows.map((k) => (
                <TR key={k.id}>
                  <TD className="font-medium">{k.name}</TD><TD><code className="text-xs">{k.prefix}…</code></TD><TD>{formatDate(k.createdOn)}</TD><TD>{k.lastUsed ? formatDate(k.lastUsed) : "Never"}</TD>
                  <TD><KeyBadge k={k} /></TD>
                  <TD><KeyActions k={k} onAct={(action) => setConfirm({ row: k, action })} /></TD>
                </TR>))}</TBody></Table></div>
            <ul className="divide-y md:hidden">{rows.map((k) => (
              <li key={k.id} className="space-y-2 p-4"><p className="font-medium">{k.name}</p>
                <p className="text-xs text-muted-foreground"><code>{k.prefix}…</code> · created {formatDate(k.createdOn)} · {k.lastUsed ? `used ${formatDate(k.lastUsed)}` : "never used"}</p>
                <div className="flex flex-wrap items-center gap-2"><KeyBadge k={k} /><KeyActions k={k} onAct={(action) => setConfirm({ row: k, action })} /></div></li>))}</ul>
          </>)}
      </Card>

      {creating && <NameDialog loading={create.isPending} onClose={() => setCreating(false)} onSubmit={(n) => create.mutate(n)} />}
      {shown && <KeyOnceDialog data={shown.key} action={shown.action} onClose={() => setShown(null)} />}
      <ConfirmDialog open={!!confirm} onClose={() => setConfirm(null)} loading={act.isPending}
        onConfirm={() => confirm && act.mutate(confirm)}
        title={confirm?.action === "rotate" ? "Rotate this key?" : "Revoke this key?"}
        description={confirm?.action === "rotate" ? `${confirm.row.name} (${confirm.row.prefix}…) stops working now and a new key is issued. Update the system that uses it.` : `${confirm?.row.name} (${confirm?.row.prefix}…) stops working immediately. This can't be undone.`}
        confirmLabel={confirm?.action === "rotate" ? "Rotate key" : "Revoke key"} />
    </section>
  );
}

const KeyBadge = ({ k }: { k: ApiKeyRow }) => k.revokedOn
  ? <Badge className="border-border bg-muted text-muted-foreground"><Ban className="size-3.5" aria-hidden />Revoked {formatDate(k.revokedOn)}</Badge>
  : <Badge className="border-success/30 bg-success/10 text-success"><KeyRound className="size-3.5" aria-hidden />Active</Badge>;

function KeyActions({ k, onAct }: { k: ApiKeyRow; onAct: (a: "rotate" | "revoke") => void }) {
  if (k.revokedOn) return null;
  return (
    <div className="flex gap-2 md:justify-end">
      <Button size="sm" variant="secondary" aria-label={`Rotate ${k.name}`} onClick={() => onAct("rotate")}><RefreshCw /> Rotate</Button>
      <Button size="sm" variant="secondary" aria-label={`Revoke ${k.name}`} onClick={() => onAct("revoke")}><Ban /> Revoke</Button>
    </div>
  );
}

function NameDialog({ onClose, onSubmit, loading }: { onClose: () => void; onSubmit: (name: string) => void; loading: boolean }) {
  const { register, handleSubmit, formState: { errors } } = useForm<{ name: string }>({ resolver: zodResolver(keySchema) as never, defaultValues: { name: "" } });
  return (
    <Dialog open onClose={onClose} title="Create an API key" description="Name it after the system that will use it, so you can tell keys apart later.">
      <form onSubmit={handleSubmit((v) => onSubmit(v.name))} noValidate className="space-y-4">
        <Field label="Name" error={errors.name?.message}>{(p) => <Input {...p} autoFocus placeholder="HR sync (nightly)" {...register("name")} />}</Field>
        <div className="flex justify-end gap-3 pt-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={loading}>Create key</Button></div>
      </form>
    </Dialog>
  );
}

/** The plaintext key lives only in this component's props; closing the dialog drops it. */
function KeyOnceDialog({ data, action, onClose }: { data: NewKey; action: "created" | "rotated"; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => { try { await navigator.clipboard.writeText(data.key); setCopied(true); } catch { setCopied(false); } };
  return (
    <Dialog open onClose={onClose} title={action === "rotated" ? "New key issued" : "Key created"} description="Copy it now. For security it is not shown again.">
      <div className="space-y-4">
        <p className="text-sm font-medium">{data.row.name}</p>
        <div className="flex items-center gap-2">
          <input readOnly aria-label="API key" value={data.key} onFocus={(e) => e.currentTarget.select()} className="h-10 w-full rounded-xl border border-input bg-muted px-3 font-mono text-xs" />
          <Button variant="secondary" onClick={copy}><Copy /> {copied ? "Copied" : "Copy"}</Button>
        </div>
        <p role="status" className="text-xs text-muted-foreground">{copied ? "Copied to the clipboard." : "Store it in your secrets manager, not in a document or chat."}</p>
        <div className="flex justify-end"><Button onClick={onClose}>I have saved it</Button></div>
      </div>
    </Dialog>
  );
}

/* --------------------------------- Webhooks -------------------------------- */
function Webhooks() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const q = useQuery({ queryKey: ["webhooks"], queryFn: () => api.webhooks() });
  const [edit, setEdit] = useState<Webhook | "new" | null>(null);
  const [del, setDel] = useState<Webhook | null>(null);
  const refresh = () => { qc.invalidateQueries({ queryKey: ["webhooks"] }); qc.invalidateQueries({ queryKey: ["audit"] }); };

  const save = useMutation({
    mutationFn: (v: HookValues & { id?: number }) => api.saveWebhook(v),
    onSuccess: () => { refresh(); setEdit(null); toast({ tone: "ok", message: "Webhook saved." }); },
    onError: (e) => toast({ tone: "error", message: e instanceof HttpError && e.status === 400 ? "Use a public https address and at least one event." : errMessage(e) }),
  });
  const remove = useMutation({
    mutationFn: (id: number) => api.deleteWebhook(id),
    onSuccess: () => { refresh(); setDel(null); toast({ tone: "ok", message: "Webhook deleted." }); },
    onError: (e) => { setDel(null); toast({ tone: "error", message: errMessage(e) }); },
  });
  const test = useMutation({
    mutationFn: (id: number) => api.testWebhook(id),
    onSuccess: (r) => { refresh(); toast({ tone: r.ok ? "ok" : "error", message: r.message }); },
    onError: (e) => toast({ tone: "error", message: errMessage(e) }),
  });
  const rows = q.data ?? [];

  return (
    <section aria-labelledby="hooks-h">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div><h2 id="hooks-h" className="text-xl font-semibold tracking-tight">Webhooks</h2><p className="text-sm text-muted-foreground">We call your address when one of the chosen events happens. https only.</p></div>
        <Button onClick={() => setEdit("new")}><Plus /> Add webhook</Button>
      </div>
      {q.isError && <ErrorBanner error={q.error} onRetry={() => q.refetch()} />}
      <Card className="overflow-hidden">
        {q.isLoading ? <div className="space-y-3 p-6">{[0, 1].map((i) => <Skeleton key={i} className="h-12" />)}</div>
          : rows.length === 0 ? <EmptyState title="No webhooks yet" description="Add an address to be notified when a publication is approved or a grant is sanctioned." icon={<Send className="size-6" aria-hidden />} action={<Button onClick={() => setEdit("new")}><Plus /> Add webhook</Button>} />
          : (<>
            <div className="hidden md:block"><Table>
              <THead><tr><TH>Address</TH><TH>Events</TH><TH>Status</TH><TH><span className="sr-only">Actions</span></TH></tr></THead>
              <TBody>{rows.map((w) => (
                <TR key={w.id}>
                  <TD className="max-w-xs break-all font-medium">{w.url}</TD><TD className="max-w-sm text-xs">{w.events.join(", ")}</TD>
                  <TD><HookBadge w={w} /></TD>
                  <TD><HookActions w={w} testing={test.isPending && test.variables === w.id} onTest={() => test.mutate(w.id)} onEdit={() => setEdit(w)} onDelete={() => setDel(w)} /></TD>
                </TR>))}</TBody></Table></div>
            <ul className="divide-y md:hidden">{rows.map((w) => (
              <li key={w.id} className="space-y-2 p-4"><p className="break-all font-medium">{w.url}</p><p className="text-xs text-muted-foreground">{w.events.join(", ")}</p>
                <div className="flex flex-wrap items-center gap-2"><HookBadge w={w} /><HookActions w={w} testing={test.isPending && test.variables === w.id} onTest={() => test.mutate(w.id)} onEdit={() => setEdit(w)} onDelete={() => setDel(w)} /></div></li>))}</ul>
          </>)}
      </Card>
      {edit && <HookDialog hook={edit === "new" ? undefined : edit} loading={save.isPending} onClose={() => setEdit(null)} onSubmit={(v) => save.mutate({ ...v, id: edit === "new" ? undefined : edit.id })} />}
      <ConfirmDialog open={!!del} onClose={() => setDel(null)} loading={remove.isPending} onConfirm={() => del && remove.mutate(del.id)}
        title="Delete this webhook?" description={`${del?.url ?? ""} will stop receiving events.`} confirmLabel="Delete webhook" />
    </section>
  );
}

const HookBadge = ({ w }: { w: Webhook }) => w.active
  ? <Badge className="border-success/30 bg-success/10 text-success">Active</Badge>
  : <Badge className="border-border bg-muted text-muted-foreground">Paused</Badge>;

function HookActions({ w, onTest, onEdit, onDelete, testing }: { w: Webhook; onTest: () => void; onEdit: () => void; onDelete: () => void; testing: boolean }) {
  return (
    <div className="flex flex-wrap gap-2 md:justify-end">
      <Button size="sm" variant="secondary" loading={testing} aria-label={`Send a test to ${w.url}`} onClick={onTest}><Send /> Test</Button>
      <Button size="sm" variant="secondary" aria-label={`Edit ${w.url}`} onClick={onEdit}><Pencil /> Edit</Button>
      <Button size="sm" variant="secondary" aria-label={`Delete ${w.url}`} onClick={onDelete}><Trash2 /> Delete</Button>
    </div>
  );
}

function HookDialog({ hook, onClose, onSubmit, loading }: { hook?: Webhook; onClose: () => void; onSubmit: (v: HookValues) => void; loading: boolean }) {
  const { register, handleSubmit, formState: { errors } } = useForm<HookValues>({
    resolver: zodResolver(hookSchema) as never,
    defaultValues: { url: hook?.url ?? "https://", events: hook?.events ?? [], active: hook?.active ?? true },
  });
  return (
    <Dialog open onClose={onClose} title={hook ? "Edit webhook" : "Add a webhook"} description="Only public https addresses are accepted.">
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
        <Field label="Address" error={errors.url?.message}>{(p) => <Input {...p} autoFocus type="url" autoComplete="off" spellCheck={false} {...register("url")} />}</Field>
        <fieldset aria-describedby={errors.events ? "events-err" : undefined}>
          <legend className="mb-1.5 text-sm font-medium">Events</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {WEBHOOK_EVENTS.map((e) => (
              <label key={e} className="flex items-center gap-2 text-sm"><input type="checkbox" value={e} className="size-4 accent-[hsl(var(--primary))]" {...register("events")} />{e}</label>))}
          </div>
          {errors.events && <p id="events-err" className="mt-1.5 text-xs text-destructive">{errors.events.message}</p>}
        </fieldset>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-[hsl(var(--primary))]" {...register("active")} />Active (untick to pause)</label>
        <div className="flex justify-end gap-3 pt-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={loading}>Save webhook</Button></div>
      </form>
    </Dialog>
  );
}
