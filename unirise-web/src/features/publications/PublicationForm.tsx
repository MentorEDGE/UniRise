import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { DownloadCloud } from "lucide-react";
import { api } from "@/lib/api";
import { HttpError } from "@/lib/http";
import { useAuth, can } from "@/app/auth";
import { DOI_RE } from "@/lib/utils";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";
import { VerificationBadge, SourceChip } from "@/components/ui/badge";
import { ErrorBanner, Skeleton } from "@/components/ui/feedback";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

const schema = z.object({
  title: z.string().trim().min(1, "Title is required").max(500),
  doi: z.string().trim().refine((v) => v === "" || DOI_RE.test(v), "Use the format 10.1234/abcd").optional(),
  venue: z.string().trim().min(1, "Venue is required"),
  type: z.enum(["journal-article", "conference-paper", "book-chapter", "book", "preprint", "patent"]),
  year: z.coerce.number().int().min(1900, "Enter a valid year").max(new Date().getFullYear() + 1, "Year is in the future"),
  authorIds: z.array(z.number()),
});
type Values = z.infer<typeof schema>;

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

  const existing = useQuery({ queryKey: ["publication", id], queryFn: () => api.publication(Number(id)), enabled: editing });
  const researchers = useQuery({ queryKey: ["researchers", "all"], queryFn: () => api.researchers() });
  const [authorQuery, setAuthorQuery] = useState("");

  const form = useForm<Values>({
    resolver: zodResolver(schema) as never,
    defaultValues: { title: "", doi: "", venue: "", type: "journal-article", year: new Date().getFullYear(), authorIds: [] },
  });
  useEffect(() => { if (existing.data) form.reset({ ...existing.data, doi: existing.data.doi ?? "" }); }, [existing.data, form]);

  const importDoi = useMutation({
    mutationFn: () => api.importDoi(doiInput.trim()),
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
    mutationFn: (v: Values) => api.savePublication({ ...v, doi: v.doi || undefined, id: editing ? Number(id) : undefined }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["publications"] });
      qc.invalidateQueries({ queryKey: ["publication", id] });
      toast({ tone: "ok", message: "Publication saved." });
      nav("/publications");
    },
    onError: (e) => {
      if (e instanceof HttpError && e.status === 409) form.setError("doi", { message: "A publication with this DOI already exists." });
      else toast({ tone: "error", message: "Couldn't save. Try again." });
    },
  });

  if (!can.edit(user?.role) && !editing) return <ErrorBanner error={new HttpError(403)} />;
  if (editing && existing.isError) return <ErrorBanner error={existing.error} onRetry={() => existing.refetch()} />;
  const readOnly = !can.edit(user?.role);

  const showForm = editing || mode === "manual";
  const errors = form.formState.errors;
  const filtered = researchers.data?.filter((r) => r.name.toLowerCase().includes(authorQuery.toLowerCase())) ?? [];

  return (
    <div className="max-w-3xl">
      <PageHeader eyebrow="Publications" title={editing ? "Edit publication" : "Add publication"}
        description={editing ? undefined : "Importing by DOI is the fastest way. Enter details manually only when there is no DOI."} />

      {editing && existing.data && (
        <div className="mb-4 flex flex-wrap gap-2"><VerificationBadge state={existing.data.state} /><SourceChip source={existing.data.source} /></div>
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
          <form onSubmit={(e) => { e.preventDefault(); setDoiError(null); if (!DOI_RE.test(doiInput.trim())) return setDoiError({ msg: "Use the format 10.1234/abcd" }); importDoi.mutate(); }} className="space-y-4">
            <Field label="DOI" error={doiError?.msg} hint="Example: 10.1038/s41467-020-12345-6">
              {(a) => <Input {...a} value={doiInput} onChange={(e) => setDoiInput(e.target.value)} placeholder="10.1234/abcd" autoFocus />}
            </Field>
            {doiError?.existing && <Link className="text-sm font-semibold text-primary hover:underline" to={`/publications/${doiError.existing}`}>Open the existing record</Link>}
            <Button type="submit" loading={importDoi.isPending}><DownloadCloud /> Fetch details</Button>
          </form>
        </CardContent></Card>
      )}

      {showForm && (existing.isLoading && editing ? <Skeleton className="h-96 w-full" /> : (
        <Card><CardContent>
          <form onSubmit={form.handleSubmit((v) => save.mutate(v))} className="space-y-5" noValidate>
            <Field label="Title" error={errors.title?.message}>{(a) => <Input {...a} {...form.register("title")} disabled={readOnly} />}</Field>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="DOI" error={errors.doi?.message}>{(a) => <Input {...a} {...form.register("doi")} placeholder="10.1234/abcd" disabled={readOnly} />}</Field>
              <Field label="Year" error={errors.year?.message}>{(a) => <Input {...a} type="number" {...form.register("year")} disabled={readOnly} />}</Field>
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Venue" error={errors.venue?.message}>{(a) => <Input {...a} {...form.register("venue")} disabled={readOnly} />}</Field>
              <Field label="Type">
                {(a) => <Select {...a} {...form.register("type")} disabled={readOnly}>
                  {["journal-article", "conference-paper", "book-chapter", "book", "preprint", "patent"].map((t) => <option key={t} value={t}>{t.replace("-", " ")}</option>)}
                </Select>}
              </Field>
            </div>

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Authors</legend>
              <Input aria-label="Search researchers" placeholder="Search researchers" value={authorQuery} onChange={(e) => setAuthorQuery(e.target.value)} />
              <Controller control={form.control} name="authorIds" render={({ field }) => (
                <ul className="max-h-48 divide-y overflow-auto rounded-xl border">
                  {filtered.map((r) => {
                    const checked = field.value.includes(r.id);
                    return (
                      <li key={r.id}>
                        <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-secondary/50">
                          <input type="checkbox" className="size-4 accent-[hsl(var(--primary))]" checked={checked} disabled={readOnly}
                            onChange={() => field.onChange(checked ? field.value.filter((x) => x !== r.id) : [...field.value, r.id])} />
                          {r.name}
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )} />
            </fieldset>

            {!readOnly && (
              <div className="flex justify-end gap-3 pt-2">
                <Button variant="secondary" onClick={() => nav("/publications")}>Cancel</Button>
                <Button type="submit" loading={save.isPending}>Save publication</Button>
              </div>
            )}
          </form>
        </CardContent></Card>
      ))}
    </div>
  );
}
