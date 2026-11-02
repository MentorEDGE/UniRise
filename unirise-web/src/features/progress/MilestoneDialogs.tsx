import { useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/utils";
import type { MilestoneView } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { PROGRESS_KEYS, STAGE_SUGGESTIONS, Textarea, saveErrorMessage } from "./shared";

const MAX_FEEDBACK = 1000;

/** Runs a milestone change, refreshes everything that shows milestones and tells the person what happened. */
function useMilestoneAction<A>(run: (a: A) => Promise<unknown>, done: string, onClose: () => void) {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (a: A) => run(a),
    onSuccess: () => { PROGRESS_KEYS.forEach((k) => qc.invalidateQueries({ queryKey: [...k] })); toast({ message: done, tone: "ok" }); onClose(); },
    onError: (e) => toast({ message: saveErrorMessage(e), tone: "error" }),
  });
}

const addSchema = z.object({
  stage: z.string().trim().min(1, "Enter the stage name").max(80, "Use 80 characters or fewer"),
  dueDate: z.string().min(1, "Choose the due date").regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a valid date"),
});
type AddValues = z.infer<typeof addSchema>;

/** Add a milestone for a scholar. */
export function AddMilestoneDialog({ open, onClose, scholarId, scholarName }: { open: boolean; onClose: () => void; scholarId: number; scholarName: string }) {
  const form = useForm<AddValues>({ resolver: zodResolver(addSchema) as never, defaultValues: { stage: "", dueDate: "" } });
  useEffect(() => { if (open) form.reset({ stage: "", dueDate: "" }); }, [open, form]);
  const save = useMilestoneAction((v: AddValues) => api.createMilestone({ scholarId, ...v }), "Milestone added.", onClose);
  const errors = form.formState.errors;
  return (
    <Dialog open={open} onClose={onClose} title="Add milestone" description={`A new stage for ${scholarName}. They and you will get reminders as it falls due.`}>
      <form noValidate onSubmit={form.handleSubmit((v) => save.mutate(v))} className="space-y-4">
        <Field label="Stage" error={errors.stage?.message}>
          {(a) => (<>
            <Input {...a} list="stage-suggestions" maxLength={80} {...form.register("stage")} />
            <datalist id="stage-suggestions">{STAGE_SUGGESTIONS.map((s) => <option key={s} value={s} />)}</datalist>
          </>)}
        </Field>
        <Field label="Due date" error={errors.dueDate?.message}>{(a) => <Input type="date" {...a} {...form.register("dueDate")} />}</Field>
        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={save.isPending}>Add milestone</Button>
        </div>
      </form>
    </Dialog>
  );
}

const editSchema = z.object({
  dueDate: z.string().min(1, "Choose the due date").regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a valid date"),
});
type EditValues = z.infer<typeof editSchema>;

/** Change the due date of a stage that is not yet approved. */
export function EditDueDateDialog({ milestone, onClose }: { milestone?: MilestoneView; onClose: () => void }) {
  const form = useForm<EditValues>({ resolver: zodResolver(editSchema) as never, defaultValues: { dueDate: "" } });
  useEffect(() => { if (milestone) form.reset({ dueDate: milestone.dueDate }); }, [milestone, form]);
  const save = useMilestoneAction((v: EditValues) => api.updateMilestone({ id: milestone!.id, dueDate: v.dueDate }), "Due date updated.", onClose);
  return (
    <Dialog open={!!milestone} onClose={onClose} title="Edit due date" description={milestone ? `${milestone.stage}, currently due ${formatDate(milestone.dueDate)}.` : undefined}>
      <form noValidate onSubmit={form.handleSubmit((v) => save.mutate(v))} className="space-y-4">
        <Field label="New due date" error={form.formState.errors.dueDate?.message}>{(a) => <Input type="date" {...a} {...form.register("dueDate")} />}</Field>
        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={save.isPending}>Save due date</Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Confirm that a stage is finished. Used by the scholar and by the supervisor. */
export function MarkDoneDialog({ milestone, onClose }: { milestone?: MilestoneView; onClose: () => void }) {
  const save = useMilestoneAction((id: number) => api.completeMilestone(id), "Marked as done.", onClose);
  return (
    <Dialog open={!!milestone} onClose={onClose} title="Mark as done" description={milestone ? `Record "${milestone.stage}" as finished today. Your supervisor can then approve it.` : undefined}>
      <div className="mt-2 flex justify-end gap-3">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={() => milestone && save.mutate(milestone.id)} loading={save.isPending}>Mark as done</Button>
      </div>
    </Dialog>
  );
}

const approveSchema = z.object({ feedback: z.string().trim().max(MAX_FEEDBACK, `Use ${MAX_FEEDBACK} characters or fewer`) });
type ApproveValues = z.infer<typeof approveSchema>;

/** Approve a finished stage, with optional feedback addressed to the scholar. */
export function ApproveDialog({ milestone, scholarName, onClose }: { milestone?: MilestoneView; scholarName: string; onClose: () => void }) {
  const form = useForm<ApproveValues>({ resolver: zodResolver(approveSchema) as never, defaultValues: { feedback: "" } });
  useEffect(() => { if (milestone) form.reset({ feedback: milestone.feedback ?? "" }); }, [milestone, form]);
  const save = useMilestoneAction((v: ApproveValues) => api.approveMilestone({ id: milestone!.id, feedback: v.feedback || undefined }), "Milestone approved.", onClose);
  return (
    <Dialog open={!!milestone} onClose={onClose} title="Approve with feedback" description={milestone ? `${milestone.stage} for ${scholarName}. Your name and today's date are recorded.` : undefined}>
      <form noValidate onSubmit={form.handleSubmit((v) => save.mutate(v))} className="space-y-4">
        <Field label="Feedback for the scholar (optional)" hint={`Up to ${MAX_FEEDBACK} characters. The scholar sees this on their progress page.`} error={form.formState.errors.feedback?.message}>
          {(a) => <Textarea {...a} maxLength={MAX_FEEDBACK + 200} {...form.register("feedback")} />}
        </Field>
        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={save.isPending}>Approve</Button>
        </div>
      </form>
    </Dialog>
  );
}
