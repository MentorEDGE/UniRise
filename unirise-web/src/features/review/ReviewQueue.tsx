import { useCallback, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, SkipForward, X } from "lucide-react";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge, SourceChip } from "@/components/ui/badge";
import { EmptyState, ErrorBanner, Skeleton } from "@/components/ui/feedback";
import { useToast } from "@/components/ui/toast";
import { useState } from "react";
import { doiUrl } from "@/lib/utils";

export default function ReviewQueue() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const list = useQuery({ queryKey: ["suggestions"], queryFn: api.suggestions });
  const people = useQuery({ queryKey: ["researchers", "all"], queryFn: () => api.researchers() });
  const [skipped, setSkipped] = useState<number[]>([]);

  const queue = (list.data ?? []).filter((s) => !skipped.includes(s.id));
  const current = queue[0];

  const decide = useMutation({
    mutationFn: ({ id, d }: { id: number; d: "confirm" | "reject" }) => api.decide(id, d),
    onSuccess: (_r, v) => {
      qc.invalidateQueries({ queryKey: ["suggestions"] }); qc.invalidateQueries({ queryKey: ["summary"] });
      qc.invalidateQueries({ queryKey: ["publications"] }); qc.invalidateQueries({ queryKey: ["by-year"] });
      toast({ tone: "ok", message: v.d === "confirm" ? "Confirmed. It now counts in reports." : "Marked as not theirs." });
    },
    onError: () => toast({ tone: "error", message: "Couldn't save your decision. Try again." }),
  });

  const act = useCallback((d: "confirm" | "reject" | "skip") => {
    if (!current || decide.isPending) return;
    if (d === "skip") { setSkipped((s) => [...s, current.id]); return; }
    decide.mutate({ id: current.id, d });
  }, [current, decide]);

  // Keyboard shortcuts: Y confirm, N not mine, S skip (ignored while typing).
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || /input|textarea|select/i.test((e.target as HTMLElement).tagName)) return;
      const k = e.key.toLowerCase();
      if (k === "y") act("confirm"); else if (k === "n") act("reject"); else if (k === "s") act("skip");
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [act]);

  const person = (id: number) => people.data?.find((r) => r.id === id);

  return (
    <div className="max-w-3xl">
      <PageHeader eyebrow="Verification" title="Review queue" description="Only confirmed publications count in official reports. Keyboard: Y confirm · N not mine · S skip." />
      {list.isError && <ErrorBanner error={list.error} onRetry={() => list.refetch()} />}
      {list.isLoading ? <Skeleton className="h-72 w-full" /> : !current ? (
        <Card><EmptyState title="You're all caught up" description={skipped.length ? `${skipped.length} skipped suggestion(s) will return next time.` : "New suggestions appear after the next harvest."} /></Card>
      ) : (
        <>
          <p className="mb-3 text-sm text-muted-foreground" aria-live="polite">{queue.length} remaining</p>
          <Card hover key={current.id} className="animate-fade-up">
            <CardContent className="space-y-5">
              <div className="flex flex-wrap items-center gap-2">
                <Badge className="border-primary/30 bg-primary/10 text-primary">Match {Math.round(current.score * 100)}%</Badge>
                <SourceChip source={current.publication.source} />
              </div>
              <div>
                <h2 className="text-xl font-semibold tracking-tight">{current.publication.title}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{current.publication.venue} · {current.publication.year}
                  {current.publication.doi && <> · <a className="text-primary hover:underline" href={doiUrl(current.publication.doi)} target="_blank" rel="noopener noreferrer">{current.publication.doi}</a></>}</p>
              </div>
              <dl className="grid gap-3 rounded-xl bg-secondary/60 p-4 text-sm sm:grid-cols-2">
                <div><dt className="text-xs uppercase tracking-wider text-muted-foreground">Would attach to</dt><dd className="font-semibold">{person(current.researcherId)?.name ?? "…"}</dd></div>
                <div><dt className="text-xs uppercase tracking-wider text-muted-foreground">Why we think so</dt><dd>{current.reason}</dd></div>
              </dl>
              <div className="flex flex-wrap gap-3">
                <Button onClick={() => act("confirm")} loading={decide.isPending && decide.variables?.d === "confirm"}><Check /> Confirm <kbd className="ml-1 rounded bg-white/20 px-1.5 text-[10px]">Y</kbd></Button>
                <Button variant="secondary" onClick={() => act("reject")}><X /> Not mine <kbd className="ml-1 rounded bg-black/10 px-1.5 text-[10px] dark:bg-white/10">N</kbd></Button>
                <Button variant="ghost" onClick={() => act("skip")}><SkipForward /> Skip <kbd className="ml-1 rounded bg-black/10 px-1.5 text-[10px] dark:bg-white/10">S</kbd></Button>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
