import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { api } from "@/lib/api";
import { downloadCsv, formatDate } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";
import { EmptyState, ErrorBanner, Skeleton } from "@/components/ui/feedback";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";

const ENTITIES = ["publication", "role-grant", "report", "log-export"];
export const stamp = (at: string) => `${formatDate(at)} ${at.slice(11, 16)}`;

/** Who changed what (PRD R5). Research and IT administrators only. */
export default function AuditTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [f, setF] = useState({ q: "", entity: "", from: "", to: "" });
  const list = useQuery({ queryKey: ["audit-log", f], queryFn: () => api.auditLog({ q: f.q || undefined, entity: f.entity || undefined, from: f.from || undefined, to: f.to || undefined }) });
  const rows = list.data ?? [];
  const exportCsv = useMutation({
    mutationFn: async () => {
      await api.logExported({ log: "audit", rows: rows.length }); // the export itself is logged, before the file is produced
      downloadCsv("audit-log.csv", ["When", "Who", "Action", "Record type", "Record", "Detail"], rows.map((e) => [e.at.replace("T", " "), e.actor, e.action, e.entity, e.entityId ?? "", e.detail ?? ""]));
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["audit-log"] }); qc.invalidateQueries({ queryKey: ["access-log"] }); toast({ tone: "ok", message: "Audit log exported. The export is recorded in both logs." }); },
    onError: () => toast({ tone: "error", message: "Couldn't export. Try again." }),
  });
  const entities = [...new Set([...ENTITIES, ...rows.map((r) => r.entity)])];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted-foreground">Every change to people, records and access, with who made it. Entries can't be edited.</p>
        <Button variant="secondary" disabled={!rows.length} loading={exportCsv.isPending} onClick={() => exportCsv.mutate()}><Download /> Export CSV</Button>
      </div>
      <Card className="p-4">
        <form role="search" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" onSubmit={(e) => e.preventDefault()}>
          <Field label="Search">{(a) => <Input {...a} placeholder="Person, action or detail" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} />}</Field>
          <Field label="Record type">{(a) => <Select {...a} value={f.entity} onChange={(e) => setF({ ...f, entity: e.target.value })}><option value="">All record types</option>{entities.map((x) => <option key={x}>{x}</option>)}</Select>}</Field>
          <Field label="From">{(a) => <Input {...a} type="date" value={f.from} max={f.to || undefined} onChange={(e) => setF({ ...f, from: e.target.value })} />}</Field>
          <Field label="To">{(a) => <Input {...a} type="date" value={f.to} min={f.from || undefined} onChange={(e) => setF({ ...f, to: e.target.value })} />}</Field>
        </form>
      </Card>
      {list.isError && <ErrorBanner error={list.error} onRetry={() => list.refetch()} />}
      <Card className="overflow-hidden">
        {list.isLoading ? <div className="space-y-3 p-6">{Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-10" />)}</div>
          : rows.length === 0 ? <EmptyState title="No entries found" description="Try a wider date range or clear the search." action={<Button variant="secondary" onClick={() => setF({ q: "", entity: "", from: "", to: "" })}>Clear filters</Button>} />
          : (<>
            <div className="hidden md:block"><Table>
              <THead><tr><TH>When</TH><TH>Who</TH><TH>Action</TH><TH>Record</TH><TH>Detail</TH></tr></THead>
              <TBody>{rows.map((e) => (
                <TR key={e.id}>
                  <TD className="whitespace-nowrap">{stamp(e.at)}</TD><TD>{e.actor}</TD><TD className="font-medium">{e.action}</TD>
                  <TD className="whitespace-nowrap">{e.entity}{e.entityId !== undefined && ` #${e.entityId}`}</TD><TD className="max-w-sm text-muted-foreground">{e.detail ?? "—"}</TD>
                </TR>))}</TBody></Table></div>
            <ul className="divide-y md:hidden">{rows.map((e) => (
              <li key={e.id} className="space-y-1 p-4"><p className="font-medium">{e.action}</p>
                <p className="text-xs text-muted-foreground">{stamp(e.at)} · {e.actor}</p>
                <p className="text-xs">{e.entity}{e.entityId !== undefined && ` #${e.entityId}`}{e.detail ? ` · ${e.detail}` : ""}</p></li>))}</ul>
          </>)}
      </Card>
    </div>
  );
}
