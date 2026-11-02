import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CheckCircle2, Download, Printer } from "lucide-react";
import { api } from "@/lib/api";
import { downloadCsv } from "@/lib/utils";
import type { ReportParams } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";

/**
 * Export runs as a job: the server prepares the file, the dialog polls it and then offers the download (PRD R18).
 * PDF is the browser's print view of the report page, labelled as such.
 */
export function ExportDialog({ open, onClose, slug, params, format, columns, rows }: {
  open: boolean; onClose: () => void; slug: string; params: ReportParams; format: "csv" | "pdf"; columns: string[]; rows: (string | number)[][];
}) {
  const [jobId, setJobId] = useState<string | null>(null);
  const started = useRef(false);
  const start = useMutation({ mutationFn: () => api.startExport({ slug, params, format }), onSuccess: (r) => setJobId(r.jobId) });
  const job = useQuery({
    queryKey: ["export-job", jobId],
    queryFn: () => api.exportJob(jobId!),
    enabled: !!jobId,
    refetchInterval: (q) => (q.state.data && (q.state.data.status === "done" || q.state.data.status === "failed") ? false : 400),
  });

  useEffect(() => {
    if (open && !started.current) { started.current = true; start.mutate(); }
    if (!open) { started.current = false; setJobId(null); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const done = job.data?.status === "done";
  const progress = job.data?.progress ?? 0;
  return (
    <Dialog open={open} onClose={onClose} title={format === "csv" ? "Export CSV" : "Print or save as PDF"} description="The file is prepared first, then you can download it. The export is recorded in the audit log.">
      <div className="space-y-4">
        {start.isError && <p role="alert" className="text-sm text-destructive">Couldn't start the export. Try again.</p>}
        {!done && !start.isError && (
          <div aria-live="polite">
            <div className="mb-2 flex justify-between text-sm"><span>{job.data?.status === "running" ? "Preparing the file" : "Queued"}</span><span className="font-semibold">{progress}%</span></div>
            <progress className="h-2 w-full overflow-hidden rounded-full [&::-moz-progress-bar]:bg-primary [&::-webkit-progress-bar]:bg-muted [&::-webkit-progress-value]:bg-primary" max={100} value={progress} aria-label="Export progress" />
          </div>
        )}
        {done && (
          <div className="space-y-3">
            <p className="flex items-center gap-2 text-sm font-medium"><CheckCircle2 className="size-5 text-success" aria-hidden />Ready: {job.data?.fileName}. It matches what is on screen.</p>
            {format === "csv"
              ? <Button onClick={() => { downloadCsv(job.data!.fileName ?? `${slug}.csv`, columns, rows); onClose(); }}><Download /> Download CSV</Button>
              : <Button onClick={() => { onClose(); setTimeout(() => window.print(), 150); }}><Printer /> Open print view</Button>}
            {format === "pdf" && <p className="text-xs text-muted-foreground">This opens your browser's print dialog. Choose "Save as PDF" as the destination.</p>}
          </div>
        )}
        <div className="flex justify-end"><Button variant="secondary" onClick={onClose}>Close</Button></div>
      </div>
    </Dialog>
  );
}
