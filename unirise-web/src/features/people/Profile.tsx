import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Eye, Link2Off, Lock, Mail } from "lucide-react";
import { api } from "@/lib/api";
import { HttpError } from "@/lib/http";
import { useAuth } from "@/app/auth";
import { orcidUrl, formatMoney, initials, cn } from "@/lib/utils";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Badge, SourceChip, VerificationBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorBanner, Skeleton } from "@/components/ui/feedback";
import { useToast } from "@/components/ui/toast";
import { AppointmentsTab, ClaimsTab, SupervisionTab } from "./ProfileTabs";
import { LeftBadge } from "./LeftBadge";

type Tab = "publications" | "awards" | "claims" | "supervision" | "appointments";
const tabs: Tab[] = ["publications", "awards", "claims", "supervision", "appointments"];

/** Own-profile controls: verify the ORCID iD and consent to the public profile site (R22). */
function OwnSettings({ rid, orcid, verified }: { rid: number; orcid?: string; verified?: boolean }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const consent = useQuery({ queryKey: ["public-consent"], queryFn: api.publicConsent, retry: false });
  const connect = useMutation({
    mutationFn: () => api.connectOrcid(),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["researcher", rid] }); qc.invalidateQueries({ queryKey: ["researchers"] }); toast({ tone: "ok", message: "ORCID connected." }); },
    onError: () => toast({ tone: "error", message: "Couldn't connect ORCID. Make sure your iD is saved on your record, then try again." }),
  });
  const setConsent = useMutation({
    mutationFn: (on: boolean) => api.setPublicConsent(on),
    onSuccess: (r) => {
      qc.setQueryData(["public-consent"], r); qc.invalidateQueries({ queryKey: ["researcher", rid] });
      toast({ tone: "ok", message: r.publicProfile ? (r.effective ? "You now appear on the public profile site." : "Saved. You'll appear once your institution turns the public profile site on.") : "You no longer appear on the public profile site." });
    },
    onError: () => toast({ tone: "error", message: "Couldn't save your choice. Try again." }),
  });
  const on = consent.data?.publicProfile ?? false;
  return (
    <Card className="mb-6"><CardContent className="space-y-4">
      <h2 className="text-base font-semibold">Your settings</h2>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="flex-1">{verified ? "Your ORCID iD is verified." : orcid ? "Your ORCID iD is on record but not verified yet." : "Add your ORCID iD to your record first (ask the research office), then connect it here."}</span>
        {!verified && <Button size="sm" variant="secondary" disabled={!orcid} loading={connect.isPending} onClick={() => connect.mutate()}>Connect ORCID</Button>}
      </div>
      <div className="flex flex-wrap items-center gap-3 border-t pt-4 text-sm">
        <div className="flex-1">
          <p id="consent-label" className="font-medium">Show me on the public profile site</p>
          <p id="consent-hint" className="text-xs text-muted-foreground">Only your name, title, department and verified publications are shown. This takes effect only while your institution has the public profile site switched on{consent.data && on && !consent.data.effective ? " (it is currently off)" : ""}.</p>
        </div>
        <button type="button" role="switch" aria-checked={on} aria-labelledby="consent-label" aria-describedby="consent-hint" disabled={consent.isLoading || setConsent.isPending}
          onClick={() => setConsent.mutate(!on)}
          className={cn("relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors disabled:opacity-50", on ? "border-primary bg-primary" : "border-input bg-muted")}>
          <span className={cn("inline-block size-4 rounded-full bg-white shadow transition-transform", on ? "translate-x-6" : "translate-x-1")} />
          <span className="sr-only">{on ? "On" : "Off"}</span>
        </button>
        <span className="w-8 text-xs font-semibold" aria-hidden>{on ? "On" : "Off"}</span>
      </div>
    </CardContent></Card>
  );
}

export default function Profile() {
  const { id } = useParams();
  const rid = Number(id);
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>("publications");
  const r = useQuery({ queryKey: ["researcher", rid], queryFn: () => api.researcher(rid), retry: false });
  const depts = useQuery({ queryKey: ["departments"], queryFn: api.departments });
  const pubs = useQuery({ queryKey: ["publications", "by-author", rid], queryFn: () => api.publications({ page: 0, size: 200, sort: "year:desc" }) });
  const awards = useQuery({ queryKey: ["awards"], queryFn: api.awards });
  const claims = useQuery({ queryKey: ["claims", rid], queryFn: () => api.claims(rid), retry: false, enabled: r.isSuccess });

  if (r.isError) {
    if (r.error instanceof HttpError && r.error.status === 403) {
      return <Card><EmptyState icon={<Lock className="size-6" aria-hidden />} title="You don't have access to this profile"
        description="You can open profiles for people in your own unit. Ask the research office if you think this is a mistake."
        action={<Link to="/people" className="inline-flex h-10 items-center rounded-xl border px-4 text-sm font-semibold hover:bg-secondary/60">Back to people</Link>} /></Card>;
    }
    return <ErrorBanner error={r.error} onRetry={() => r.refetch()} />;
  }
  if (r.isLoading || !r.data) return <Skeleton className="h-64 w-full" />;
  const p = r.data;
  const myPubs = pubs.data?.items.filter((x) => x.authorIds.includes(rid)) ?? [];
  const myAwards = awards.data?.filter((a) => a.researcherId === rid) ?? [];
  const own = user?.researcherId === rid;
  const role = user?.role;
  const named = (role === "EXECUTIVE" || role === "DEAN") && !own;
  const canAssign = role === "RESEARCH_ADMIN" || role === "HOD" || role === "DEAN";
  const count: Partial<Record<Tab, number>> = { publications: myPubs.length, awards: myAwards.length, claims: claims.data?.length };

  return (
    <div>
      <PageHeader eyebrow="Researcher profile" title={p.name} description={`${p.title} · ${depts.data?.find((d) => d.id === p.departmentId)?.name ?? ""}`} />
      {named && (
        <div role="note" className="mb-4 flex items-start gap-3 rounded-xl border bg-secondary/50 p-3 text-sm">
          <Eye className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
          <span>Opening a named profile is recorded in the access log. Confidential notes are not shown.</span>
        </div>)}
      <Card className="mb-6"><CardContent className="flex flex-wrap items-center gap-6">
        <span className="grid size-16 place-items-center rounded-2xl bg-secondary text-xl font-bold text-primary" aria-hidden>{initials(p.name.replace("Dr. ", ""))}</span>
        <div className="space-y-2 text-sm">
          <a className="flex items-center gap-2 hover:text-primary" href={`mailto:${p.email}`}><Mail className="size-4" aria-hidden />{p.email}</a>
          {p.orcid && p.orcidVerified ? (
            <a className="flex items-center gap-2 text-success hover:underline" href={orcidUrl(p.orcid)} target="_blank" rel="noopener noreferrer"><CheckCircle2 className="size-4" aria-hidden />ORCID connected · {p.orcid}</a>
          ) : p.orcid ? (
            <a className="flex items-center gap-2 text-muted-foreground hover:underline" href={orcidUrl(p.orcid)} target="_blank" rel="noopener noreferrer"><Link2Off className="size-4" aria-hidden />ORCID iD on record, not verified · {p.orcid}</a>
          ) : (<span className="flex items-center gap-2 text-muted-foreground"><Link2Off className="size-4" aria-hidden />ORCID not connected</span>)}
          {p.status === "left" && <LeftBadge leftOn={p.leftOn} />}
        </div>
        <div className="ml-auto text-right"><div className="text-3xl font-semibold">{p.publicationCount ?? 0}</div><div className="text-sm text-muted-foreground">verified publications</div></div>
      </CardContent></Card>

      {own && <OwnSettings rid={rid} orcid={p.orcid} verified={p.orcidVerified} />}

      <div className="mb-4 flex max-w-full overflow-x-auto"><div className="inline-flex rounded-full border bg-card p-1" role="tablist" aria-label="Profile sections">
        {tabs.map((t) => (
          <button key={t} role="tab" id={`tab-${t}`} aria-selected={tab === t} aria-controls="profile-panel" onClick={() => setTab(t)}
            className={cn("whitespace-nowrap rounded-full px-4 py-2 text-sm font-semibold capitalize transition-colors", tab === t ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
            {t}{count[t] !== undefined && <Badge className="ml-1 border-transparent bg-black/10 dark:bg-white/10">{count[t]}</Badge>}
          </button>))}
      </div></div>

      <Card className="overflow-hidden" role="tabpanel" id="profile-panel" aria-labelledby={`tab-${tab}`}>
        {tab === "publications" ? (pubs.isLoading ? <div className="p-6"><Skeleton className="h-12" /></div> : pubs.isError ? <div className="p-6"><ErrorBanner error={pubs.error} onRetry={() => pubs.refetch()} /></div> : myPubs.length === 0 ? <EmptyState title="No publications yet" description="Confirmed and suggested publications will appear here." /> : (
          <ul className="divide-y">{myPubs.map((x) => (
            <li key={x.id} className="flex flex-wrap items-center gap-3 px-6 py-4">
              <div className="min-w-0 flex-1"><Link to={`/publications/${x.id}`} className="font-medium hover:text-primary">{x.title}</Link><p className="text-xs text-muted-foreground">{x.venue} · {x.year}</p></div>
              <VerificationBadge state={x.state} /><SourceChip source={x.source} />
            </li>))}</ul>
        )) : tab === "awards" ? (awards.isLoading ? <div className="p-6"><Skeleton className="h-12" /></div> : awards.isError ? <div className="p-6"><ErrorBanner error={awards.error} onRetry={() => awards.refetch()} /></div> : myAwards.length === 0 ? <EmptyState title="No awards" description="Awards where this person is principal investigator appear here." /> : (
          <ul className="divide-y">{myAwards.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 px-6 py-4"><div><p className="font-medium">{a.title}</p><p className="text-xs text-muted-foreground">{a.funder} · {a.startYear}–{a.endYear}</p></div><span className="font-semibold">{formatMoney(a.amount)}</span></li>))}</ul>
        )) : tab === "claims" ? <ClaimsTab rid={rid} own={own} />
          : tab === "supervision" ? <SupervisionTab person={p} canAssign={canAssign} />
          : <AppointmentsTab rid={rid} admin={role === "RESEARCH_ADMIN"} />}
      </Card>
    </div>
  );
}
