import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { CalendarX, Pencil, Plus } from "lucide-react";
import { api } from "@/lib/api";
import { HttpError } from "@/lib/http";
import { formatDate } from "@/lib/utils";
import type { ClassificationScheme, ClassificationTerm } from "@/lib/types";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/form";
import { EmptyState, ErrorBanner, Skeleton } from "@/components/ui/feedback";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";

const today = () => new Date().toISOString().slice(0, 10);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date");

const schemeSchema = z.object({
  code: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{1,40}$/, "Use 2 to 41 letters, digits or hyphens"),
  name: z.string().trim().min(2, "Enter a name").max(80, "Use at most 80 characters"),
});
const termSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9_-]{0,30}$/, "Use letters, digits, hyphen or underscore"),
  label: z.string().trim().min(1, "Enter a label").max(80, "Use at most 80 characters"),
  validFrom: isoDate,
});
type SchemeValues = z.infer<typeof schemeSchema>;
type TermValues = z.infer<typeof termSchema>;

const termActive = (t: ClassificationTerm, on = today()) => t.validFrom <= on && (!t.validTo || t.validTo >= on);

type Dlg = { kind: "scheme"; scheme?: ClassificationScheme } | { kind: "term"; scheme: ClassificationScheme } | { kind: "end"; scheme: ClassificationScheme; term: ClassificationTerm } | null;

export default function ClassificationTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [dlg, setDlg] = useState<Dlg>(null);
  const q = useQuery({ queryKey: ["classification"], queryFn: () => api.classification() });
  const close = () => setDlg(null);
  const ok = (message: string) => { qc.invalidateQueries({ queryKey: ["classification"] }); qc.invalidateQueries({ queryKey: ["audit"] }); toast({ tone: "ok", message }); close(); };
  const fail = (e: unknown) => toast({ tone: "error", message: e instanceof HttpError && e.status === 409 ? "That code is already used or already ended." : e instanceof HttpError && e.status === 400 ? "Some values are not valid." : "Couldn't save. Try again." });

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted-foreground">Lists such as journal quality tiers change over time. Terms are never deleted: you end them on a date, so past records keep their meaning.</p>
        <Button onClick={() => setDlg({ kind: "scheme" })}><Plus /> New list</Button>
      </div>

      {q.isError && <ErrorBanner error={q.error} onRetry={() => q.refetch()} />}
      {q.isLoading ? <div className="space-y-3">{[0, 1].map((i) => <Skeleton key={i} className="h-40" />)}</div>
        : q.data?.length === 0 ? <Card><EmptyState title="No classification lists yet" description="Create a list, then add terms with the date they start." action={<Button onClick={() => setDlg({ kind: "scheme" })}><Plus /> New list</Button>} /></Card>
        : (
          <div className="space-y-5">
            {q.data?.map((s) => (
              <Card key={s.id} className="overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b px-6 py-4">
                  <div><h3 className="text-lg font-semibold tracking-tight">{s.name}</h3><p className="text-xs text-muted-foreground">Code {s.code} · {s.terms.length} term{s.terms.length === 1 ? "" : "s"}</p></div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="secondary" onClick={() => setDlg({ kind: "scheme", scheme: s })}><Pencil /> Rename</Button>
                    <Button size="sm" onClick={() => setDlg({ kind: "term", scheme: s })}><Plus /> Add term</Button>
                  </div>
                </div>
                {s.terms.length === 0 ? <EmptyState title="No terms yet" description="Add the first term and the date it starts." />
                  : (<>
                    <div className="hidden md:block"><Table>
                      <THead><tr><TH>Code</TH><TH>Label</TH><TH>Valid from</TH><TH>Valid to</TH><TH>Status</TH><TH><span className="sr-only">Actions</span></TH></tr></THead>
                      <TBody>{s.terms.map((t) => (
                        <TR key={t.code}>
                          <TD className="whitespace-nowrap font-medium">{t.code}</TD><TD>{t.label}</TD><TD>{formatDate(t.validFrom)}</TD><TD>{t.validTo ? formatDate(t.validTo) : "—"}</TD>
                          <TD><TermBadge t={t} /></TD>
                          <TD className="text-right">{!t.validTo && <Button size="sm" variant="secondary" onClick={() => setDlg({ kind: "end", scheme: s, term: t })}><CalendarX /> End term</Button>}</TD>
                        </TR>))}</TBody></Table></div>
                    <ul className="divide-y md:hidden">{s.terms.map((t) => (
                      <li key={t.code} className="space-y-1 p-4">
                        <p className="font-medium">{t.code} · {t.label}</p>
                        <p className="text-xs text-muted-foreground">{formatDate(t.validFrom)} to {t.validTo ? formatDate(t.validTo) : "no end date"}</p>
                        <div className="flex items-center gap-2"><TermBadge t={t} />{!t.validTo && <Button size="sm" variant="secondary" onClick={() => setDlg({ kind: "end", scheme: s, term: t })}><CalendarX /> End term</Button>}</div>
                      </li>))}</ul>
                  </>)}
              </Card>))}
          </div>)}

      {dlg?.kind === "scheme" && <SchemeDialog scheme={dlg.scheme} onClose={close} onDone={(m) => ok(m)} onFail={fail} />}
      {dlg?.kind === "term" && <TermDialog scheme={dlg.scheme} onClose={close} onDone={(m) => ok(m)} onFail={fail} />}
      {dlg?.kind === "end" && <EndDialog scheme={dlg.scheme} term={dlg.term} onClose={close} onDone={(m) => ok(m)} onFail={fail} />}
      <Card className="mt-5 border-dashed p-4"><CardContent className="p-0 text-xs text-muted-foreground">Sample data until a backend is connected. Changes here are lost when the page reloads.</CardContent></Card>
    </div>
  );
}

function TermBadge({ t }: { t: ClassificationTerm }) {
  const now = today();
  if (t.validFrom > now) return <Badge className="border-border bg-muted text-muted-foreground">Starts later</Badge>;
  return termActive(t) ? <Badge className="border-success/30 bg-success/10 text-success">In use</Badge> : <Badge className="border-border bg-muted text-muted-foreground">Ended</Badge>;
}

interface DialogProps { onClose: () => void; onDone: (message: string) => void; onFail: (e: unknown) => void }

function SchemeDialog({ scheme, onClose, onDone, onFail }: DialogProps & { scheme?: ClassificationScheme }) {
  const form = useForm<SchemeValues>({ resolver: zodResolver(schemeSchema) as never, defaultValues: { code: scheme?.code ?? "", name: scheme?.name ?? "" } });
  const m = useMutation({ mutationFn: (v: SchemeValues) => api.saveClassificationScheme({ ...v, id: scheme?.id }), onSuccess: () => onDone(scheme ? "List renamed." : "List created."), onError: onFail });
  const { register, handleSubmit, formState: { errors } } = form;
  return (
    <Dialog open onClose={onClose} title={scheme ? "Rename list" : "New classification list"} description="A list groups related terms, such as journal quality tiers.">
      <form onSubmit={handleSubmit((v) => m.mutate(v))} noValidate className="space-y-4">
        <Field label="Name" error={errors.name?.message}>{(p) => <Input {...p} autoFocus {...register("name")} />}</Field>
        <Field label="Code" hint="Short and lowercase, for example grant-types" error={errors.code?.message}>{(p) => <Input {...p} autoComplete="off" {...register("code")} />}</Field>
        <div className="flex justify-end gap-3 pt-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={m.isPending}>{scheme ? "Save" : "Create list"}</Button></div>
      </form>
    </Dialog>
  );
}

function TermDialog({ scheme, onClose, onDone, onFail }: DialogProps & { scheme: ClassificationScheme }) {
  const form = useForm<TermValues>({ resolver: zodResolver(termSchema) as never, defaultValues: { code: "", label: "", validFrom: today() } });
  const m = useMutation({ mutationFn: (v: TermValues) => api.addTerm({ schemeId: scheme.id, ...v }), onSuccess: () => onDone("Term added."), onError: onFail });
  const { register, handleSubmit, formState: { errors } } = form;
  return (
    <Dialog open onClose={onClose} title={`Add a term to ${scheme.name}`} description="The term applies from the start date until you end it.">
      <form onSubmit={handleSubmit((v) => m.mutate(v))} noValidate className="space-y-4">
        <Field label="Label" error={errors.label?.message}>{(p) => <Input {...p} autoFocus {...register("label")} />}</Field>
        <Field label="Code" hint="Short and unique in this list, for example SCOPUS" error={errors.code?.message}>{(p) => <Input {...p} autoComplete="off" {...register("code")} />}</Field>
        <Field label="Valid from" error={errors.validFrom?.message}>{(p) => <Input {...p} type="date" {...register("validFrom")} />}</Field>
        <div className="flex justify-end gap-3 pt-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={m.isPending}>Add term</Button></div>
      </form>
    </Dialog>
  );
}

function EndDialog({ scheme, term, onClose, onDone, onFail }: DialogProps & { scheme: ClassificationScheme; term: ClassificationTerm }) {
  const schema = z.object({ validTo: isoDate.refine((d) => d >= term.validFrom, `Must be on or after ${term.validFrom}`) });
  const form = useForm<{ validTo: string }>({ resolver: zodResolver(schema) as never, defaultValues: { validTo: today() > term.validFrom ? today() : term.validFrom } });
  const m = useMutation({ mutationFn: (v: { validTo: string }) => api.endTerm({ schemeId: scheme.id, code: term.code, ...v }), onSuccess: () => onDone("Term ended."), onError: onFail });
  const { register, handleSubmit, formState: { errors } } = form;
  return (
    <Dialog open onClose={onClose} title={`End ${term.code}`} description={`${term.label} stays on past records. New records can't use it after the end date.`}>
      <form onSubmit={handleSubmit((v) => m.mutate(v))} noValidate className="space-y-4">
        <Field label="Last day it is valid" error={errors.validTo?.message}>{(p) => <Input {...p} type="date" autoFocus {...register("validTo")} />}</Field>
        <div className="flex justify-end gap-3 pt-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant="destructive" type="submit" loading={m.isPending}>End term</Button></div>
      </form>
    </Dialog>
  );
}
