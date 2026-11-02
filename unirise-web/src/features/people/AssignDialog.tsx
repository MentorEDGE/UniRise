import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { api } from "@/lib/api";
import { HttpError } from "@/lib/http";
import type { DirectoryEntry, RelationshipType } from "@/lib/types";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, Select } from "@/components/ui/form";
import { ErrorBanner } from "@/components/ui/feedback";
import { useToast } from "@/components/ui/toast";

export const relationshipLabel: Record<RelationshipType, string> = { primary: "Primary supervisor", co: "Co-supervisor", backup: "Backup supervisor" };

const schema = z.object({
  mentorId: z.coerce.number().int().positive("Choose a supervisor"),
  type: z.enum(["primary", "co", "backup"]),
});
type Values = z.infer<typeof schema>;

export function assignError(e: unknown) {
  const s = e instanceof HttpError ? e.status : 0;
  if (s === 409) return "That person already supervises this scholar.";
  if (s === 400) return "That person can't be assigned. Choose an active faculty member other than the scholar.";
  if (s === 403) return "You can only change supervision for scholars in your own unit.";
  return "Couldn't save the change. Try again.";
}

/** Pick an active faculty member and a relationship type for one scholar (R24). */
export function AssignDialog({ scholar, open, onClose, defaultType = "primary", title }: {
  scholar: DirectoryEntry | undefined; open: boolean; onClose: () => void; defaultType?: RelationshipType; title?: string;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const candidates = useQuery({ queryKey: ["mentor-candidates"], queryFn: api.mentorCandidates, enabled: open });
  const form = useForm<Values>({ resolver: zodResolver(schema) as never, values: { mentorId: 0, type: defaultType } });
  const type = form.watch("type");
  const save = useMutation({
    mutationFn: (v: Values) => api.assignSupervisor({ scholarId: scholar!.id, mentorId: v.mentorId, type: v.type }),
    onSuccess: () => {
      for (const k of ["supervision", "supervision-rows", "reassignments", "mentees"]) qc.invalidateQueries({ queryKey: [k] });
      toast({ tone: "ok", message: "Supervision updated." });
      onClose();
    },
    onError: (e) => toast({ tone: "error", message: assignError(e) }),
  });
  const e = form.formState.errors;
  return (
    <Dialog open={open} onClose={onClose} title={title ?? `Assign supervisor for ${scholar?.name ?? ""}`}
      description={type === "primary" ? "A new primary supervisor replaces the current one from today. Earlier history is kept." : undefined}>
      {candidates.isError && <div className="mb-3"><ErrorBanner error={candidates.error} onRetry={() => candidates.refetch()} /></div>}
      <form className="space-y-4" noValidate onSubmit={form.handleSubmit((v) => save.mutate(v))}>
        <Field label="Supervisor" error={e.mentorId?.message} hint="Only faculty who are currently active can be chosen.">
          {(a) => <Select {...a} disabled={candidates.isLoading} {...form.register("mentorId")}>
            <option value="">{candidates.isLoading ? "Loading…" : "Select…"}</option>
            {candidates.data?.filter((c) => c.id !== scholar?.id).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>}
        </Field>
        <Field label="Role" error={e.type?.message}>
          {(a) => <Select {...a} {...form.register("type")}>{(Object.keys(relationshipLabel) as RelationshipType[]).map((t) => <option key={t} value={t}>{relationshipLabel[t]}</option>)}</Select>}
        </Field>
        <div className="flex justify-end gap-3 pt-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={save.isPending}>Save</Button></div>
      </form>
    </Dialog>
  );
}
