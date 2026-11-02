import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/utils";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MilestoneBadge } from "@/components/ui/badge";
import { EmptyState, ErrorBanner, Skeleton } from "@/components/ui/feedback";
import { MilestoneTimeline } from "./MilestoneTimeline";

export default function MyProgress() {
  const q = useQuery({ queryKey: ["milestones", "mine"], queryFn: () => api.milestones() });
  const next = q.data?.find((m) => m.status !== "done");
  const done = q.data?.filter((m) => m.status === "done").length ?? 0;

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
            </CardContent>
          )}
        </Card>
        <Card className="overflow-hidden"><MilestoneTimeline milestones={q.data} /></Card>
      </>)}
    </div>
  );
}
