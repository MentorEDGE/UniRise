import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { CheckCircle2, Clock, Flag, XCircle } from "lucide-react";
import { api } from "@/lib/api";
import { HttpError } from "@/lib/http";
import { can, useAuth } from "@/app/auth";
import { formatDate } from "@/lib/utils";
import type { Dispute } from "@/lib/types";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/form";
import { EmptyState, ErrorBanner, Skeleton } from "@/components/ui/feedback";
import { useToast } from "@/components/ui/toast";
import { textareaClass } from "@/features/publications/DisputeDialog";

const schema = z.object({
  outcome: z.enum(["upheld", "dismissed"], { message: "Choose an outcome" }),
  resolution: z.string().trim().min(5, "Explain the decision in at least 5 characters").max(1000, "Keep it under 1,000 characters"),
});
type Values = z.infer<typeof schema>;

/** Icon plus text, never colour alone. */
function DisputeBadge({ status }: { status: Dispute["status"] }) {
  const m = {
    open: { icon: Clock, label: "Open", cls: "border-warning/30 bg-warning/10 text-warning" },
    upheld: { icon: CheckCircle2, label: "Upheld: author removed", cls: "border-success/30 bg-success/10 text-success" },
    dismissed: { icon: XCircle, label: "Dismissed", cls: "border-border bg-muted text-muted-foreground" },
  }[status];
  const Icon = m.icon;
  return <Badge className={m.cls}><Icon className="size-3.5" aria-hidden />{m.label}</Badge>;
}

function ResolveDialog({ dispute, onClose }: { dispute: Dispute | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { resolution: "" } });
  const resolve = useMutation({
    mutationFn: (v: Values) => api.resolveDispute({ id: dispute!.id, outcome: v.outcome, resolution: v.resolution }),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ["disputes"] }); qc.invalidateQueries({ queryKey: ["publications"] }); qc.invalidateQueries({ queryKey: ["summary"] });
      toast({ tone: "ok", message: v.outcome === "upheld" ? "Upheld. The person was removed from the authors." : "Dismissed. The authorship stays." });
      form.reset(); onClose();
    },
    onError: (e) => {
      const s = e instanceof HttpError ? e.status : 0;
      toast({ tone: "error", message: s === 409 ? "Someone already resolved this dispute." : s === 403 ? "You can't resolve this dispute." : "Couldn't save the decision. Try again." });
      if (s === 409) qc.invalidateQueries({ queryKey: ["disputes"] });
    },
  });
  const outcome = form.watch("outcome");
  return (
    <Dialog open={!!dispute} onClose={onClose} title="Resolve authorship dispute" description={dispute ? `${dispute.researcherName} on "${dispute.publicationTitle}"` : undefined}>
      {dispute && (
        <form onSubmit={form.handleSubmit((v) => resolve.mutate(v))} className="space-y-4" noValidate>
          <blockquote className="rounded-xl bg-secondary/60 p-3 text-sm"><span className="text-xs uppercase tracking-wider text-muted-foreground">Their reason</span><br />{dispute.reason}</blockquote>
          <fieldset aria-describedby="outcome-err">
            <legend className="text-sm font-medium">Outcome</legend>
            <div className="mt-2 space-y-2 text-sm">
              <label className="flex items-start gap-2"><input type="radio" value="upheld" className="mt-1 accent-[hsl(var(--primary))]" {...form.register("outcome")} /><span><strong>Uphold</strong>: remove them from the authors. If no verified author is left, the record goes back to unverified.</span></label>
              <label className="flex items-start gap-2"><input type="radio" value="dismissed" className="mt-1 accent-[hsl(var(--primary))]" {...form.register("outcome")} /><span><strong>Dismiss</strong>: the authorship stays as it is.</span></label>
            </div>
            {form.formState.errors.outcome && <p id="outcome-err" className="mt-1 text-xs text-destructive">{form.formState.errors.outcome.message}</p>}
          </fieldset>
          <Field label="Decision note (shown to the person)" error={form.formState.errors.resolution?.message}>
            {(a) => <textarea {...a} {...form.register("resolution")} className={textareaClass} />}
          </Field>
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button type="submit" variant={outcome === "upheld" ? "destructive" : "primary"} loading={resolve.isPending}>{outcome === "upheld" ? "Uphold and remove author" : outcome === "dismissed" ? "Dismiss dispute" : "Save decision"}</Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}

/** Reviewers resolve disputes in their scope; everyone else sees the status of their own. */
export default function DisputesPanel() {
  const { user } = useAuth();
  const list = useQuery({ queryKey: ["disputes"], queryFn: api.disputes });
  const [resolving, setResolving] = useState<Dispute | null>(null);
  const reviewer = can.review(user?.role);

  if (list.isError) return <ErrorBanner error={list.error} onRetry={() => list.refetch()} />;
  if (list.isLoading) return <div className="space-y-3">{Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-24 w-full" />)}</div>;
  if (!list.data?.length) {
    return <Card><EmptyState icon={<Flag className="size-6" aria-hidden />} title={reviewer ? "No disputes to review" : "You have no disputes"}
      description={reviewer ? "When an author says a record wrongly lists them, it appears here for a decision." : "If a record lists you as an author by mistake, open it and choose Dispute my authorship."}
      action={!reviewer && <Link to="/publications" className="text-sm font-semibold text-primary hover:underline">Go to my publications</Link>} /></Card>;
  }
  const open = list.data.filter((d) => d.status === "open").length;
  return (
    <>
      <p className="mb-3 text-sm text-muted-foreground" aria-live="polite">{open} open · {list.data.length} in total</p>
      <ul className="space-y-3">
        {list.data.map((d) => (
          <li key={d.id}>
            <Card className="p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <Link to={`/publications/${d.publicationId}`} className="font-semibold hover:text-primary">{d.publicationTitle}</Link>
                  <p className="mt-0.5 text-xs text-muted-foreground">{reviewer ? `${d.researcherName} · ` : ""}raised {formatDate(d.raisedOn)}</p>
                </div>
                <DisputeBadge status={d.status} />
              </div>
              <p className="mt-3 text-sm"><span className="text-muted-foreground">Reason:</span> {d.reason}</p>
              {d.resolution && <p className="mt-1 text-sm"><span className="text-muted-foreground">Decision{d.resolvedBy ? ` by ${d.resolvedBy}` : ""}{d.resolvedOn ? ` on ${formatDate(d.resolvedOn)}` : ""}:</span> {d.resolution}</p>}
              {reviewer && d.status === "open" && <div className="mt-3"><Button size="sm" onClick={() => setResolving(d)}>Resolve…</Button></div>}
            </Card>
          </li>
        ))}
      </ul>
      <ResolveDialog dispute={resolving} onClose={() => setResolving(null)} />
    </>
  );
}
