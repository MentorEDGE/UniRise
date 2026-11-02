import { AlertTriangle, CheckCircle2, Clock, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";
import { kindLabel, type GrantKind, type GrantStatus, type UserStatus } from "./types";

const statusStyle: Record<GrantStatus | UserStatus, { icon: typeof Clock; cls: string; label: string }> = {
  active: { icon: CheckCircle2, cls: "border-success/30 bg-success/10 text-success", label: "Active" },
  expiring: { icon: AlertTriangle, cls: "border-warning/30 bg-warning/10 text-warning", label: "Ends soon" },
  expired: { icon: XCircle, cls: "border-border bg-muted text-muted-foreground", label: "Ended" },
  ended: { icon: XCircle, cls: "border-border bg-muted text-muted-foreground", label: "Ended" },
  scheduled: { icon: Clock, cls: "border-violet-200 bg-violet-50 text-violet-700 dark:border-white/10 dark:bg-white/5 dark:text-violet-300", label: "Starts later" },
};

/** Icon plus text, never colour alone. */
export function StatusPill({ status }: { status: GrantStatus | UserStatus }) {
  const s = statusStyle[status];
  const Icon = s.icon;
  return <Badge className={s.cls}><Icon className="size-3.5" aria-hidden />{s.label}</Badge>;
}

export const KindPill = ({ kind }: { kind: GrantKind }) => (
  <Badge className="border-violet-200 bg-violet-50 text-violet-700 dark:border-white/10 dark:bg-white/5 dark:text-violet-300">{kindLabel[kind]}</Badge>
);

/** "12 Mar 2026 to 9 Jun 2026", or "from 12 Mar 2026, no end date". */
export const validityText = (g: { validFrom: string; validTo?: string }) =>
  g.validTo ? `${formatDate(g.validFrom)} to ${formatDate(g.validTo)}` : `From ${formatDate(g.validFrom)}, no end date`;
