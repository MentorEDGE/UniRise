import type { MilestoneView } from "@/lib/types";
import { formatDate } from "@/lib/utils";
import { MilestoneBadge } from "@/components/ui/badge";

/** Stages in order with due dates; status is shown as icon + text, never colour alone. */
export function MilestoneTimeline({ milestones }: { milestones: MilestoneView[] }) {
  return (
    <ol className="divide-y">
      {milestones.map((m) => (
        <li key={m.id} className="flex flex-wrap items-center gap-3 px-6 py-4 md:px-8">
          <div className="min-w-0 flex-1">
            <p className="font-medium">{m.stage}</p>
            <p className="text-xs text-muted-foreground">
              {m.completedAt ? `Completed ${formatDate(m.completedAt)}` : `Due ${formatDate(m.dueDate)}`}
            </p>
          </div>
          <MilestoneBadge status={m.status} />
        </li>
      ))}
    </ol>
  );
}
