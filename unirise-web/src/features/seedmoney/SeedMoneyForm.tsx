import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Plus, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { HttpError } from "@/lib/http";
import { useAuth, can } from "@/app/auth";
import { formatDate } from "@/lib/utils";
import type { EntryStatus, ReviewAction } from "@/lib/types";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";
import { StatusBadge } from "@/components/ui/badge";
import { ReviewBar } from "@/components/ui/review-bar";
import { ErrorBanner, Skeleton } from "@/components/ui/feedback";
import { useToast } from "@/components/ui/toast";
import { seedId, seedStatusLabel } from "./SeedMoney";

const TYPES = ["Principal Investigator", "Co-Investigator", "Mentor"];
const CATEGORIES = ["Faculty seed money", "Student seed money"];

const schema = z.object({
  category: z.string().min(1, "Choose the category"),
  title: z.string().trim().min(1, "Title is required"),
  abstract: z.string().trim().min(1, "Abstract is required"),
  investigators: z.array(z.object({
    researcherId: z.number().optional(), name: z.string().trim().min(1, "Choose the investigator"),
    investigatorType: z.string().min(1, "Choose the type"), isLeadPI: z.boolean(), institution: z.string(), department: z.string().optional(),
  })).min(1, "Add at least one investigator"),
}).superRefine((v, ctx) => { if (v.investigators.filter((i) => i.isLeadPI).length !== 1) ctx.addIssue({ code: "custom", path: ["investigators"], message: "Mark exactly one lead PI" }); });
type Values = z.infer<typeof schema>;

export default function SeedMoneyForm() {
  const { id } = useParams();
  const editing = !!id && id !== "new";
  const nav = useNavigate();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();
  const existing = useQuery({ queryKey: ["seed-proposal", id], queryFn: () => api.seedProposal(Number(id)), enabled: editing });
  const people = useQuery({ queryKey: ["researchers", "all"], queryFn: () => api.researchers() });
  const depts = useQuery({ queryKey: ["departments"], queryFn: api.departments });
  const me = people.data?.find((r) => r.id === user?.researcherId);

  const form = useForm<Values>({
    resolver: zodResolver(schema) as never,
    defaultValues: { category: "", title: "", abstract: "", investigators: [{ name: "", investigatorType: "", isLeadPI: true, institution: "Demo University" }] },
  });
  const invs = useFieldArray({ control: form.control, name: "investigators" });
  const errors = form.formState.errors;
  const dept = (rid: number) => depts.data?.find((d) => d.id === rid)?.name ?? "";

  useEffect(() => { if (existing.data) form.reset({ category: existing.data.category, title: existing.data.title, abstract: existing.data.abstract, investigators: existing.data.investigators }); }, [existing.data, form]);
  // Pre-fill the applicant as lead PI on a new proposal.
  useEffect(() => {
    if (!editing && me && !form.getValues("investigators.0.name")) {
      form.setValue("investigators.0", { researcherId: me.id, name: me.name, investigatorType: "Principal Investigator", isLeadPI: true, institution: "Demo University", department: dept(me.departmentId) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me, depts.data, editing]);

  const save = useMutation({
    mutationFn: ({ v, status }: { v: Values; status: EntryStatus }) => api.saveSeedProposal({ ...v, status, id: editing ? Number(id) : undefined }),
    onSuccess: (_s, { status }) => { qc.invalidateQueries({ queryKey: ["seed-proposals"] }); toast({ tone: "ok", message: status === "submitted" ? "Proposal submitted." : "Draft saved." }); nav("/seed-money"); },
    onError: (e) => toast({ tone: "error", message: e instanceof HttpError && e.status === 409 ? "Applications for this quarter are closed." : "Couldn't save. Try again." }),
  });
  const review = useMutation({
    mutationFn: ({ action, comment }: { action: ReviewAction; comment: string }) => api.reviewSeedProposal(Number(id), action, comment || undefined),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["seed-proposals"] }); toast({ tone: "ok", message: "Review recorded." }); nav("/seed-money"); },
    onError: () => toast({ tone: "error", message: "Couldn't record the review. Try again." }),
  });

  if (!can.edit(user?.role) && !editing) return <ErrorBanner error={new HttpError(403)} />;
  if (editing && existing.isError) return <ErrorBanner error={existing.error} onRetry={() => existing.refetch()} />;
  const s = existing.data;
  const readOnly = !can.edit(user?.role) || (!!s && !["draft", "rework", "revision_required"].includes(s.status));
  const go = (status: EntryStatus) => form.handleSubmit((v) => save.mutate({ v, status }))();

  return (
    <div className="max-w-4xl">
      <PageHeader eyebrow="Seed money" title={s ? `${seedId(s.id)} · ${s.title}` : "New proposal"} description={s ? `Applied ${formatDate(s.appliedOn)} · ${s.windowLabel}` : "Save a draft, then submit before the window closes."} />
      {s && <div className="mb-4 flex flex-wrap items-center gap-2"><StatusBadge status={s.status} label={seedStatusLabel(s.status)} />{s.reviewComment && <span className="text-sm text-muted-foreground">Reviewer: {s.reviewComment}</span>}</div>}
      {s?.status === "submitted" && can.review(user?.role) && <ReviewBar loading={review.isPending} onReview={(action, comment) => review.mutate({ action, comment })} />}

      {existing.isLoading && editing ? <Skeleton className="h-80 w-full" /> : (
        <Card><CardContent><form onSubmit={(e) => e.preventDefault()} className="space-y-5" noValidate>
          <Field label="Category applied" error={errors.category?.message}>{(a) => <Select {...a} {...form.register("category")} disabled={readOnly}><option value="">Select…</option>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</Select>}</Field>
          <Field label="Title of the project" error={errors.title?.message}>{(a) => <Input {...a} {...form.register("title")} disabled={readOnly} />}</Field>
          <Field label="Abstract" error={errors.abstract?.message}>{(a) => <textarea {...a} rows={5} {...form.register("abstract")} disabled={readOnly} className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm" />}</Field>

          <fieldset className="space-y-3"><legend className="text-sm font-semibold">Investigators</legend>
            {(errors.investigators?.root?.message ?? errors.investigators?.message) && <p role="alert" className="text-xs text-destructive">{errors.investigators?.root?.message ?? errors.investigators?.message}</p>}
            {invs.fields.map((f, i) => (
              <div key={f.id} className="grid gap-3 rounded-xl border p-4 sm:grid-cols-3">
                <Field label="Investigator" error={errors.investigators?.[i]?.name?.message}>{(a) => <Select {...a} disabled={readOnly} value={form.watch(`investigators.${i}.researcherId`) ?? ""} onChange={(ev) => {
                  const r = people.data?.find((x) => x.id === Number(ev.target.value));
                  form.setValue(`investigators.${i}.researcherId`, r?.id); form.setValue(`investigators.${i}.name`, r?.name ?? "", { shouldValidate: true });
                  form.setValue(`investigators.${i}.department`, r ? dept(r.departmentId) : "");
                }}><option value="">Select…</option>{people.data?.map((r) => <option key={r.id} value={r.id}>{r.name}{r.employeeId ? ` (${r.employeeId})` : r.rollNo ? ` (${r.rollNo})` : ""}</option>)}</Select>}</Field>
                <Field label="Investigator type" error={errors.investigators?.[i]?.investigatorType?.message}>{(a) => <Select {...a} {...form.register(`investigators.${i}.investigatorType`)} disabled={readOnly}><option value="">Select…</option>{TYPES.map((t) => <option key={t}>{t}</option>)}</Select>}</Field>
                <label className="flex items-end gap-2 pb-2 text-sm font-medium"><input type="radio" name="lead" className="size-4 accent-[hsl(var(--primary))]" checked={form.watch(`investigators.${i}.isLeadPI`)} disabled={readOnly}
                  onChange={() => invs.fields.forEach((_, j) => form.setValue(`investigators.${j}.isLeadPI`, j === i))} />Lead PI</label>
                {!readOnly && invs.fields.length > 1 && <div className="flex items-end"><Button variant="ghost" onClick={() => invs.remove(i)} aria-label={`Remove investigator ${i + 1}`}><Trash2 /> Remove</Button></div>}
              </div>))}
            {!readOnly && <Button variant="secondary" onClick={() => invs.append({ name: "", investigatorType: "", isLeadPI: false, institution: "Demo University" })}><Plus /> Add investigator</Button>}
          </fieldset>

          {!readOnly && <div className="flex flex-wrap justify-end gap-3 pt-2"><Button variant="secondary" onClick={() => nav("/seed-money")}>Cancel</Button>
            <Button variant="secondary" loading={save.isPending} onClick={() => go("draft")}>Save draft</Button><Button loading={save.isPending} onClick={() => go("submitted")}>Submit</Button></div>}
        </form></CardContent></Card>)}
    </div>
  );
}
