import { useQuery } from "@tanstack/react-query";
import { CalendarClock, Lock } from "lucide-react";
import { api } from "@/lib/api";
import { HttpError } from "@/lib/http";
import { downloadCsv, formatDate } from "@/lib/utils";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorBanner, Skeleton } from "@/components/ui/feedback";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

/** Home for guests (PRD R3): the one shared item until its expiry date, nothing else. */
export default function GuestHome() {
  const view = useQuery({ queryKey: ["guest-view"], queryFn: api.guestView, retry: false });
  const refused = view.error instanceof HttpError && view.error.status === 403;

  return (
    <div>
      <PageHeader eyebrow="Shared with you" title={view.data?.item.label ?? "Your access"} description="You were given access to one item. This is sample data until a backend is connected." />
      {view.isLoading && <Skeleton className="h-64 w-full" />}
      {refused && <Card><EmptyState icon={<Lock className="size-6" aria-hidden />} title="Your access has ended" description="The date for this shared item has passed. Ask the person who shared it with you if you still need it." /></Card>}
      {view.isError && !refused && <ErrorBanner error={view.error} onRetry={() => view.refetch()} />}
      {view.data && (
        <>
          <p className="mb-4 inline-flex items-center gap-2 rounded-xl border bg-card px-4 py-2 text-sm"><CalendarClock className="size-4 text-primary" aria-hidden />Your access ends on <strong>{formatDate(view.data.expiresOn)}</strong>.</p>
          {view.data.report ? (
            <Card className="mb-6 overflow-hidden">
              <div className="flex items-center justify-between gap-3 p-4">
                <h2 className="text-lg font-semibold">{view.data.item.label}</h2>
                <Button variant="secondary" size="sm" disabled={!view.data.report.rows.length} onClick={() => downloadCsv("shared-report.csv", view.data!.report!.columns, view.data!.report!.rows)}>Export</Button>
              </div>
              {view.data.report.rows.length === 0 ? <EmptyState title="Nothing to show yet" description="This report has no rows at the moment." /> : (
                <Table>
                  <THead><tr>{view.data.report.columns.map((c, i) => <TH key={c} className={i > 0 ? "text-right" : undefined}>{c}</TH>)}</tr></THead>
                  <TBody>{view.data.report.rows.map((r, i) => <TR key={i}>{r.map((cell, j) => <TD key={j} className={j > 0 ? "text-right" : undefined}>{cell}</TD>)}</TR>)}</TBody>
                </Table>)}
            </Card>
          ) : view.data.publication ? (
            <Card className="mb-6"><CardHeader><CardTitle>{view.data.publication.title}</CardTitle><CardDescription>{view.data.publication.venue}, {view.data.publication.year}</CardDescription></CardHeader>
              {view.data.publication.doi && <CardContent className="pt-4 md:pt-4 text-sm">DOI {view.data.publication.doi}</CardContent>}</Card>
          ) : (
            <Card className="mb-6"><EmptyState title="This item can't be shown" description="The shared item isn't available right now. Ask the person who shared it with you." /></Card>
          )}
        </>
      )}
      {(view.data || refused) && <p className="text-sm text-muted-foreground">Nothing else is available to you. Each time you open this page it is recorded in the university&apos;s access log.</p>}
    </div>
  );
}
