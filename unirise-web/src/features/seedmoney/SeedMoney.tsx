import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, Plus, Search } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth, can } from "@/app/auth";
import { useListParams } from "@/lib/useListParams";
import { formatDate } from "@/lib/utils";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/form";
import { StatusBadge } from "@/components/ui/badge";
import { EmptyState, ErrorBanner, Skeleton } from "@/components/ui/feedback";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

/** The reference system calls a draft "Yet to be submitted". */
export const seedStatusLabel = (s: string) => (s === "draft" ? "Yet to be submitted" : s === "rejected" ? "Reject" : s === "revision_required" ? "Revision required" : undefined);
export const seedId = (id: number) => `SM-${String(id).padStart(4, "0")}`;
const linkCls = "inline-flex h-10 items-center gap-2 rounded-xl border px-4 text-sm font-semibold hover:bg-secondary/60";

export default function SeedMoney() {
  const { user } = useAuth();
  const { get, set } = useListParams({});
  const win = useQuery({ queryKey: ["seed-window"], queryFn: api.seedWindow });
  const list = useQuery({ queryKey: ["seed-proposals", "all"], queryFn: () => api.seedProposals() });
  const q = get("q").toLowerCase();
  const rows = (list.data ?? []).filter((s) => !q || `${seedId(s.id)} ${s.title}`.toLowerCase().includes(q));
  const now = new Date().toISOString().slice(0, 10);
  const open = !!win.data && now >= win.data.opensOn && now <= win.data.closesOn;

  return (
    <div>
      <PageHeader eyebrow="Funding" title="Seed money" description="Small internal grants to start research. Applications open once a quarter."
        actions={<>
          <Link to="/seed-money/report" className={linkCls}><BarChart3 className="size-4" aria-hidden />Reports</Link>
          {can.edit(user?.role) && open && <Link to="/seed-money/new" className="inline-flex h-10 items-center gap-2 rounded-xl border border-primary/80 bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-[0_10px_24px_hsl(var(--primary)/0.25)]"><Plus className="size-4" aria-hidden />New proposal</Link>}
        </>} />
      {win.data && (
        <p role="status" className="mb-4 rounded-xl border bg-secondary/60 px-4 py-3 text-sm">
          {open ? <>Applications for {win.data.label} are open until {formatDate(win.data.closesOn)}.</> : <>Reception of applications for seed money proposals for this quarter is closed.</>}
        </p>)}
      <Card className="mb-4 p-4"><div className="relative"><Search className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground" aria-hidden />
        <Input aria-label="Search proposals" className="pl-9" placeholder="Search by ID or project title" defaultValue={get("q")} onChange={(e) => set({ q: e.target.value })} /></div></Card>

      {list.isError && <ErrorBanner error={list.error} onRetry={() => list.refetch()} />}
      <Card className="overflow-hidden">
        {list.isLoading ? <div className="space-y-3 p-6">{Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-12" />)}</div>
          : rows.length === 0 ? <EmptyState title="No proposals found" description="Your seed money proposals appear here." />
          : (<>
            <div className="hidden md:block"><Table>
              <THead><tr><TH>ID</TH><TH>Title</TH><TH>Category</TH><TH>Window</TH><TH>Applied</TH><TH>Status</TH></tr></THead>
              <TBody>{rows.map((s) => (
                <TR key={s.id}>
                  <TD className="whitespace-nowrap font-medium"><Link className="hover:text-primary" to={`/seed-money/${s.id}`}>{seedId(s.id)}</Link></TD>
                  <TD className="max-w-sm">{s.title}</TD><TD>{s.category}</TD><TD>{s.windowLabel}</TD><TD>{formatDate(s.appliedOn)}</TD>
                  <TD><StatusBadge status={s.status} label={seedStatusLabel(s.status)} /></TD>
                </TR>))}</TBody></Table></div>
            <ul className="divide-y md:hidden">{rows.map((s) => (
              <li key={s.id} className="space-y-1 p-4"><Link to={`/seed-money/${s.id}`} className="font-medium">{seedId(s.id)} · {s.title}</Link>
                <p className="text-xs text-muted-foreground">{s.category} · {s.windowLabel}</p><StatusBadge status={s.status} label={seedStatusLabel(s.status)} /></li>))}</ul>
          </>)}
      </Card>
    </div>
  );
}
