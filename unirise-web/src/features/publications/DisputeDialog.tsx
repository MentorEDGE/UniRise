import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { HttpError } from "@/lib/http";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";

const schema = z.object({
  reason: z.string().trim().min(10, "Explain in at least 10 characters").max(1000, "Keep it under 1,000 characters"),
});
type Values = z.infer<typeof schema>;

export const textareaClass = "min-h-28 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground aria-[invalid=true]:border-destructive disabled:opacity-50";

/** An author disputes their own listed authorship (PRD R30). A reviewer decides; nothing changes until then. */
export function DisputeDialog({ open, onClose, publicationId, title }: { open: boolean; onClose: () => void; publicationId: number; title: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { reason: "" } });
  const raise = useMutation({
    mutationFn: (v: Values) => api.raiseDispute({ publicationId, reason: v.reason }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["disputes"] });
      toast({ tone: "ok", message: "Dispute sent to the research office. You can follow its status here." });
      form.reset();
      onClose();
    },
    onError: (e) => {
      if (e instanceof HttpError && e.status === 409) form.setError("reason", { message: "You already have an open dispute for this record." });
      else if (e instanceof HttpError && e.status === 400) form.setError("reason", { message: "Use between 10 and 1,000 characters." });
      else toast({ tone: "error", message: "Couldn't send the dispute. Try again." });
    },
  });
  const err = form.formState.errors.reason?.message;
  return (
    <Dialog open={open} onClose={onClose} title="Dispute my authorship" description={`You are saying you are not an author of "${title}". A reviewer will decide; the record does not change until then.`}>
      <form onSubmit={form.handleSubmit((v) => raise.mutate(v))} className="space-y-4" noValidate>
        <Field label="Why do you dispute it?" error={err} hint="For example: a namesake wrote it, or the record lists the wrong person.">
          {(a) => <textarea {...a} {...form.register("reason")} className={textareaClass} />}
        </Field>
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={raise.isPending}>Send dispute</Button>
        </div>
      </form>
    </Dialog>
  );
}
