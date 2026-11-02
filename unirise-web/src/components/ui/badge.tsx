import { AlertTriangle, CheckCircle2, Circle, Clock, Sparkles } from "lucide-react";
import { cn, statusLabel } from "@/lib/utils";
import type { MilestoneStatus, PublicationSource, VerificationState } from "@/lib/types";

export function Badge({ className, children }: { className?: string; children: React.ReactNode }) {
  return <span className={cn("inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold", className)}>{children}</span>;
}

/** Colour is never the only signal: each state has an icon and text. */
export function VerificationBadge({ state }: { state: VerificationState }) {
  const map = {
    verified: { icon: CheckCircle2, label: "Verified", cls: "border-success/30 bg-success/10 text-success" },
    suggested: { icon: Sparkles, label: "Suggested", cls: "border-warning/30 bg-warning/10 text-warning" },
    unverified: { icon: Circle, label: "Unverified", cls: "border-border bg-muted text-muted-foreground" },
  }[state];
  const Icon = map.icon;
  return <Badge className={map.cls}><Icon className="size-3.5" aria-hidden />{map.label}</Badge>;
}

export function MilestoneBadge({ status }: { status: MilestoneStatus }) {
  const map = {
    done: { icon: CheckCircle2, label: "Done", cls: "border-success/30 bg-success/10 text-success" },
    upcoming: { icon: Clock, label: "Upcoming", cls: "border-border bg-muted text-muted-foreground" },
    overdue: { icon: AlertTriangle, label: "Overdue", cls: "border-destructive/30 bg-destructive/10 text-destructive" },
  }[status];
  const Icon = map.icon;
  return <Badge className={map.cls}><Icon className="size-3.5" aria-hidden />{map.label}</Badge>;
}

const sourceLabel: Record<PublicationSource, string> = { crossref: "Crossref", orcid: "ORCID", openalex: "OpenAlex", manual: "Manual" };
export const SourceChip = ({ source }: { source: PublicationSource }) => (
  <Badge className="border-violet-200 bg-violet-50 text-violet-700 dark:border-white/10 dark:bg-white/5 dark:text-violet-300">{sourceLabel[source]}</Badge>
);

const statusStyle: Record<string, { icon: typeof Circle; cls: string }> = {
  draft: { icon: Circle, cls: "border-border bg-muted text-muted-foreground" },
  submitted: { icon: Clock, cls: "border-violet-200 bg-violet-50 text-violet-700 dark:border-white/10 dark:bg-white/5 dark:text-violet-300" },
  approved: { icon: CheckCircle2, cls: "border-success/30 bg-success/10 text-success" },
  sanctioned: { icon: CheckCircle2, cls: "border-success/30 bg-success/10 text-success" },
  rework: { icon: AlertTriangle, cls: "border-warning/30 bg-warning/10 text-warning" },
  revision_required: { icon: AlertTriangle, cls: "border-warning/30 bg-warning/10 text-warning" },
  rejected: { icon: AlertTriangle, cls: "border-destructive/30 bg-destructive/10 text-destructive" },
};

/** Workflow status of an entry, grant or seed-money proposal: icon plus text, never colour alone. */
export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const s = statusStyle[status] ?? statusStyle.draft;
  const Icon = s.icon;
  return <Badge className={s.cls}><Icon className="size-3.5" aria-hidden />{label ?? statusLabel[status] ?? status}</Badge>;
}
