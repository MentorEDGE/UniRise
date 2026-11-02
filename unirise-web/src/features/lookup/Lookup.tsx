import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { api } from "@/lib/api";
import { HttpError } from "@/lib/http";
import { doiUrl, orcidUrl } from "@/lib/utils";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { ErrorBanner } from "@/components/ui/feedback";

const KINDS = [{ v: "employee", l: "Employee ID" }, { v: "orcid", l: "ORCID iD" }, { v: "scopus", l: "Scopus ID" }] as const;

export default function Lookup() {
  const [kind, setKind] = useState<(typeof KINDS)[number]["v"]>("employee");
  const [value, setValue] = useState("");
  const find = useMutation({ mutationFn: () => api.lookup(kind, value) });
  const r = find.data;
  const notFound = find.error instanceof HttpError && find.error.status === 404;

  return (
    <div className="max-w-3xl">
      <PageHeader eyebrow="Directory" title="Find a researcher" description="Look up a profile by employee ID, ORCID iD or Scopus ID." />
      <Card className="mb-6"><CardContent>
        <form onSubmit={(e) => { e.preventDefault(); if (value.trim()) find.mutate(); }} className="space-y-4">
          <fieldset className="flex flex-wrap gap-5"><legend className="sr-only">Search by</legend>
            {KINDS.map((k) => <label key={k.v} className="flex items-center gap-2 text-sm font-medium"><input type="radio" name="kind" className="size-4 accent-[hsl(var(--primary))]" checked={kind === k.v} onChange={() => { setKind(k.v); find.reset(); }} />{k.l}</label>)}
          </fieldset>
          <div className="flex gap-3"><Field label={KINDS.find((k) => k.v === kind)!.l} className="flex-1">{(a) => <Input {...a} value={value} onChange={(e) => setValue(e.target.value)} autoFocus />}</Field>
            <div className="flex items-end"><Button type="submit" loading={find.isPending} disabled={!value.trim()}><Search /> Search</Button></div></div>
        </form>
      </CardContent></Card>

      {notFound && <p role="alert" className="rounded-xl border bg-secondary/60 px-4 py-3 text-sm">No researcher found with that ID, or you don't have access to them.</p>}
      {find.isError && !notFound && <ErrorBanner error={find.error} />}
      {r && (
        <Card><CardContent className="space-y-4">
          <div><h2 className="text-xl font-semibold tracking-tight"><Link className="hover:text-primary" to={`/people/${r.researcher.id}`}>{r.researcher.name}</Link></h2>
            <p className="text-sm text-muted-foreground">{r.researcher.title} · {r.department} · {r.institute}</p></div>
          <dl className="grid gap-3 text-sm sm:grid-cols-3">
            <div><dt className="text-xs text-muted-foreground">Employee ID</dt><dd className="font-medium">{r.researcher.employeeId ?? r.researcher.rollNo ?? "—"}</dd></div>
            <div><dt className="text-xs text-muted-foreground">ORCID iD</dt><dd className="font-medium">{r.researcher.orcid ? <a className="text-primary hover:underline" href={orcidUrl(r.researcher.orcid)} target="_blank" rel="noopener noreferrer">{r.researcher.orcid}</a> : "Not connected"}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Scopus ID</dt><dd className="font-medium">{r.researcher.scopusId ?? "—"}</dd></div>
          </dl>
          <p className="text-sm"><span className="font-semibold">{r.publications.length}</span> verified publications · <span className="font-semibold">{r.grants}</span> grants</p>
          <ul className="divide-y rounded-xl border">{r.publications.slice(0, 8).map((p) => (
            <li key={p.id} className="px-4 py-3 text-sm"><p className="font-medium">{p.title}</p><p className="text-xs text-muted-foreground">{p.venue} · {p.year}{p.doi && <> · <a className="text-primary hover:underline" href={doiUrl(p.doi)} target="_blank" rel="noopener noreferrer">DOI</a></>}</p></li>))}</ul>
        </CardContent></Card>)}
    </div>
  );
}
