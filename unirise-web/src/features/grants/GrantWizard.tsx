import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useFieldArray, useForm, type FieldPath } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { FileText, Plus, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { HttpError } from "@/lib/http";
import { useAuth, can } from "@/app/auth";
import { cn, formatMoney } from "@/lib/utils";
import type { Grant, GrantStatus, ReviewAction } from "@/lib/types";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";
import { StatusBadge } from "@/components/ui/badge";
import { ReviewBar } from "@/components/ui/review-bar";
import { ErrorBanner, Skeleton } from "@/components/ui/feedback";
import { useToast } from "@/components/ui/toast";
import { GRANT_TYPES, grantId } from "./Grants";

const UNITS = ["Indian Grant", "International Grant", "Industry Grant", "Institutional Grant"];
const SOURCES = ["Central Government", "State Government", "Industry", "International", "Institutional", "Other"];
const STEPS = ["Basic details", "Investigators", "Enclosures", "Others", "Submit"] as const;
const MAX_FILE = 10 * 1024 * 1024;

const investigator = z.object({
  internal: z.boolean(),
  researcherId: z.number().optional(),
  name: z.string().trim().min(1, "Name is required"),
  role: z.enum(["PI", "Co-PI", "Collaborator"]),
  isLead: z.boolean(),
  institution: z.string().trim().min(1, "Institution is required"),
  department: z.string().trim().optional(),
  sharePct: z.coerce.number().min(0, "Share can't be negative").max(100, "Share can't exceed 100"),
}).superRefine((v, ctx) => { if (v.internal && !v.researcherId) ctx.addIssue({ code: "custom", path: ["researcherId"], message: "Choose the person" }); });

const schema = z.object({
  unit: z.string().min(1, "Choose the grant unit"),
  type: z.string().min(1, "Choose the grant type"),
  source: z.string().min(1, "Choose the source"),
  appliedOn: z.string().min(1, "Enter the applied date"),
  appliedAmount: z.coerce.number().min(0, "Amount can't be negative"),
  durationMonths: z.coerce.number().int().min(0).optional(),
  matchingGrant: z.boolean(),
  contact: z.string().trim().optional(),
  title: z.string().trim().min(1, "Grant title is required"),
  description: z.string().trim().optional(),
  callTitle: z.string().trim().optional(),
  agency: z.string().trim().min(1, "Grant agency is required"),
  agencyComment: z.string().trim().optional(),
  investigators: z.array(investigator).min(1, "Add at least one investigator"),
  remarks: z.string().trim().optional(),
}).superRefine((v, ctx) => {
  if (v.investigators.filter((i) => i.isLead).length !== 1) ctx.addIssue({ code: "custom", path: ["investigators"], message: "Mark exactly one lead investigator" });
  const total = v.investigators.reduce((s, i) => s + (Number(i.sharePct) || 0), 0);
  if (Math.round(total) !== 100) ctx.addIssue({ code: "custom", path: ["investigators"], message: `Shares add up to ${total}%, they must total 100%` });
});
type Values = z.infer<typeof schema>;

const stepFields: FieldPath<Values>[][] = [
  ["unit", "type", "source", "appliedOn", "appliedAmount", "title", "agency"],
  ["investigators"], [], [], [],
];
const blankInv = (lead = false): Values["investigators"][number] => ({ internal: true, name: "", role: lead ? "PI" : "Co-PI", isLead: lead, institution: "", department: "", sharePct: lead ? 100 : 0 });
const today = () => new Date().toISOString().slice(0, 10);
const editable = (g?: Grant) => !g || g.status === "draft" || g.status === "rework";

export default function GrantWizard() {
  const { id } = useParams();
  const editing = !!id && id !== "new";
  const nav = useNavigate();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();
  const [step, setStep] = useState(0);
  const [files, setFiles] = useState<string[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);

  const existing = useQuery({ queryKey: ["grant", id], queryFn: () => api.grant(Number(id)), enabled: editing });
  const people = useQuery({ queryKey: ["researchers", "all"], queryFn: () => api.researchers() });
  const depts = useQuery({ queryKey: ["departments"], queryFn: api.departments });
  const deptName = (rid: number) => depts.data?.find((d) => d.id === rid)?.name ?? "";

  const form = useForm<Values>({
    resolver: zodResolver(schema) as never,
    defaultValues: { unit: "", type: "", source: "", appliedOn: today(), appliedAmount: 0, matchingGrant: false, title: "", agency: "", investigators: [blankInv(true)], remarks: "" },
  });
  const invs = useFieldArray({ control: form.control, name: "investigators" });
  const errors = form.formState.errors;

  useEffect(() => {
    const g = existing.data;
    if (!g) return;
    form.reset({
      unit: g.unit, type: g.type, source: g.source, appliedOn: g.appliedOn, appliedAmount: g.appliedAmount, durationMonths: g.durationMonths, matchingGrant: g.matchingGrant,
      contact: g.contact ?? "", title: g.title, description: g.description ?? "", callTitle: g.callTitle ?? "", agency: g.agency, agencyComment: g.agencyComment ?? "",
      investigators: g.investigators.map((i) => ({ ...i, internal: !!i.researcherId })), remarks: g.remarks ?? "",
    });
    setFiles(g.enclosures.map((e) => e.name));
  }, [existing.data, form]);

  const save = useMutation({
    mutationFn: ({ v, status }: { v: Values; status: Extract<GrantStatus, "draft" | "submitted"> }) =>
      api.saveGrant({
        ...v, id: editing ? Number(id) : undefined, status, durationMonths: v.durationMonths || undefined,
        investigators: v.investigators.map(({ internal: _i, ...rest }) => rest), enclosures: files.map((name) => ({ name })),
      }),
    onSuccess: (_g, { status }) => { qc.invalidateQueries({ queryKey: ["grants"] }); qc.invalidateQueries({ queryKey: ["grant", id] }); toast({ tone: "ok", message: status === "submitted" ? "Grant submitted." : "Draft saved." }); nav("/grants"); },
    onError: (e) => toast({ tone: "error", message: e instanceof HttpError && e.status === 400 ? "Complete the title, agency and a lead investigator before submitting." : "Couldn't save. Try again." }),
  });
  const review = useMutation({
    mutationFn: ({ action, comment }: { action: ReviewAction; comment: string }) => api.reviewGrant(Number(id), action, comment || undefined),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["grants"] }); qc.invalidateQueries({ queryKey: ["grant", id] }); toast({ tone: "ok", message: "Review recorded." }); nav("/grants"); },
    onError: () => toast({ tone: "error", message: "Couldn't record the review. Try again." }),
  });

  const pick = (list: FileList | null) => {
    setFileError(null);
    for (const f of Array.from(list ?? [])) {
      if (!f.name.toLowerCase().endsWith(".pdf")) return setFileError("Only PDF files can be attached.");
      if (f.size > MAX_FILE) return setFileError(`${f.name} is larger than 10 MB.`);
      setFiles((x) => (x.includes(f.name) ? x : [...x, f.name])); // shortcut: names only in the mock; the real API takes a multipart upload
    }
  };
  const next = async () => { if (await form.trigger(stepFields[step])) setStep((s) => Math.min(s + 1, STEPS.length - 1)); };
  const submitWith = (status: "draft" | "submitted") => form.handleSubmit((v) => save.mutate({ v, status }), () => setStep(0))();

  if (!can.edit(user?.role) && !editing) return <ErrorBanner error={new HttpError(403)} />;
  if (editing && existing.isError) return <ErrorBanner error={existing.error} onRetry={() => existing.refetch()} />;
  const g = existing.data;
  const readOnly = !can.edit(user?.role) || !editable(g);
  const totalShare = form.watch("investigators").reduce((s, i) => s + (Number(i.sharePct) || 0), 0);

  return (
    <div className="max-w-4xl">
      <PageHeader eyebrow="Grants" title={editing && g ? `${grantId(g.id)} · ${g.title}` : "New grant"} description="Save a draft at any step. Submit when every step is complete." />
      {g && <div className="mb-4 flex flex-wrap items-center gap-2"><StatusBadge status={g.status} />
        {g.sanctionedOn && <span className="text-sm text-muted-foreground">Sanctioned {g.sanctionedOn} · {formatMoney(g.sanctionedAmount ?? 0)}</span>}
        {g.reviewComment && <span className="text-sm text-muted-foreground">Reviewer: {g.reviewComment}</span>}</div>}
      {g?.status === "submitted" && can.review(user?.role) && <ReviewBar approveLabel="Sanction" loading={review.isPending} onReview={(action, comment) => review.mutate({ action, comment })} />}

      <nav aria-label="Steps" className="mb-6 flex flex-wrap gap-1 rounded-2xl border bg-card p-1">
        {STEPS.map((s, i) => (
          <button key={s} type="button" aria-current={i === step ? "step" : undefined} onClick={() => setStep(i)}
            className={cn("flex-1 rounded-xl px-3 py-2 text-sm font-semibold transition-colors", i === step ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>{i + 1}. {s}</button>))}
      </nav>

      {existing.isLoading && editing ? <Skeleton className="h-96 w-full" /> : (
        <Card><CardContent><form onSubmit={(e) => e.preventDefault()} className="space-y-5" noValidate>
          {step === 0 && (<>
            <div className="grid gap-5 sm:grid-cols-3">
              <Field label="Grant unit" error={errors.unit?.message}>{(a) => <Select {...a} {...form.register("unit")} disabled={readOnly}><option value="">Select…</option>{UNITS.map((u) => <option key={u}>{u}</option>)}</Select>}</Field>
              <Field label="Grant type" error={errors.type?.message}>{(a) => <Select {...a} {...form.register("type")} disabled={readOnly}><option value="">Select…</option>{GRANT_TYPES.map((u) => <option key={u}>{u}</option>)}</Select>}</Field>
              <Field label="Grant source" error={errors.source?.message}>{(a) => <Select {...a} {...form.register("source")} disabled={readOnly}><option value="">Select…</option>{SOURCES.map((u) => <option key={u}>{u}</option>)}</Select>}</Field>
            </div>
            <div className="grid gap-5 sm:grid-cols-4">
              <Field label="Applied date" error={errors.appliedOn?.message}>{(a) => <Input {...a} type="date" {...form.register("appliedOn")} disabled={readOnly} />}</Field>
              <Field label="Applied amount (INR)" error={errors.appliedAmount?.message}>{(a) => <Input {...a} type="number" min={0} {...form.register("appliedAmount")} disabled={readOnly} />}</Field>
              <Field label="Duration (months)">{(a) => <Input {...a} type="number" min={0} {...form.register("durationMonths")} disabled={readOnly} />}</Field>
              <Field label="Contact number">{(a) => <Input {...a} {...form.register("contact")} disabled={readOnly} />}</Field>
            </div>
            <label className="flex items-center gap-3 text-sm font-medium"><input type="checkbox" className="size-4 accent-[hsl(var(--primary))]" {...form.register("matchingGrant")} disabled={readOnly} />A matching grant is required for capital items (if mandated by the funding agency)</label>
            <Field label="Grant title" error={errors.title?.message}>{(a) => <Input {...a} {...form.register("title")} disabled={readOnly} />}</Field>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Description">{(a) => <textarea {...a} rows={3} {...form.register("description")} disabled={readOnly} className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm" />}</Field>
              <Field label="Grant call title">{(a) => <Input {...a} {...form.register("callTitle")} disabled={readOnly} />}</Field>
            </div>
            <fieldset className="space-y-4 rounded-xl border p-4"><legend className="px-1 text-sm font-semibold">Agency details</legend>
              <div className="grid gap-5 sm:grid-cols-2">
                <Field label="Grant agency" error={errors.agency?.message}>{(a) => <Input {...a} {...form.register("agency")} disabled={readOnly} />}</Field>
                <Field label="Agency comment">{(a) => <Input {...a} {...form.register("agencyComment")} disabled={readOnly} />}</Field>
              </div></fieldset>
          </>)}

          {step === 1 && (<fieldset className="space-y-3"><legend className="text-sm font-semibold">Investigators</legend>
            <p className="text-xs text-muted-foreground">Exactly one lead. Shares must total 100% (now {totalShare}%).</p>
            {errors.investigators?.root?.message ?? errors.investigators?.message ? <p role="alert" className="text-xs text-destructive">{errors.investigators?.root?.message ?? errors.investigators?.message}</p> : null}
            {invs.fields.map((f, i) => {
              const internal = form.watch(`investigators.${i}.internal`);
              const e = errors.investigators?.[i];
              return (
                <div key={f.id} className="grid gap-3 rounded-xl border p-4 sm:grid-cols-3">
                  <Field label="Investigator from">{(a) => <Select {...a} disabled={readOnly} value={internal ? "in" : "out"} onChange={(ev) => { const inn = ev.target.value === "in"; form.setValue(`investigators.${i}.internal`, inn); form.setValue(`investigators.${i}.researcherId`, undefined); form.setValue(`investigators.${i}.name`, ""); form.setValue(`investigators.${i}.institution`, inn ? "Demo University" : ""); }}><option value="in">This institution</option><option value="out">Outside</option></Select>}</Field>
                  {internal ? (
                    <Field label="Person" error={e?.researcherId?.message}>{(a) => <Select {...a} disabled={readOnly} value={form.watch(`investigators.${i}.researcherId`) ?? ""} onChange={(ev) => {
                      const r = people.data?.find((x) => x.id === Number(ev.target.value));
                      form.setValue(`investigators.${i}.researcherId`, r?.id, { shouldValidate: true }); form.setValue(`investigators.${i}.name`, r?.name ?? "");
                      form.setValue(`investigators.${i}.institution`, r ? "Demo University" : ""); form.setValue(`investigators.${i}.department`, r ? deptName(r.departmentId) : "");
                    }}><option value="">Select…</option>{people.data?.map((r) => <option key={r.id} value={r.id}>{r.name}{r.employeeId ? ` (${r.employeeId})` : ""}</option>)}</Select>}</Field>
                  ) : (<>
                    <Field label="Name" error={e?.name?.message}>{(a) => <Input {...a} {...form.register(`investigators.${i}.name`)} disabled={readOnly} />}</Field>
                    <Field label="Institution" error={e?.institution?.message}>{(a) => <Input {...a} {...form.register(`investigators.${i}.institution`)} disabled={readOnly} />}</Field></>)}
                  <Field label="Role">{(a) => <Select {...a} {...form.register(`investigators.${i}.role`)} disabled={readOnly}><option>PI</option><option>Co-PI</option><option>Collaborator</option></Select>}</Field>
                  <Field label="Share %" error={e?.sharePct?.message}>{(a) => <Input {...a} type="number" min={0} max={100} {...form.register(`investigators.${i}.sharePct`)} disabled={readOnly} />}</Field>
                  <label className="flex items-end gap-2 pb-2 text-sm font-medium"><input type="radio" name="lead" className="size-4 accent-[hsl(var(--primary))]" checked={form.watch(`investigators.${i}.isLead`)} disabled={readOnly}
                    onChange={() => invs.fields.forEach((_, j) => form.setValue(`investigators.${j}.isLead`, j === i))} />Lead investigator</label>
                  {!readOnly && invs.fields.length > 1 && <div className="flex items-end"><Button variant="ghost" onClick={() => invs.remove(i)} aria-label={`Remove investigator ${i + 1}`}><Trash2 /> Remove</Button></div>}
                </div>);
            })}
            {!readOnly && <Button variant="secondary" onClick={() => invs.append(blankInv())}><Plus /> Add investigator</Button>}
          </fieldset>)}

          {step === 2 && (<fieldset className="space-y-3"><legend className="text-sm font-semibold">Enclosures</legend>
            {!readOnly && <input type="file" multiple accept="application/pdf,.pdf" aria-label="Attach PDF files" onChange={(e) => pick(e.target.files)} className="text-sm" />}
            <p className="text-xs text-muted-foreground">PDF only, up to 10 MB each.</p>
            {fileError && <p role="alert" className="text-xs text-destructive">{fileError}</p>}
            <ul className="space-y-1">{files.map((n) => <li key={n} className="flex items-center gap-2 text-sm"><FileText className="size-4 text-primary" aria-hidden />{n}
              {!readOnly && <Button variant="ghost" size="icon" aria-label={`Remove ${n}`} onClick={() => setFiles((x) => x.filter((y) => y !== n))}><Trash2 /></Button>}</li>)}</ul>
          </fieldset>)}

          {step === 3 && <Field label="Other information">{(a) => <textarea {...a} rows={6} {...form.register("remarks")} disabled={readOnly} className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm" />}</Field>}

          {step === 4 && (<div className="space-y-3 text-sm">
            <p className="font-semibold">Check before submitting</p>
            <dl className="grid gap-2 sm:grid-cols-2">
              {([["Title", form.watch("title")], ["Agency", form.watch("agency")], ["Type", form.watch("type")], ["Applied amount", formatMoney(Number(form.watch("appliedAmount")) || 0)],
                ["Investigators", String(invs.fields.length)], ["Enclosures", String(files.length)]] as const).map(([k, v]) => (
                <div key={k} className="rounded-xl border p-3"><dt className="text-xs text-muted-foreground">{k}</dt><dd className="font-medium">{v || "—"}</dd></div>))}
            </dl>
            {!readOnly && <div className="flex flex-wrap justify-end gap-3 pt-2">
              <Button variant="secondary" loading={save.isPending} onClick={() => submitWith("draft")}>Save draft</Button>
              <Button loading={save.isPending} onClick={() => submitWith("submitted")}>Submit grant</Button></div>}
          </div>)}

          <div className="flex justify-between border-t pt-4">
            <Button variant="secondary" disabled={step === 0} onClick={() => setStep((s) => s - 1)}>Back</Button>
            <div className="flex gap-3">
              {!readOnly && step < 4 && <Button variant="secondary" loading={save.isPending} onClick={() => submitWith("draft")}>Save draft</Button>}
              {step < 4 && <Button onClick={next}>Next</Button>}
            </div>
          </div>
        </form></CardContent></Card>)}
    </div>
  );
}
