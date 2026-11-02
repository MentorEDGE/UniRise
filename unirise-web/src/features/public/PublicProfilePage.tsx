import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ExternalLink, Search } from "lucide-react";
import { api } from "@/lib/api";
import { HttpError } from "@/lib/http";
import { useListParams } from "@/lib/useListParams";
import { doiUrl, initials, orcidUrl } from "@/lib/utils";
import type { PublicProfile } from "@/lib/types";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/form";
import { EmptyState, ErrorBanner, Skeleton } from "@/components/ui/feedback";

/**
 * Public showcase (PRD R22): no app shell, no sign-in. Only the scholarly record of people who agreed to appear.
 * A real deployment would render this on the server so search engines can index it.
 */
export default function PublicProfilePage() {
  const { id } = useParams();
  return (
    <div className="min-h-screen">
      <header className="flex h-16 items-center justify-between border-b px-4 md:px-10">
        <Link to="/public" className="text-lg font-semibold tracking-tight">Research <span className="text-primary">profiles</span></Link>
        <ThemeToggle />
      </header>
      <main className="mx-auto max-w-4xl px-4 py-10">
        {id ? <Profile id={Number(id)} /> : <Directory />}
        <p className="mt-12 rounded-xl border bg-secondary/60 px-4 py-3 text-xs text-muted-foreground">
          Sample pages for a demonstration. A real deployment would render this site on the server so search engines can index it. It shows only the published scholarly record of people who agreed to appear.
        </p>
      </main>
    </div>
  );
}

function notAvailable(error: unknown) {
  return error instanceof HttpError && error.status === 404;
}

function Directory() {
  const { get, set } = useListParams({});
  const q = get("q");
  const list = useQuery({ queryKey: ["public-profiles", q], queryFn: () => api.publicProfiles({ q }), retry: false });
  const institution = list.data?.[0]?.institution;
  return (
    <div>
      <p className="eyebrow mb-2">{institution ?? "Public site"}</p>
      <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">Researchers and their published work</h1>
      <Card className="my-6 p-4"><div className="relative"><Search className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground" aria-hidden />
        <Input aria-label="Search researchers" className="pl-9" placeholder="Search by name, title or department" defaultValue={q} onChange={(e) => set({ q: e.target.value })} /></div></Card>
      {list.isLoading ? <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-20" />)}</div>
        : list.isError ? (notAvailable(list.error)
          ? <Card><EmptyState title="This site isn't available" description="This institution hasn't turned on its public profile site." /></Card>
          : <ErrorBanner error={list.error} onRetry={() => list.refetch()} />)
        : list.data?.length === 0 ? <Card><EmptyState title="No researchers found" description={q ? "Try a different name or department." : "No one has chosen to appear on this site yet."} /></Card>
        : <ul className="grid gap-3 sm:grid-cols-2">{list.data?.map((p) => (
          <li key={p.researcher.id}>
            <Link to={`/public/${p.researcher.id}`} className="surface-card surface-card-hover flex items-center gap-4 p-4">
              <span className="grid size-12 shrink-0 place-items-center rounded-full bg-secondary text-sm font-semibold text-primary" aria-hidden>{initials(p.researcher.name)}</span>
              <span><span className="block font-semibold">{p.researcher.name}</span><span className="block text-xs text-muted-foreground">{p.researcher.title} · {p.department}</span>
                <span className="block text-xs text-muted-foreground">{p.publications.length} published work{p.publications.length === 1 ? "" : "s"}</span></span>
            </Link>
          </li>))}</ul>}
    </div>
  );
}

function Profile({ id }: { id: number }) {
  const q = useQuery<PublicProfile>({ queryKey: ["public-profile", id], queryFn: () => api.publicProfile(id), retry: false });
  const back = <Link to="/public" className="mb-6 inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline"><ArrowLeft className="size-4" aria-hidden />All researchers</Link>;
  if (q.isLoading) return <div>{back}<Skeleton className="mb-4 h-24" /><Skeleton className="h-48" /></div>;
  if (q.isError || !q.data) {
    return <div>{back}{notAvailable(q.error)
      ? <Card><EmptyState title="Profile not available" description="This profile doesn't exist or isn't public." /></Card>
      : <ErrorBanner error={q.error} onRetry={() => q.refetch()} />}</div>;
  }
  const p = q.data;
  return (
    <div>
      {back}
      <div className="flex items-center gap-4">
        <span className="grid size-16 shrink-0 place-items-center rounded-full bg-secondary text-lg font-semibold text-primary" aria-hidden>{initials(p.researcher.name)}</span>
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">{p.researcher.name}</h1>
          <p className="text-sm text-muted-foreground">{p.researcher.title} · {p.department} · {p.institution}</p>
          {p.researcher.orcid && <a href={orcidUrl(p.researcher.orcid)} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">ORCID {p.researcher.orcid}<ExternalLink className="size-3.5" aria-hidden /><span className="sr-only"> (opens in a new tab)</span></a>}
        </div>
      </div>
      <h2 className="mb-3 mt-10 text-xl font-semibold tracking-tight">Published work <span className="text-sm font-normal text-muted-foreground">({p.publications.length})</span></h2>
      <Card>
        {p.publications.length === 0 ? <EmptyState title="No published work to show" description="Verified publications appear here." />
          : <ul className="divide-y">{p.publications.map((x) => (
            <li key={x.id} className="space-y-1 p-4">
              <p className="font-medium">{x.title}</p>
              <p className="text-xs text-muted-foreground">{x.venue} · {x.year} · {x.type.replace("-", " ")}</p>
              {x.doi && <a href={doiUrl(x.doi)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">DOI {x.doi}<ExternalLink className="size-3" aria-hidden /><span className="sr-only"> (opens in a new tab)</span></a>}
            </li>))}</ul>}
      </Card>
    </div>
  );
}
