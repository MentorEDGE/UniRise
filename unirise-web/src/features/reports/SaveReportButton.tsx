import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { BookmarkPlus } from "lucide-react";
import { api } from "@/lib/api";
import type { ReportParams } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";

/** Saves the report's slug and filters under a name so it can be run again from the Reports page. */
export function SaveReportButton({ slug, params, defaultName }: { slug: string; params: ReportParams; defaultName: string }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(defaultName);
  const qc = useQueryClient();
  const { toast } = useToast();
  const save = useMutation({
    mutationFn: () => api.saveReport({ name, slug, params }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["saved-reports"] }); setOpen(false); toast({ tone: "ok", message: "Saved. Find it on the Reports page." }); },
    onError: () => toast({ tone: "error", message: "Couldn't save this report. Check the name and try again." }),
  });
  const invalid = !name.trim() || name.length > 80;
  return (
    <>
      <Button variant="secondary" onClick={() => { setName(defaultName); setOpen(true); }}><BookmarkPlus /> Save this report</Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Save this report" description="Saves the report and its current filters, not the data. It is always run on today's figures.">
        <form onSubmit={(e) => { e.preventDefault(); if (!invalid) save.mutate(); }} className="space-y-4">
          <Field label="Name" error={name.length > 80 ? "Use 80 characters or fewer" : undefined}>{(a) => <Input {...a} value={name} onChange={(e) => setName(e.target.value)} autoFocus />}</Field>
          <div className="flex justify-end gap-3"><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" loading={save.isPending} disabled={invalid}>Save</Button></div>
        </form>
      </Dialog>
    </>
  );
}
