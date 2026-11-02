import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CheckCheck } from "lucide-react";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/utils";
import type { MilestoneView } from "@/lib/types";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MilestoneBadge } from "@/components/ui/badge";
import { EmptyState, ErrorBanner, Skeleton } from "@/components/ui/feedback";
import { MilestoneTimeline } from "./MilestoneTimeline";
import { MarkDoneDialog } from "./MilestoneDialogs";
import { RemindersCard } from "./RemindersCard";

export default function MyProgress() {
  const q = useQuery({ queryKey: ["milestones", "mine"], queryFn: () => api.milestones() });
  const [finishing, setFinishing] = useState<MilestoneView>();
  const next = q.data?.find((m) => m.status !== "done");
  const done = q.data?.filter((m) => m.status === "done").length ?? 0;
  const latestFeedback = q.data?.filter((m) => m.feedback).sort((a, b) => (b.approvedOn ?? "").localeCompare(a.approvedOn ?? ""))[0];

  return (
    <div className="max-w-3xl">
      <PageHeader eyebrow="Progress" title="My progress" description="Your stages, due dates and what comes next." />
      {q.isError && <ErrorBanner error={q.error} onRetry={() => q.refetch()} />}
      {q.isLoading && <Skeleton className="h-40 w-full" />}
      {q.data && q.data.length === 0 && <Card><EmptyState title="No milestones yet" description="Your supervisor or the research office will set these up." /></Card>}
      {q.data && q.data.length > 0 && (<>
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>{next ? "Next milestone" : "All milestones complete"}</CardTitle>
            <CardDescription>{done} of {q.data.length} stages done.</CardDescription>
          </CardHeader>
          {next && (
            <CardContent className="flex flex-wrap items-center gap-4">
              <div className="flex-1">
                <p className="text-xl font-semibold tracking-tight">{next.stage}</p>
                <p className="text-sm text-muted-foreground">Due {formatDate(next.dueDate)}</p>
              </div>
              <MilestoneBadge status={next.status} />
              <Button onClick={() => setFinishing(next)}><CheckCheck aria-hidden />Mark as done</Button>
            </CardContent>
          )}
        </Card>
        {latestFeedback && (
          <Card className="mb-6 border-violet-200 bg-secondary/60">
            <CardHeader><CardTitle>Latest feedback</CardTitle><CardDescription>{latestFeedback.stage}{latestFeedback.approvedBy ? ` · ${latestFeedback.approvedBy}` : ""}{latestFeedback.approvedOn ? `, ${formatDate(latestFeedback.approvedOn)}` : ""}</CardDescription></CardHeader>
            <CardContent className="pt-3 text-sm">{latestFeedback.feedback}</CardContent>
          </Card>
        )}
        <Card className="mb-6 overflow-hidden">
          <MilestoneTimeline milestones={q.data} actions={(m) => m.status !== "done" && (
            <Button size="sm" variant="secondary" aria-label={`Mark ${m.stage} as done`} onClick={() => setFinishing(m)}>Mark as done</Button>
          )} />
        </Card>
        <RemindersCard title="Your reminders" description="What you and your supervisor are being reminded about." />
      </>)}
      <MarkDoneDialog milestone={finishing} onClose={() => setFinishing(undefined)} />
    </div>
  );
}
