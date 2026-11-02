import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Link2Off, Mail } from "lucide-react";
import { api } from "@/lib/api";
import { orcidUrl, formatMoney, initials, cn } from "@/lib/utils";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Badge, SourceChip, VerificationBadge } from "@/components/ui/badge";
import { EmptyState, ErrorBanner, Skeleton } from "@/components/ui/feedback";

type Tab = "publications" | "awards";

export default function Profile() {
  const { id } = useParams();
  const rid = Number(id);
  const [tab, setTab] = useState<Tab>("publications");
  const r = useQuery({ queryKey: ["researcher", rid], queryFn: () => api.researcher(rid), retry: false });
  const depts = useQuery({ queryKey: ["departments"], queryFn: api.departments });
  const pubs = useQuery({ queryKey: ["publications", "by-author", rid], queryFn: () => api.publications({ page: 0, size: 200, sort: "year:desc" }) });
  const awards = useQuery({ queryKey: ["awards"], queryFn: api.awards });

  if (r.isError) return <ErrorBanner error={r.error} />;
  if (r.isLoading || !r.data) return <Skeleton className="h-64 w-full" />;
  const p = r.data;
  const myPubs = pubs.data?.items.filter((x) => x.authorIds.includes(rid)) ?? [];
  const myAwards = awards.data?.filter((a) => a.researcherId === rid) ?? [];

  return (
    <div>
      <PageHeader eyebrow="Researcher profile" title={p.name} description={`${p.title} · ${depts.data?.find((d) => d.id === p.departmentId)?.name ?? ""}`} />
      <Card className="mb-6"><CardContent className="flex flex-wrap items-center gap-6">
        <span className="grid size-16 place-items-center rounded-2xl bg-secondary text-xl font-bold text-primary" aria-hidden>{initials(p.name.replace("Dr. ", ""))}</span>
        <div className="space-y-2 text-sm">
          <a className="flex items-center gap-2 hover:text-primary" href={`mailto:${p.email}`}><Mail className="size-4" aria-hidden />{p.email}</a>
          {p.orcid ? (
            <a className="flex items-center gap-2 text-success hover:underline" href={orcidUrl(p.orcid)} target="_blank" rel="noopener noreferrer"><CheckCircle2 className="size-4" aria-hidden />ORCID connected · {p.orcid}</a>
          ) : (<span className="flex items-center gap-2 text-muted-foreground"><Link2Off className="size-4" aria-hidden />ORCID not connected</span>)}
        </div>
        <div className="ml-auto text-right"><div className="text-3xl font-semibold">{p.publicationCount ?? 0}</div><div className="text-sm text-muted-foreground">verified publications</div></div>
      </CardContent></Card>

      <div className="mb-4 inline-flex rounded-full border bg-card p-1" role="tablist">
        {(["publications", "awards"] as Tab[]).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
            className={cn("rounded-full px-5 py-2 text-sm font-semibold capitalize transition-colors", tab === t ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
            {t} <Badge className="ml-1 border-transparent bg-black/10 dark:bg-white/10">{t === "publications" ? myPubs.length : myAwards.length}</Badge>
          </button>))}
      </div>

      <Card className="overflow-hidden">
        {tab === "publications" ? (myPubs.length === 0 ? <EmptyState title="No publications yet" description="Confirmed and suggested publications will appear here." /> : (
          <ul className="divide-y">{myPubs.map((x) => (
            <li key={x.id} className="flex flex-wrap items-center gap-3 px-6 py-4">
              <div className="min-w-0 flex-1"><Link to={`/publications/${x.id}`} className="font-medium hover:text-primary">{x.title}</Link><p className="text-xs text-muted-foreground">{x.venue} · {x.year}</p></div>
              <VerificationBadge state={x.state} /><SourceChip source={x.source} />
            </li>))}</ul>
        )) : (myAwards.length === 0 ? <EmptyState title="No awards" description="Awards where this person is principal investigator appear here." /> : (
          <ul className="divide-y">{myAwards.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 px-6 py-4"><div><p className="font-medium">{a.title}</p><p className="text-xs text-muted-foreground">{a.funder} · {a.startYear}–{a.endYear}</p></div><span className="font-semibold">{formatMoney(a.amount)}</span></li>))}</ul>
        ))}
      </Card>
    </div>
  );
}
