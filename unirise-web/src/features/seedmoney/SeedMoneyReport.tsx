import { Link } from "react-router-dom";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Download } from "lucide-react";
import { api } from "@/lib/api";
import { downloadCsv, formatDate } from "@/lib/utils";
import type { EntryStatus } from "@/lib/types";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";
import { StatusBadge } from "@/components/ui/badge";
import { EmptyState, ErrorBanner, Skeleton } from "@/components/ui/feedback";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { seedId, seedStatusLabel } from "./SeedMoney";

const STATUSES: { value: EntryStatus | ""; label: string }[] = [
  { value: "", label: "ALL" }, { value: "approved", label: "Approved" }, { value: "draft", label: "Yet to be submitted" },
  { value: "submitted", label: "Submitted" }, { value: "rework", label: "Rework" }, { value: "rejected", label: "Reject" }, { value: "revision_required", label: "Revision required" },
];
const iso = (d: Date) => d.toISOString().slice(0, 10);

export default function SeedMoneyReport() {
  const [from, setFrom] = useState(iso(new Date(Date.now() - 365 * 86_400_000)));
  const [to, setTo] = useState(iso(new Date()));
  const [status, setStatus] = useState<EntryStatus | "">("");
  const q = useQuery({ queryKey: ["seed-proposals", { from, to, status }], queryFn: () => api.seedProposals({ from, to, status }) });

  return (
    <div>
      <Link to="/seed-money" className="mb-4 inline-flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-primary"><ArrowLeft className="size-4" aria-hidden />All proposals</Link>
      <PageHeader eyebrow="Seed money" title="Seed money report" description="Proposals applied within a period, by status."
        actions={<Button variant="secondary" disabled={!q.data?.length} onClick={() => q.data && downloadCsv("seed-money-report.csv", ["ID", "Title", "Category", "Applied", "Lead PI", "Status"],
          q.data.map((s) => [seedId(s.id), s.title, s.category, s.appliedOn, s.investigators.find((i) => i.isLeadPI)?.name ?? "", seedStatusLabel(s.status) ?? s.status]))}><Download /> Export CSV</Button>} />
      <Card className="mb-4 p-4"><div className="grid gap-3 sm:grid-cols-3">
        <Field label="From date">{(a) => <Input {...a} type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />}</Field>
        <Field label="To date">{(a) => <Input {...a} type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />}</Field>
        <Field label="Status">{(a) => <Select {...a} value={status} onChange={(e) => setStatus(e.target.value as EntryStatus | "")}>{STATUSES.map((s) => <option key={s.label} value={s.value}>{s.label}</option>)}</Select>}</Field>
      </div></Card>
      {q.isError && <ErrorBanner error={q.error} onRetry={() => q.refetch()} />}
      <Card className="overflow-hidden">
        {q.isLoading ? <div className="p-6"><Skeleton className="h-32" /></div> : q.data?.length === 0 ? <EmptyState title="No proposals in this period" description="Widen the dates or change the status." /> : (
          <Table><THead><tr><TH>ID</TH><TH>Title</TH><TH>Category</TH><TH>Applied</TH><TH>Lead PI</TH><TH>Status</TH></tr></THead>
            <TBody>{q.data?.map((s) => (
              <TR key={s.id}><TD className="whitespace-nowrap font-medium"><Link className="hover:text-primary" to={`/seed-money/${s.id}`}>{seedId(s.id)}</Link></TD><TD>{s.title}</TD><TD>{s.category}</TD>
                <TD>{formatDate(s.appliedOn)}</TD><TD>{s.investigators.find((i) => i.isLeadPI)?.name ?? "—"}</TD><TD><StatusBadge status={s.status} label={seedStatusLabel(s.status)} /></TD></TR>))}</TBody></Table>)}
      </Card>
    </div>
  );
}
