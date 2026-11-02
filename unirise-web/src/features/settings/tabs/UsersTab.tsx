import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input, Select } from "@/components/ui/form";
import { EmptyState, ErrorBanner, Skeleton } from "@/components/ui/feedback";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { KindPill, StatusPill } from "@/features/access/GrantParts";
import { roleLabel, type UserRow } from "@/features/access/types";

const sourceLabel: Record<UserRow["source"], string> = {
  "role-grant": "Role grant", "hr-import": "HR import (no role grant)", "guest-share": "Shared item", platform: "Platform operator",
};

function AccountBadge({ u }: { u: UserRow }) {
  if (u.account === "staff") return null;
  return <Badge className="border-violet-200 bg-violet-50 text-violet-700 dark:border-white/10 dark:bg-white/5 dark:text-violet-300">{u.account === "guest" ? "Guest account" : "Platform account"}</Badge>;
}

/** Users, their roles and when access ends. Role changes happen in Roles and access. */
export default function UsersTab() {
  const list = useQuery({ queryKey: ["users"], queryFn: api.usersList });
  const [q, setQ] = useState("");
  const [role, setRole] = useState("");
  const needle = q.trim().toLowerCase();
  const rows = (list.data ?? []).filter((u) => (!role || u.role === role) && (!needle || `${u.name} ${u.email}`.toLowerCase().includes(needle)));
  const roles = [...new Set((list.data ?? []).map((u) => u.role))];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted-foreground">Everyone who can sign in, with the role they hold now. To give, renew or end access, use <Link to="/access" className="font-semibold text-primary hover:underline">Roles and access</Link>.</p>
      </div>
      <Card className="p-4">
        <form role="search" className="grid gap-3 sm:grid-cols-[2fr_1fr]" onSubmit={(e) => e.preventDefault()}>
          <Input aria-label="Search users" placeholder="Search a name or email" value={q} onChange={(e) => setQ(e.target.value)} />
          <Select aria-label="Role" value={role} onChange={(e) => setRole(e.target.value)}><option value="">All roles</option>{roles.map((r) => <option key={r} value={r}>{roleLabel[r]}</option>)}</Select>
        </form>
      </Card>
      {list.isError && <ErrorBanner error={list.error} onRetry={() => list.refetch()} />}
      <Card className="overflow-hidden">
        {list.isLoading ? <div className="space-y-3 p-6">{Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-12" />)}</div>
          : rows.length === 0 ? <EmptyState title="No users match" description="Clear the search or choose another role." />
          : (<>
            <div className="hidden md:block"><Table>
              <THead><tr><TH>Name</TH><TH>Role</TH><TH>Covers</TH><TH>Status</TH><TH>Access ends</TH><TH>Role comes from</TH></tr></THead>
              <TBody>{rows.map((u) => (
                <TR key={u.id}>
                  <TD><p className="font-medium">{u.name}</p><p className="text-xs text-muted-foreground">{u.email || "No email on record"}</p></TD>
                  <TD><div className="flex flex-wrap items-center gap-1.5">{roleLabel[u.role]}{u.kind !== "direct" && <KindPill kind={u.kind} />}<AccountBadge u={u} /></div></TD>
                  <TD>{u.scopeName ?? (u.account === "staff" ? "Own work and scope of role" : "—")}</TD>
                  <TD><StatusPill status={u.status} /></TD>
                  <TD className="whitespace-nowrap">{u.expires ? formatDate(u.expires) : "No end date"}</TD>
                  <TD>{sourceLabel[u.source]}</TD>
                </TR>))}</TBody></Table></div>
            <ul className="divide-y md:hidden">{rows.map((u) => (
              <li key={u.id} className="space-y-1.5 p-4">
                <p className="font-medium">{u.name}</p>
                <p className="text-xs text-muted-foreground">{u.email || "No email on record"}</p>
                <p className="text-sm">{roleLabel[u.role]}{u.scopeName ? ` · ${u.scopeName}` : ""}</p>
                <div className="flex flex-wrap items-center gap-2"><StatusPill status={u.status} />{u.kind !== "direct" && <KindPill kind={u.kind} />}<AccountBadge u={u} /></div>
                <p className="text-xs text-muted-foreground">{u.expires ? `Ends ${formatDate(u.expires)}` : "No end date"} · {sourceLabel[u.source]}</p>
              </li>))}</ul>
          </>)}
      </Card>
    </div>
  );
}
