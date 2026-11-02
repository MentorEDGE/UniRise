import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Download, Plus, Search } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth, can } from "@/app/auth";
import { useListParams } from "@/lib/useListParams";
import { downloadCsv, formatMoney } from "@/lib/utils";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form";
import { StatusBadge } from "@/components/ui/badge";
import { EmptyState, ErrorBanner, Skeleton } from "@/components/ui/feedback";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

export const grantId = (id: number) => `G-${String(id).padStart(5, "0")}`;
export const GRANT_TYPES = ["Research", "Consultancy", "Training or workshop", "Infrastructure"];

export default function Grants() {
  const { user } = useAuth();
  const { get, set } = useListParams({});
  const list = useQuery({ queryKey: ["grants"], queryFn: api.grants });
  const q = get("q").toLowerCase();
  const rows = (list.data ?? []).filter((g) =>
    (!get("type") || g.type === get("type")) &&
    (!get("status") || g.status === get("status")) &&
    (!q || `${grantId(g.id)} ${g.title} ${g.utn ?? ""}`.toLowerCase().includes(q)));

  return (
    <div>
      <PageHeader eyebrow="Funding" title="Grants" description="External grants from application to sanction. Save a draft and submit when it is complete."
        actions={<>
          <Button variant="secondary" disabled={!rows.length} onClick={() => downloadCsv("grants.csv", ["Grant ID", "Title", "Type", "Agency", "Status", "Applied (INR)", "Sanctioned (INR)"],
            rows.map((g) => [grantId(g.id), g.title, g.type, g.agency, g.status, g.appliedAmount, g.sanctionedAmount ?? ""]))}><Download /> Export</Button>
          {can.edit(user?.role) && <Link to="/grants/new" className="inline-flex h-10 items-center gap-2 rounded-xl border border-primary/80 bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-[0_10px_24px_hsl(var(--primary)/0.25)] transition-transform active:scale-[0.98]"><Plus className="size-4" aria-hidden />New grant</Link>}
        </>} />

      <Card className="mb-4 p-4">
        <form role="search" className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr]" onSubmit={(e) => e.preventDefault()}>
          <div className="relative"><Search className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground" aria-hidden />
            <Input aria-label="Search grants" className="pl-9" placeholder="Search grant ID, title or UTN" defaultValue={get("q")} onChange={(e) => set({ q: e.target.value })} /></div>
          <Select aria-label="Grant type" value={get("type")} onChange={(e) => set({ type: e.target.value })}><option value="">All grant types</option>{GRANT_TYPES.map((t) => <option key={t}>{t}</option>)}</Select>
          <Select aria-label="Status" value={get("status")} onChange={(e) => set({ status: e.target.value })}>
            <option value="">Any status</option>{["draft", "submitted", "sanctioned", "rework", "rejected"].map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}</Select>
        </form>
      </Card>

      {list.isError && <ErrorBanner error={list.error} onRetry={() => list.refetch()} />}
      <Card className="overflow-hidden">
        {list.isLoading ? <div className="space-y-3 p-6">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-12" />)}</div>
          : rows.length === 0 ? <EmptyState title="No grants found" description="Try different filters, or start a new grant application record." />
          : (<>
            <div className="hidden md:block"><Table>
              <THead><tr><TH>Grant ID</TH><TH>Title</TH><TH>Type</TH><TH>Agency</TH><TH>Status</TH><TH className="text-right">Applied</TH><TH className="text-right">Sanctioned</TH></tr></THead>
              <TBody>{rows.map((g) => (
                <TR key={g.id}>
                  <TD className="whitespace-nowrap font-medium"><Link className="hover:text-primary" to={`/grants/${g.id}`}>{grantId(g.id)}</Link></TD>
                  <TD className="max-w-sm">{g.title}</TD><TD>{g.type}</TD><TD>{g.agency}</TD><TD><StatusBadge status={g.status} /></TD>
                  <TD className="text-right">{formatMoney(g.appliedAmount)}</TD><TD className="text-right">{g.sanctionedAmount ? formatMoney(g.sanctionedAmount) : "—"}</TD>
                </TR>))}</TBody></Table></div>
            <ul className="divide-y md:hidden">{rows.map((g) => (
              <li key={g.id} className="space-y-1 p-4"><Link to={`/grants/${g.id}`} className="font-medium">{grantId(g.id)} · {g.title}</Link>
                <p className="text-xs text-muted-foreground">{g.agency} · {formatMoney(g.appliedAmount)}</p><StatusBadge status={g.status} /></li>))}</ul>
          </>)}
      </Card>
    </div>
  );
}
