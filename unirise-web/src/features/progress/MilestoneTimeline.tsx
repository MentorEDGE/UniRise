import type { ReactNode } from "react";
import { BadgeCheck, MessageSquareText } from "lucide-react";
import type { MilestoneView } from "@/lib/types";
import { formatDate } from "@/lib/utils";
import { Badge, MilestoneBadge } from "@/components/ui/badge";

/**
 * Stages in order with due dates; status is shown as icon + text, never colour alone.
 * Approval and the feedback addressed to the scholar sit under the stage they belong to.
 * `actions` adds per-stage buttons (mark done, approve, edit) for the pages that allow them.
 */
export function MilestoneTimeline({ milestones, actions }: { milestones: MilestoneView[]; actions?: (m: MilestoneView) => ReactNode }) {
  return (
    <ol className="divide-y">
      {milestones.map((m) => (
        <li key={m.id} className="space-y-2 px-6 py-4 md:px-8">
          <div className="flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="font-medium">{m.stage}</p>
              <p className="text-xs text-muted-foreground">
                {m.completedAt ? `Completed ${formatDate(m.completedAt)}` : `Due ${formatDate(m.dueDate)}`}
              </p>
            </div>
            {m.approvedOn && (
              <Badge className="border-success/30 bg-success/10 text-success"><BadgeCheck className="size-3.5" aria-hidden />Approved</Badge>
            )}
            <MilestoneBadge status={m.status} />
            {actions && <div className="flex flex-wrap gap-2">{actions(m)}</div>}
          </div>
          {m.approvedOn && <p className="text-xs text-muted-foreground">Approved by {m.approvedBy ?? "your supervisor"} on {formatDate(m.approvedOn)}.</p>}
          {m.feedback && (
            <p className="flex gap-2 rounded-xl bg-secondary/60 p-3 text-sm">
              <MessageSquareText className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
              <span><span className="font-medium">Feedback: </span>{m.feedback}</span>
            </p>
          )}
        </li>
      ))}
    </ol>
  );
}
