import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, SkipForward, UserCog, X } from "lucide-react";
import { api } from "@/lib/api";
import { can, roleSets, useAuth } from "@/app/auth";
import { cn, doiUrl } from "@/lib/utils";
import type { Suggestion } from "@/lib/types";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge, SourceChip } from "@/components/ui/badge";
import { Dialog } from "@/components/ui/dialog";
import { Field, Select } from "@/components/ui/form";
import { EmptyState, ErrorBanner, Skeleton } from "@/components/ui/feedback";
import { useToast } from "@/components/ui/toast";
import DisputesPanel from "./DisputesPanel";

type Tab = "suggestions" | "disputes";

function ReassignDialog({ suggestion, onClose }: { suggestion: Suggestion | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const people = useQuery({ queryKey: ["directory"], queryFn: api.directory });
  const [target, setTarget] = useState("");
  const [error, setError] = useState<string>();
  const reassign = useMutation({
    mutationFn: () => api.overrideSuggestion({ id: suggestion!.id, researcherId: Number(target) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["suggestions"] }); toast({ tone: "ok", message: "Suggestion reassigned." }); setTarget(""); onClose(); },
    onError: (e) => setError((e as { status?: number }).status === 409 ? "That person is already an author, or already has this suggestion." : "Couldn't reassign. Try again."),
  });
  const choices = (people.data ?? []).filter((p) => p.id !== suggestion?.researcherId);
  return (
    <Dialog open={!!suggestion} onClose={() => { setError(undefined); onClose(); }} title="Reassign suggestion" description="Attach this publication to a different person in the review queue.">
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (!target) return setError("Choose a person."); setError(undefined); reassign.mutate(); }} noValidate>
        <Field label="Reassign to" error={error}>
          {(a) => <Select {...a} value={target} onChange={(e) => setTarget(e.target.value)}><option value="">Select…</option>{choices.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>}
        </Field>
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={reassign.isPending}>Reassign</Button>
        </div>
      </form>
    </Dialog>
  );
}

function SuggestionsPanel() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();
  const list = useQuery({ queryKey: ["suggestions"], queryFn: api.suggestions });
  const people = useQuery({ queryKey: ["directory"], queryFn: api.directory });
  const depts = useQuery({ queryKey: ["departments"], queryFn: api.departments, enabled: can.admin(user?.role) });
  const [skipped, setSkipped] = useState<number[]>([]);
  const [dept, setDept] = useState("");
  const [reassigning, setReassigning] = useState<Suggestion | null>(null);

  const person = (id: number) => people.data?.find((r) => r.id === id);
  const queue = (list.data ?? []).filter((s) => !skipped.includes(s.id) && (!dept || person(s.researcherId)?.departmentId === Number(dept)));
  const current = queue[0];

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["suggestions"] }); qc.invalidateQueries({ queryKey: ["summary"] });
    qc.invalidateQueries({ queryKey: ["publications"] }); qc.invalidateQueries({ queryKey: ["by-year"] });
  };
  const undo = useMutation({
    mutationFn: (id: number) => api.undoDecision(id),
    onSuccess: () => { refresh(); toast({ tone: "ok", message: "Decision undone. The suggestion is back in the queue." }); },
    onError: () => toast({ tone: "error", message: "Couldn't undo that decision." }),
  });
  const decide = useMutation({
    mutationFn: ({ id, d }: { id: number; d: "confirm" | "reject" }) => api.decide(id, d),
    onSuccess: (_r, v) => {
      refresh();
      // The toast lives 6 seconds; Undo is offered for exactly that long.
      toast({ tone: "ok", message: v.d === "confirm" ? "Confirmed. It now counts in reports." : "Marked as not theirs.", actionLabel: "Undo", onAction: () => undo.mutate(v.id) });
    },
    onError: () => toast({ tone: "error", message: "Couldn't save your decision. Try again." }),
  });

  const act = useCallback((d: "confirm" | "reject" | "skip") => {
    if (!current || decide.isPending) return;
    if (d === "skip") { setSkipped((s) => [...s, current.id]); return; }
    decide.mutate({ id: current.id, d });
  }, [current, decide]);

  // Keyboard shortcuts: Y confirm, N not mine, S skip (ignored while typing or while a dialog is open).
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || reassigning || /input|textarea|select/i.test((e.target as HTMLElement).tagName)) return;
      const k = e.key.toLowerCase();
      if (k === "y") act("confirm"); else if (k === "n") act("reject"); else if (k === "s") act("skip");
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [act, reassigning]);

  if (list.isError) return <ErrorBanner error={list.error} onRetry={() => list.refetch()} />;
  if (list.isLoading) return <Skeleton className="h-72 w-full" />;
  return (
    <>
      {can.admin(user?.role) && (
        <div className="mb-4 max-w-xs">
          <Field label="Department">
            {(a) => <Select {...a} value={dept} onChange={(e) => setDept(e.target.value)}><option value="">All departments</option>{depts.data?.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select>}
          </Field>
        </div>
      )}
      {!current ? (
        <Card><EmptyState title="You're all caught up"
          description={dept && list.data?.length ? "Nothing left in this department. Choose All departments to see the rest." : skipped.length ? `${skipped.length} skipped suggestion(s) will return next time.` : "New suggestions appear after the next harvest."} /></Card>
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
                {can.admin(user?.role) && <Button variant="ghost" onClick={() => setReassigning(current)}><UserCog /> Reassign…</Button>}
              </div>
            </CardContent>
          </Card>
        </>
      )}
      {can.admin(user?.role) && <ReassignDialog suggestion={reassigning} onClose={() => setReassigning(null)} />}
    </>
  );
}

export default function ReviewQueue() {
  const { user } = useAuth();
  const [sp, setSp] = useSearchParams();
  const hasSuggestions = !!user && roleSets.claimants.includes(user.role);
  const tabs: { id: Tab; label: string }[] = [...(hasSuggestions ? [{ id: "suggestions" as const, label: "Suggestions" }] : []), { id: "disputes", label: "Disputes" }];
  const tab: Tab = tabs.some((t) => t.id === sp.get("tab")) ? (sp.get("tab") as Tab) : tabs[0].id;
  return (
    <div className="max-w-3xl">
      <PageHeader eyebrow="Verification" title="Review queue"
        description={tab === "suggestions" ? "Only confirmed publications count in official reports. Keyboard: Y confirm · N not mine · S skip." : "An author can dispute a record that lists them. A reviewer decides; nothing changes until then."} />
      <div className="mb-6 flex flex-wrap gap-1 rounded-2xl border bg-card p-1" role="tablist" aria-label="Review sections">
        {tabs.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setSp({ tab: t.id }, { replace: true })}
            className={cn("rounded-xl px-4 py-2 text-sm font-semibold transition-colors", tab === t.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary")}>{t.label}</button>
        ))}
      </div>
      {tab === "suggestions" ? <SuggestionsPanel /> : <DisputesPanel />}
    </div>
  );
}
