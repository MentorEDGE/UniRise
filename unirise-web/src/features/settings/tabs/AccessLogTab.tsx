import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { api } from "@/lib/api";
import { downloadCsv } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";
import { EmptyState, ErrorBanner, Skeleton } from "@/components/ui/feedback";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { roleLabel } from "@/features/access/types";
import type { AccessLogEntry } from "@/lib/types";
import { stamp } from "./AuditTab";

const actionLabel: Record<AccessLogEntry["action"], string> = {
  "drill-down": "Opened a named profile", "support-access": "Platform support access", export: "Export", "guest-view": "Guest viewed the shared item",
};

/** Named drill-downs, support access, exports and guest views (PRD R5). Research and IT administrators only. */
export default function AccessLogTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [f, setF] = useState({ action: "", from: "", to: "" });
  const list = useQuery({ queryKey: ["access-log", f], queryFn: () => api.accessLog({ action: (f.action || undefined) as AccessLogEntry["action"] | undefined, from: f.from || undefined, to: f.to || undefined }) });
  const rows = list.data ?? [];
  const exportCsv = useMutation({
    mutationFn: async () => {
      await api.logExported({ log: "access", rows: rows.length });
      downloadCsv("access-log.csv", ["When", "Who", "Role", "What", "About", "Note"], rows.map((e) => [e.at.replace("T", " "), e.actor, roleLabel[e.role], actionLabel[e.action], e.targetName ?? "", e.note ?? ""]));
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["audit-log"] }); qc.invalidateQueries({ queryKey: ["access-log"] }); toast({ tone: "ok", message: "Access log exported. The export is recorded in both logs." }); },
    onError: () => toast({ tone: "error", message: "Couldn't export. Try again." }),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted-foreground">Who looked at named people or shared items, who exported data, and any platform support access. Executives and Deans cannot read this log.</p>
        <Button variant="secondary" disabled={!rows.length} loading={exportCsv.isPending} onClick={() => exportCsv.mutate()}><Download /> Export CSV</Button>
      </div>
      <Card className="p-4">
        <form role="search" className="grid gap-3 sm:grid-cols-3" onSubmit={(e) => e.preventDefault()}>
          <Field label="What">{(a) => <Select {...a} value={f.action} onChange={(e) => setF({ ...f, action: e.target.value })}><option value="">Everything</option>{(Object.keys(actionLabel) as AccessLogEntry["action"][]).map((k) => <option key={k} value={k}>{actionLabel[k]}</option>)}</Select>}</Field>
          <Field label="From">{(a) => <Input {...a} type="date" value={f.from} max={f.to || undefined} onChange={(e) => setF({ ...f, from: e.target.value })} />}</Field>
          <Field label="To">{(a) => <Input {...a} type="date" value={f.to} min={f.from || undefined} onChange={(e) => setF({ ...f, to: e.target.value })} />}</Field>
        </form>
      </Card>
      {list.isError && <ErrorBanner error={list.error} onRetry={() => list.refetch()} />}
      <Card className="overflow-hidden">
        {list.isLoading ? <div className="space-y-3 p-6">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-10" />)}</div>
          : rows.length === 0 ? <EmptyState title="No access entries found" description="Try a wider date range or show everything." action={<Button variant="secondary" onClick={() => setF({ action: "", from: "", to: "" })}>Clear filters</Button>} />
          : (<>
            <div className="hidden md:block"><Table>
              <THead><tr><TH>When</TH><TH>Who</TH><TH>What</TH><TH>About</TH><TH>Note</TH></tr></THead>
              <TBody>{rows.map((e) => (
                <TR key={e.id}>
                  <TD className="whitespace-nowrap">{stamp(e.at)}</TD>
                  <TD>{e.actor}<p className="text-xs text-muted-foreground">{roleLabel[e.role]}</p></TD>
                  <TD><Badge className="border-violet-200 bg-violet-50 text-violet-700 dark:border-white/10 dark:bg-white/5 dark:text-violet-300">{actionLabel[e.action]}</Badge></TD>
                  <TD>{e.targetName ?? "—"}</TD><TD className="max-w-sm text-muted-foreground">{e.note ?? "—"}</TD>
                </TR>))}</TBody></Table></div>
            <ul className="divide-y md:hidden">{rows.map((e) => (
              <li key={e.id} className="space-y-1 p-4"><p className="font-medium">{actionLabel[e.action]}{e.targetName ? `: ${e.targetName}` : ""}</p>
                <p className="text-xs text-muted-foreground">{stamp(e.at)} · {e.actor} ({roleLabel[e.role]})</p>
                {e.note && <p className="text-xs">{e.note}</p>}</li>))}</ul>
          </>)}
      </Card>
    </div>
  );
}
