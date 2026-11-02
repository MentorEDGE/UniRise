import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth, can } from "@/app/auth";
import { formatMoney } from "@/lib/utils";
import type { Award } from "@/lib/types";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";
import { EmptyState, ErrorBanner, Skeleton } from "@/components/ui/feedback";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";

const schema = z
  .object({
    title: z.string().trim().min(1, "Title is required"),
    funder: z.string().trim().min(1, "Funder is required"),
    amount: z.coerce.number().min(0, "Amount can't be negative"),
    startYear: z.coerce.number().int().min(1990).max(2100),
    endYear: z.coerce.number().int().min(1990).max(2100),
    researcherId: z.coerce.number().int().positive("Choose the principal investigator"),
  })
  .refine((v) => v.endYear >= v.startYear, { path: ["endYear"], message: "End year must be on or after the start year" });
type Values = z.infer<typeof schema>;

function AwardDialog({ open, onClose, initial }: { open: boolean; onClose: () => void; initial?: Award }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const people = useQuery({ queryKey: ["directory"], queryFn: api.directory });
  const y = new Date().getFullYear();
  const form = useForm<Values>({
    resolver: zodResolver(schema) as never,
    values: initial ?? { title: "", funder: "", amount: 0, startYear: y, endYear: y + 2, researcherId: 0 },
  });
  const save = useMutation({
    mutationFn: (v: Values) => api.saveAward({ ...v, id: initial?.id }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["awards"] }); qc.invalidateQueries({ queryKey: ["summary"] }); qc.invalidateQueries({ queryKey: ["dept-report"] }); toast({ tone: "ok", message: "Award saved." }); onClose(); },
    onError: () => toast({ tone: "error", message: "Couldn't save. Try again." }),
  });
  const e = form.formState.errors;
  return (
    <Dialog open={open} onClose={onClose} title={initial ? "Edit award" : "Add award"}>
      <form onSubmit={form.handleSubmit((v) => save.mutate(v))} className="space-y-4" noValidate>
        <Field label="Title" error={e.title?.message}>{(a) => <Input {...a} {...form.register("title")} />}</Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Funder" error={e.funder?.message}>{(a) => <Input {...a} {...form.register("funder")} />}</Field>
          <Field label="Amount (INR)" error={e.amount?.message}>{(a) => <Input {...a} type="number" min={0} {...form.register("amount")} />}</Field>
          <Field label="Start year" error={e.startYear?.message}>{(a) => <Input {...a} type="number" {...form.register("startYear")} />}</Field>
          <Field label="End year" error={e.endYear?.message}>{(a) => <Input {...a} type="number" {...form.register("endYear")} />}</Field>
        </div>
        <Field label="Principal investigator" error={e.researcherId?.message}>
          {(a) => <Select {...a} {...form.register("researcherId")}><option value="">Select…</option>{people.data?.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select>}
        </Field>
        <div className="flex justify-end gap-3 pt-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={save.isPending}>Save award</Button></div>
      </form>
    </Dialog>
  );
}

export default function Awards() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { toast } = useToast();
  const awards = useQuery({ queryKey: ["awards"], queryFn: api.awards });
  const people = useQuery({ queryKey: ["directory"], queryFn: api.directory });
  const [editing, setEditing] = useState<Award | undefined>();
  const [open, setOpen] = useState(false);
  const [del, setDel] = useState<number | null>(null);
  const remove = useMutation({
    mutationFn: (id: number) => api.deleteAward(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["awards"] }); setDel(null); toast({ tone: "ok", message: "Award deleted." }); },
  });
  const edit = can.admin(user?.role);
  const pi = (id: number) => people.data?.find((r) => r.id === id)?.name ?? "—";
  const total = awards.data?.reduce((s, a) => s + a.amount, 0) ?? 0;

  return (
    <div>
      <PageHeader eyebrow="Funding" title="Awards" description={awards.data ? `${awards.data.length} awards · ${formatMoney(total)} total` : undefined}
        actions={edit && <Button onClick={() => { setEditing(undefined); setOpen(true); }}><Plus /> Add award</Button>} />
      {awards.isError && <ErrorBanner error={awards.error} onRetry={() => awards.refetch()} />}
      <Card className="overflow-hidden">
        {awards.isLoading ? <div className="space-y-3 p-6">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-12" />)}</div>
          : awards.data?.length === 0 ? <EmptyState title="No awards recorded" description="Add grants and funded projects to see funding by department." />
          : (<>
            <div className="hidden md:block"><Table>
              <THead><tr><TH>Award</TH><TH>Funder</TH><TH>Period</TH><TH>PI</TH><TH className="text-right">Amount</TH><TH><span className="sr-only">Actions</span></TH></tr></THead>
              <TBody>{awards.data?.map((a) => (
                <TR key={a.id}><TD className="font-medium">{a.title}</TD><TD>{a.funder}</TD><TD>{a.startYear}–{a.endYear}</TD><TD>{pi(a.researcherId)}</TD>
                  <TD className="text-right font-medium">{formatMoney(a.amount)}</TD>
                  <TD className="whitespace-nowrap">{edit && <>
                    <Button variant="ghost" size="icon" aria-label={`Edit ${a.title}`} onClick={() => { setEditing(a); setOpen(true); }}><Pencil /></Button>
                    <Button variant="ghost" size="icon" aria-label={`Delete ${a.title}`} onClick={() => setDel(a.id)}><Trash2 /></Button></>}</TD></TR>))}</TBody></Table></div>
            <ul className="divide-y md:hidden">{awards.data?.map((a) => (
              <li key={a.id} className="p-4"><p className="font-medium">{a.title}</p><p className="text-xs text-muted-foreground">{a.funder} · {a.startYear}–{a.endYear}</p><p className="mt-1 font-semibold">{formatMoney(a.amount)}</p></li>))}</ul>
          </>)}
      </Card>
      <AwardDialog open={open} onClose={() => setOpen(false)} initial={editing} />
      <ConfirmDialog open={del !== null} onClose={() => setDel(null)} onConfirm={() => del !== null && remove.mutate(del)} loading={remove.isPending}
        title="Delete this award?" description="It will be removed from funding totals." />
    </div>
  );
}
