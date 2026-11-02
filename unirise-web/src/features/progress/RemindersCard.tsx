import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AlertOctagon, AlertTriangle, BellRing, Clock, Mail } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/app/auth";
import type { Reminder } from "@/lib/types";
import { formatDate } from "@/lib/utils";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState, ErrorBanner, Skeleton } from "@/components/ui/feedback";

const levelUi = {
  soon: { icon: Clock, label: "Due soon", cls: "border-warning/30 bg-warning/10 text-warning" },
  overdue: { icon: AlertTriangle, label: "Overdue", cls: "border-destructive/30 bg-destructive/10 text-destructive" },
  escalated: { icon: AlertOctagon, label: "Escalated", cls: "border-destructive/40 bg-destructive/15 text-destructive" },
} as const;

/** Where a reminder links to, for the viewer's role; heads of unit have no scholar page, so they get plain text. */
function useTarget() {
  const { user } = useAuth();
  return (r: Reminder) => (user?.role === "SUPERVISOR" ? `/mentees/${r.scholarId}` : user?.role === "RESEARCHER" ? "/my-progress" : undefined);
}

/** Reminders the signed-in person receives, with why each one was sent. The server decides what each role sees. */
export function RemindersCard({ title = "Reminders", description = "Stages that are due soon or late, and who was told.", limit }: { title?: string; description?: string; limit?: number }) {
  const q = useQuery({ queryKey: ["reminders"], queryFn: api.reminders });
  const target = useTarget();
  const rows = limit ? q.data?.slice(0, limit) : q.data;
  const hidden = (q.data?.length ?? 0) - (rows?.length ?? 0);

  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-3"><BellRing className="size-5 text-primary" aria-hidden />{title}
          <span className="inline-flex items-center gap-1 text-xs font-normal text-muted-foreground"><Mail className="size-3.5" aria-hidden />Also sent by email (sample)</span></CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <div className="mt-4">
        {q.isLoading ? <div className="space-y-3 px-6 pb-6 md:px-8">{Array.from({ length: 2 }, (_, i) => <Skeleton key={i} className="h-14" />)}</div>
          : q.isError ? <div className="px-6 pb-6 md:px-8"><ErrorBanner error={q.error} onRetry={() => q.refetch()} /></div>
          : rows?.length === 0 ? <EmptyState title="Nothing to chase" description="No stage is due within 14 days or running late." />
          : (<>
            <ul className="divide-y">
              {rows?.map((r) => {
                const ui = levelUi[r.level];
                const to = target(r);
                return (
                  <li key={r.id} className="space-y-1 px-6 py-4 md:px-8">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge className={ui.cls}><ui.icon className="size-3.5" aria-hidden />{ui.label}</Badge>
                      <p className="font-medium">{to ? <Link to={to} className="hover:text-primary">{r.scholarName}</Link> : r.scholarName}</p>
                      <span className="text-sm text-muted-foreground">{r.stage} · due {formatDate(r.dueDate)}</span>
                    </div>
                    <p className="text-sm text-muted-foreground">{r.reason}</p>
                  </li>
                );
              })}
            </ul>
            {hidden > 0 && <p className="px-6 py-3 text-xs text-muted-foreground md:px-8">{hidden} more not shown.</p>}
          </>)}
      </div>
    </Card>
  );
}
