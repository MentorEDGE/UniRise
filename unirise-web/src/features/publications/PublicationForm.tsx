import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { AlertTriangle, DownloadCloud, FileText, Flag, GitMerge, LockOpen, Plus, RefreshCw, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { HttpError } from "@/lib/http";
import { useAuth, can } from "@/app/auth";
import { DOI_RE, cn } from "@/lib/utils";
import type { AuthorKind, EntryStatus, PubAuthor, Publication, PublicationType, ReviewAction } from "@/lib/types";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";
import { SourceChip, StatusBadge, VerificationBadge } from "@/components/ui/badge";
import { ReviewBar } from "@/components/ui/review-bar";
import { ErrorBanner, Skeleton } from "@/components/ui/feedback";
import { useToast } from "@/components/ui/toast";
import { DisputeDialog } from "./DisputeDialog";

const TYPES: { value: PublicationType; label: string; venueLabel: string }[] = [
  { value: "journal-article", label: "Journal article", venueLabel: "Journal name" },
  { value: "conference-paper", label: "Conference paper", venueLabel: "Conference name" },
  { value: "book-chapter", label: "Book chapter", venueLabel: "Book title" },
  { value: "book", label: "Book", venueLabel: "Publisher" },
  { value: "technical-report", label: "Technical report", venueLabel: "Institution or series" },
  { value: "preprint", label: "Preprint", venueLabel: "Repository" },
  { value: "patent", label: "Patent", venueLabel: "Patent office" },
];
const CATEGORIES: Partial<Record<PublicationType, string[]>> = {
  "journal-article": ["Research Article", "Review Article", "Short Communication", "Case Report", "Letter or Editorial"],
  "conference-paper": ["Full Paper", "Abstract", "Poster"],
};
const KINDS: { value: AuthorKind; label: string }[] = [
  { value: "internal-faculty", label: "Faculty (this institution)" },
  { value: "internal-student", label: "Student (this institution)" },
  { value: "ex-faculty", label: "Ex-faculty" },
  { value: "ex-student", label: "Ex-student" },
  { value: "external", label: "Outside this institution" },
];
const CONTINENTS = ["Asia", "Europe", "North America", "South America", "Africa", "Oceania"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MAX_PDF = 10 * 1024 * 1024;

/** Accept a bare DOI or a doi.org link. */
const normaliseDoi = (v: string) => v.trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, "");

const authorSchema = z.object({
  kind: z.enum(["internal-faculty", "internal-student", "external", "ex-faculty", "ex-student"]),
  researcherId: z.number().optional(),
  name: z.string().trim().min(1, "Name is required"),
  institution: z.string().trim().min(1, "Institution is required"),
  department: z.string().trim().optional(),
  email: z.string().trim().email("Enter a valid email").or(z.literal("")).optional(),
  endDate: z.string().optional(),
  continent: z.string().optional(),
}).superRefine((a, ctx) => {
  if ((a.kind === "internal-faculty" || a.kind === "internal-student") && !a.researcherId) ctx.addIssue({ code: "custom", path: ["researcherId"], message: "Choose the person" });
  if ((a.kind === "ex-faculty" || a.kind === "ex-student") && !a.endDate) ctx.addIssue({ code: "custom", path: ["endDate"], message: "Enter the termination or course-completion date" });
});

const isHttps = (v: string) => { try { return new URL(v).protocol === "https:"; } catch { return false; } };
const OA_OPTIONS = [{ value: "gold", label: "Gold (open in the journal)" }, { value: "green", label: "Green (open in a repository)" }, { value: "hybrid", label: "Hybrid" }, { value: "closed", label: "Closed" }] as const;
const MANDATE_OPTIONS = [{ value: "compliant", label: "Compliant" }, { value: "non-compliant", label: "Not compliant" }, { value: "not-applicable", label: "Not applicable" }] as const;

const schema = z.object({
  type: z.enum(["journal-article", "conference-paper", "book-chapter", "book", "technical-report", "preprint", "patent"]),
  category: z.string().optional(),
  doi: z.string().trim().refine((v) => v === "" || DOI_RE.test(normaliseDoi(v)), "Use a DOI such as 10.1234/abcd or a doi.org link").optional(),
  title: z.string().trim().min(1, "Title is required").max(500),
  venue: z.string().trim().min(1, "This field is required"),
  issn: z.string().trim().refine((v) => v === "" || /^\d{7}[\dXx]$/.test(v), "Enter 8 characters without a hyphen or space").optional(),
  month: z.coerce.number().int().min(1).max(12),
  year: z.coerce.number().int().min(1900, "Enter a valid year").max(new Date().getFullYear() + 1, "Year is in the future"),
  projectRef: z.boolean(),
  projectDetails: z.string().trim().optional(),
  oaStatus: z.enum(["", "gold", "green", "hybrid", "closed"]),
  funderMandate: z.enum(["", "compliant", "non-compliant", "not-applicable"]),
  repositoryUrl: z.string().trim().refine((v) => v === "" || isHttps(v), "Use a full https:// link").optional(),
  authors: z.array(authorSchema).min(1, "Add at least one author"),
}).superRefine((v, ctx) => {
  if (v.projectRef && !v.projectDetails) ctx.addIssue({ code: "custom", path: ["projectDetails"], message: "Name the project" });
});
type Values = z.infer<typeof schema>;

const blankAuthor = (): PubAuthor => ({ kind: "internal-faculty", name: "", institution: "", department: "", email: "" });
const editable = (p?: Publication) => !p || !p.entryStatus || ["draft", "rework", "revision_required"].includes(p.entryStatus);

export default function PublicationForm() {
  const { id } = useParams();
  const editing = !!id && id !== "new";
  const nav = useNavigate();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();
  const [mode, setMode] = useState<"doi" | "manual">("doi");
  const [doiInput, setDoiInput] = useState("");
  const [doiError, setDoiError] = useState<{ msg: string; existing?: number } | null>(null);
  const [pdf, setPdf] = useState<{ name: string } | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [disputing, setDisputing] = useState(false);
  /** The version the form was loaded at; sent with every save so a concurrent edit is detected, not overwritten. */
  const [loadedVersion, setLoadedVersion] = useState<number | undefined>();
  const [versionConflict, setVersionConflict] = useState(false);
  const loaded = useRef(false);

  const existing = useQuery({ queryKey: ["publication", id], queryFn: () => api.publication(Number(id)), enabled: editing });
  const researchers = useQuery({ queryKey: ["directory"], queryFn: api.directory });
  const depts = useQuery({ queryKey: ["departments"], queryFn: api.departments });

  const form = useForm<Values>({
    resolver: zodResolver(schema) as never,
    defaultValues: { type: "journal-article", category: "", doi: "", title: "", venue: "", issn: "", month: new Date().getMonth() + 1, year: new Date().getFullYear(), projectRef: false, projectDetails: "", oaStatus: "", funderMandate: "", repositoryUrl: "", authors: [blankAuthor()] },
  });
  const authors = useFieldArray({ control: form.control, name: "authors" });
  const type = form.watch("type");
  const projectRef = form.watch("projectRef");
  const deptName = (id: number) => depts.data?.find((d) => d.id === id)?.name ?? "";

  const apply = (p: Publication) => {
    const fromIds = p.authorIds.map((rid): PubAuthor => {
      const r = researchers.data?.find((x) => x.id === rid);
      return { kind: r?.kind === "scholar" ? "internal-student" : "internal-faculty", researcherId: rid, name: r?.name ?? `#${rid}`, institution: "Demo University", department: r ? deptName(r.departmentId) : "", email: "" };
    });
    form.reset({
      type: p.type, category: p.category ?? "", doi: p.doi ?? "", title: p.title, venue: p.venue, issn: p.issn ?? "", month: p.month ?? 1, year: p.year,
      projectRef: !!p.projectRef, projectDetails: p.projectDetails ?? "", oaStatus: p.oaStatus ?? "", funderMandate: p.funderMandate ?? "", repositoryUrl: p.repositoryUrl ?? "",
      authors: (p.authors?.length ? p.authors : fromIds).length ? (p.authors?.length ? p.authors : fromIds) : [blankAuthor()],
    });
    setPdf(p.pdfName ? { name: p.pdfName } : null);
    setLoadedVersion(p.version);
    setVersionConflict(false);
  };
  // Fill the form once. Later refetches must never overwrite what the user is typing; "Reload latest" does it on purpose.
  useEffect(() => {
    const p = existing.data;
    if (!p || loaded.current || !researchers.data || !depts.data) return;
    loaded.current = true;
    apply(p);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existing.data, researchers.data, depts.data]);

  const reloadLatest = async () => {
    const r = await existing.refetch();
    if (r.data) apply(r.data);
  };
  const changedElsewhere = versionConflict || (existing.data?.version !== undefined && loadedVersion !== undefined && existing.data.version !== loadedVersion);

  const myDisputes = useQuery({ queryKey: ["disputes"], queryFn: api.disputes, enabled: editing && !!user?.researcherId });
  const iAmAuthor = !!user?.researcherId && !!existing.data?.authorIds.includes(user.researcherId);
  const myDispute = myDisputes.data?.filter((d) => d.publicationId === Number(id) && d.researcherId === user?.researcherId).sort((a, b) => b.id - a.id)[0];

  const importDoi = useMutation({
    mutationFn: () => api.importDoi(normaliseDoi(doiInput)),
    onSuccess: (p) => {
      qc.invalidateQueries({ queryKey: ["publications"] });
      toast({ tone: "ok", message: "Fetched from Crossref. Link the authors next." });
      nav(`/publications/${p.id}`);
    },
    onError: (e) => {
      if (e instanceof HttpError && e.status === 409) setDoiError({ msg: "Already in your records.", existing: (e as unknown as { existingId?: number }).existingId });
      else if (e instanceof HttpError && e.status === 502) setDoiError({ msg: "Couldn't reach Crossref, try again." });
      else if (e instanceof HttpError && e.status === 400) setDoiError({ msg: "That doesn't look like a valid DOI." });
      else setDoiError({ msg: "Something went wrong. Please try again." });
    },
  });

  const save = useMutation({
    mutationFn: ({ v, status }: { v: Values; status: EntryStatus }) =>
      api.savePublication({
        title: v.title, type: v.type, venue: v.venue, year: v.year, month: v.month, category: v.category || undefined,
        doi: v.doi ? normaliseDoi(v.doi) : undefined, issn: v.issn || undefined, projectRef: v.projectRef, projectDetails: v.projectRef ? v.projectDetails : undefined,
        authors: v.authors, authorIds: v.authors.flatMap((a) => (a.researcherId ? [a.researcherId] : [])),
        studentPublication: v.authors.some((a) => a.kind === "internal-student" || a.kind === "ex-student"),
        pdfName: pdf?.name, entryStatus: status, id: editing ? Number(id) : undefined,
        oaStatus: v.oaStatus || undefined, funderMandate: v.funderMandate || undefined, repositoryUrl: v.repositoryUrl || undefined,
        expectedVersion: editing ? loadedVersion : undefined,
      }),
    onSuccess: (_p, { status }) => {
      qc.invalidateQueries({ queryKey: ["publications"] });
      qc.invalidateQueries({ queryKey: ["publication", id] });
      toast({ tone: "ok", message: status === "submitted" ? "Submitted for review." : "Draft saved." });
      nav("/publications");
    },
    onError: (e) => {
      if (e instanceof HttpError && e.status === 409 && (e as unknown as { reason?: string }).reason === "version") setVersionConflict(true); // keep the typed values on screen
      else if (e instanceof HttpError && e.status === 409 && (e as unknown as { reason?: string }).reason === "merged") toast({ tone: "error", message: "This record was merged into another one and can no longer be edited." });
      else if (e instanceof HttpError && e.status === 409) form.setError("doi", { message: "A publication with this DOI already exists." });
      else toast({ tone: "error", message: "Couldn't save. Try again." });
    },
  });

  const review = useMutation({
    mutationFn: ({ action, comment }: { action: ReviewAction; comment: string }) => api.reviewPublication(Number(id), action, comment || undefined),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["publications"] }); qc.invalidateQueries({ queryKey: ["publication", id] }); qc.invalidateQueries({ queryKey: ["summary"] }); toast({ tone: "ok", message: "Review recorded." }); nav("/publications"); },
    onError: () => toast({ tone: "error", message: "Couldn't record the review. Try again." }),
  });

  const pickPdf = (f?: File) => {
    setPdfError(null);
    if (!f) return;
    if (f.type !== "application/pdf" && !f.name.toLowerCase().endsWith(".pdf")) return setPdfError("Upload a PDF file.");
    if (f.size > MAX_PDF) return setPdfError("The file is larger than 10 MB. Contact the research office.");
    setPdf({ name: f.name }); // shortcut: mock stores the file name only; the real API takes a multipart upload
  };

  const submitWith = (status: EntryStatus) => form.handleSubmit((v) => {
    if (status === "submitted" && v.type !== "book" && !pdf) return setPdfError("Upload the PDF before submitting (optional only for books).");
    save.mutate({ v, status });
  })();

  if (!can.edit(user?.role) && !editing) return <ErrorBanner error={new HttpError(403)} />;
  if (editing && existing.isError) return <ErrorBanner error={existing.error} onRetry={() => existing.refetch()} />;
  const merged = existing.data?.mergedInto;
  const readOnly = !can.edit(user?.role) || !editable(existing.data) || merged !== undefined;
  const showForm = editing || mode === "manual";
  const errors = form.formState.errors;
  const meta = TYPES.find((t) => t.value === type)!;
  const people = (kind: AuthorKind) => researchers.data?.filter((r) => (kind === "internal-student" ? r.kind === "scholar" : r.kind !== "scholar")) ?? [];

  return (
    <div className="max-w-4xl">
      <PageHeader eyebrow="Publications" title={editing ? "Edit publication" : "Add publication"}
        description={editing ? undefined : "Importing by DOI is the fastest way. Enter details manually when there is no DOI."} />

      {editing && existing.data && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <VerificationBadge state={existing.data.state} /><SourceChip source={existing.data.source} />
          {existing.data.entryStatus && <StatusBadge status={existing.data.entryStatus} />}
          {existing.data.reviewComment && <span className="text-sm text-muted-foreground">Reviewer: {existing.data.reviewComment}</span>}
        </div>
      )}

      {merged !== undefined && (
        <div role="status" className="mb-4 flex items-center gap-3 rounded-xl border bg-secondary/60 p-4 text-sm">
          <GitMerge className="size-5 shrink-0 text-primary" aria-hidden />
          <span>This record was merged into <Link className="font-semibold text-primary hover:underline" to={`/publications/${merged}`}>record #{merged}</Link> and no longer counts anywhere.</span>
        </div>
      )}

      {changedElsewhere && !readOnly && (
        <div role="alert" className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm">
          <AlertTriangle className="size-5 shrink-0 text-warning" aria-hidden />
          <span className="flex-1"><strong>This record changed since you opened it.</strong> Your changes are still in the form below and have not been saved. Reload the latest version, then re-apply what you need.</span>
          <Button size="sm" variant="secondary" onClick={reloadLatest}><RefreshCw /> Reload latest</Button>
        </div>
      )}

      {editing && iAmAuthor && merged === undefined && (
        <div className="mb-4 flex flex-wrap items-center gap-3 text-sm">
          {myDispute ? (
            <span className="inline-flex items-center gap-2">
              <Flag className="size-4 text-primary" aria-hidden />
              Your authorship dispute: <strong>{myDispute.status === "open" ? "Open, waiting for a reviewer" : myDispute.status === "upheld" ? "Upheld" : "Dismissed"}</strong>
              {myDispute.resolution && <span className="text-muted-foreground">Reviewer: {myDispute.resolution}</span>}
            </span>
          ) : null}
          {myDispute?.status !== "open" && <Button size="sm" variant="secondary" onClick={() => setDisputing(true)}><Flag /> Dispute my authorship</Button>}
        </div>
      )}

      {editing && existing.data?.entryStatus === "submitted" && can.review(user?.role) && (
        <ReviewBar loading={review.isPending} onReview={(action, comment) => review.mutate({ action, comment })} />
      )}

      {!editing && (
        <div className="mb-6 inline-flex rounded-full border bg-card p-1" role="tablist" aria-label="How to add">
          {(["doi", "manual"] as const).map((m) => (
            <button key={m} role="tab" aria-selected={mode === m} onClick={() => setMode(m)}
              className={cn("rounded-full px-5 py-2 text-sm font-semibold transition-colors", mode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
              {m === "doi" ? "Import by DOI" : "Enter manually"}
            </button>
          ))}
        </div>
      )}

      {!editing && mode === "doi" && (
        <Card><CardContent>
          <form onSubmit={(e) => { e.preventDefault(); setDoiError(null); if (!DOI_RE.test(normaliseDoi(doiInput))) return setDoiError({ msg: "Use the format 10.1234/abcd" }); importDoi.mutate(); }} className="space-y-4">
            <Field label="DOI" error={doiError?.msg} hint="Example: 10.1038/s41467-020-12345-6, or a doi.org link">
              {(a) => <Input {...a} value={doiInput} onChange={(e) => setDoiInput(e.target.value)} placeholder="10.1234/abcd" autoFocus />}
            </Field>
            {doiError?.existing && <Link className="text-sm font-semibold text-primary hover:underline" to={`/publications/${doiError.existing}`}>Open the existing record</Link>}
            <Button type="submit" loading={importDoi.isPending}><DownloadCloud /> Fetch details</Button>
          </form>
        </CardContent></Card>
      )}

      {showForm && (existing.isLoading && editing ? <Skeleton className="h-96 w-full" /> : (
        <Card><CardContent>
          <form onSubmit={(e) => e.preventDefault()} className="space-y-6" noValidate>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Entry type">
                {(a) => <Select {...a} {...form.register("type", { onChange: () => form.setValue("category", "") })} disabled={readOnly}>{TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</Select>}
              </Field>
              {CATEGORIES[type] && (
                <Field label="Category">
                  {(a) => <Select {...a} {...form.register("category")} disabled={readOnly}><option value="">Select…</option>{CATEGORIES[type]!.map((c) => <option key={c}>{c}</option>)}</Select>}
                </Field>
              )}
            </div>

            <Field label="Title" error={errors.title?.message}>{(a) => <Input {...a} {...form.register("title")} disabled={readOnly} />}</Field>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="DOI or web link" error={errors.doi?.message}>{(a) => <Input {...a} {...form.register("doi")} placeholder="10.1234/abcd" disabled={readOnly} />}</Field>
              <Field label={meta.venueLabel} error={errors.venue?.message}>{(a) => <Input {...a} {...form.register("venue")} disabled={readOnly} />}</Field>
            </div>
            <div className="grid gap-5 sm:grid-cols-3">
              <Field label="Publish month">{(a) => <Select {...a} {...form.register("month")} disabled={readOnly}>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</Select>}</Field>
              <Field label="Publish year" error={errors.year?.message}>{(a) => <Input {...a} type="number" {...form.register("year")} disabled={readOnly} />}</Field>
              {type === "journal-article" && (
                <Field label="ISSN" error={errors.issn?.message} hint="Without a hyphen or space">{(a) => <Input {...a} {...form.register("issn")} placeholder="20452322" disabled={readOnly} />}</Field>
              )}
            </div>

            <fieldset className="space-y-3">
              <legend className="flex items-center gap-2 text-sm font-semibold"><LockOpen className="size-4 text-primary" aria-hidden />Open access</legend>
              <div className="grid gap-5 sm:grid-cols-2">
                <Field label="Open-access status">
                  {(a) => <Select {...a} {...form.register("oaStatus")} disabled={readOnly}><option value="">Not recorded</option>{OA_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select>}
                </Field>
                <Field label="Funder mandate">
                  {(a) => <Select {...a} {...form.register("funderMandate")} disabled={readOnly}><option value="">Not recorded</option>{MANDATE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select>}
                </Field>
              </div>
              <Field label="Repository link" error={errors.repositoryUrl?.message} hint="Where the open copy is kept. https links only.">
                {(a) => <Input {...a} type="url" inputMode="url" {...form.register("repositoryUrl")} placeholder="https://repository.example.edu/handle/123" disabled={readOnly} />}
              </Field>
            </fieldset>

            <div className="grid gap-5 sm:grid-cols-2">
              <label className="flex items-center gap-3 text-sm font-medium">
                <input type="checkbox" className="size-4 accent-[hsl(var(--primary))]" {...form.register("projectRef")} disabled={readOnly} />
                Linked to an ongoing or completed project
              </label>
              {projectRef && <Field label="Project details" error={errors.projectDetails?.message}>{(a) => <Input {...a} {...form.register("projectDetails")} disabled={readOnly} />}</Field>}
            </div>

            <fieldset className="space-y-3">
              <legend className="text-sm font-semibold">Authors</legend>
              <p className="text-xs text-muted-foreground">Enter every author, including those from other institutions. Enter relieved faculty and students who completed their course under ex-faculty and ex-student, with the termination or completion date.</p>
              {errors.authors?.message && <p className="text-xs text-destructive">{errors.authors.message}</p>}
              {authors.fields.map((f, i) => {
                const kind = form.watch(`authors.${i}.kind`);
                const internal = kind === "internal-faculty" || kind === "internal-student";
                const ex = kind === "ex-faculty" || kind === "ex-student";
                const e = errors.authors?.[i];
                return (
                  <div key={f.id} className="grid gap-3 rounded-xl border p-4 sm:grid-cols-2">
                    <Field label="Author type">
                      {(a) => <Select {...a} {...form.register(`authors.${i}.kind`, { onChange: () => { form.setValue(`authors.${i}.researcherId`, undefined); form.setValue(`authors.${i}.name`, ""); form.setValue(`authors.${i}.institution`, ""); } })} disabled={readOnly}>
                        {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}</Select>}
                    </Field>
                    {internal ? (
                      <Field label="Person" error={e?.researcherId?.message}>
                        {(a) => <Select {...a} disabled={readOnly} value={form.watch(`authors.${i}.researcherId`) ?? ""} onChange={(ev) => {
                          const r = researchers.data?.find((x) => x.id === Number(ev.target.value));
                          form.setValue(`authors.${i}.researcherId`, r?.id, { shouldValidate: true });
                          form.setValue(`authors.${i}.name`, r?.name ?? "");
                          form.setValue(`authors.${i}.institution`, r ? "Demo University" : "");
                          form.setValue(`authors.${i}.department`, r ? deptName(r.departmentId) : "");
                          form.setValue(`authors.${i}.email`, "");
                        }}><option value="">Select…</option>{people(kind).map((r) => <option key={r.id} value={r.id}>{r.name}{r.employeeId ? ` (${r.employeeId})` : r.rollNo ? ` (${r.rollNo})` : ""}</option>)}</Select>}
                      </Field>
                    ) : (
                      <Field label="Author name" error={e?.name?.message}>{(a) => <Input {...a} {...form.register(`authors.${i}.name`)} disabled={readOnly} />}</Field>
                    )}
                    {!internal && <Field label="Institution" error={e?.institution?.message}>{(a) => <Input {...a} {...form.register(`authors.${i}.institution`)} disabled={readOnly} />}</Field>}
                    {!internal && <Field label="Department or course">{(a) => <Input {...a} {...form.register(`authors.${i}.department`)} disabled={readOnly} />}</Field>}
                    {!internal && <Field label="Email" error={e?.email?.message}>{(a) => <Input {...a} type="email" {...form.register(`authors.${i}.email`)} disabled={readOnly} />}</Field>}
                    {!internal && <Field label="Continent">{(a) => <Select {...a} {...form.register(`authors.${i}.continent`)} disabled={readOnly}><option value="">Select…</option>{CONTINENTS.map((c) => <option key={c}>{c}</option>)}</Select>}</Field>}
                    {ex && <Field label="Termination or course-completion date" error={e?.endDate?.message}>{(a) => <Input {...a} type="date" {...form.register(`authors.${i}.endDate`)} disabled={readOnly} />}</Field>}
                    {!readOnly && authors.fields.length > 1 && (
                      <div className="flex items-end"><Button variant="ghost" onClick={() => authors.remove(i)} aria-label={`Remove author ${i + 1}`}><Trash2 /> Remove</Button></div>
                    )}
                  </div>
                );
              })}
              {!readOnly && <Button variant="secondary" onClick={() => authors.append(blankAuthor())}><Plus /> Add author</Button>}
            </fieldset>

            <fieldset className="space-y-2">
              <legend className="text-sm font-semibold">PDF</legend>
              <div className="flex flex-wrap items-center gap-3">
                {!readOnly && <input type="file" accept="application/pdf,.pdf" aria-label="Choose PDF" onChange={(e) => pickPdf(e.target.files?.[0])} className="text-sm" />}
                {pdf && <span className="inline-flex items-center gap-2 text-sm"><FileText className="size-4 text-primary" aria-hidden />{pdf.name}</span>}
              </div>
              <p className="text-xs text-muted-foreground">PDF only, up to 10 MB. Optional for books.</p>
              {pdfError && <p role="alert" className="text-xs text-destructive">{pdfError}</p>}
            </fieldset>

            {!readOnly && (
              <div className="flex flex-wrap justify-end gap-3 pt-2">
                <Button variant="secondary" onClick={() => nav("/publications")}>Cancel</Button>
                <Button variant="secondary" loading={save.isPending} onClick={() => submitWith("draft")}>Save draft</Button>
                <Button loading={save.isPending} onClick={() => submitWith("submitted")}>Submit for review</Button>
              </div>
            )}
          </form>
        </CardContent></Card>
      ))}

      {editing && existing.data && <DisputeDialog open={disputing} onClose={() => setDisputing(false)} publicationId={existing.data.id} title={existing.data.title} />}
    </div>
  );
}
