import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Download, FileUp } from "lucide-react";
import { api } from "@/lib/api";
import { HttpError } from "@/lib/http";
import type { ImportPreview } from "@/lib/types";
import type { ImportKind } from "@/mock/ext/people";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Field, Input } from "@/components/ui/form";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { MAX_IMPORT_BYTES, MAX_IMPORT_ROWS, ORG_UNIT_COLUMNS, PEOPLE_COLUMNS, TEMPLATES, downloadText } from "./csv";

const copy: Record<ImportKind, { title: string; noun: string; columns: string[]; file: string }> = {
  people: { title: "Import people from CSV", noun: "people", columns: PEOPLE_COLUMNS, file: "people-template.csv" },
  "org-units": { title: "Import organisation units from CSV", noun: "units", columns: ORG_UNIT_COLUMNS, file: "organisation-template.csv" },
};

function problemText(e: unknown) {
  const s = e instanceof HttpError ? e.status : 0;
  if (s === 413) return `That file is too large. The limit is ${MAX_IMPORT_ROWS.toLocaleString()} rows and ${MAX_IMPORT_BYTES / 1024 / 1024} MB.`;
  if (s === 400) return "We couldn't read that file. Check that it is a CSV with a header row containing the required columns.";
  if (s === 403) return "Only the research office can import data.";
  return "Something went wrong. Please try again.";
}

/** Choose a CSV, preview what would change row by row, then commit. Shared by People and Organisation. */
export function ImportDialog({ kind, open, onClose }: { kind: ImportKind; open: boolean; onClose: () => void }) {
  const c = copy[kind];
  const qc = useQueryClient();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState<string>();
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<ImportPreview>();
  const [problem, setProblem] = useState<string>();
  const [skip, setSkip] = useState(false);

  const reset = () => { setText(undefined); setFileName(""); setPreview(undefined); setProblem(undefined); setSkip(false); if (fileRef.current) fileRef.current.value = ""; };
  const close = () => { reset(); onClose(); };

  const run = useMutation({
    mutationFn: (csv: string) => api.importPreview(kind, csv),
    onSuccess: (p) => { setPreview(p); setProblem(undefined); },
    onError: (e) => { setPreview(undefined); setProblem(problemText(e)); },
  });
  const commit = useMutation({
    mutationFn: () => api.importCommit(kind, text!, skip),
    onSuccess: (r) => {
      for (const k of ["researchers", "org-units", "departments", "summary", "directory"]) qc.invalidateQueries({ queryKey: [k] });
      toast({ tone: "ok", message: `Import finished: ${r.created} added, ${r.updated} updated, ${r.skipped} skipped.` });
      close();
    },
    onError: (e) => setProblem(problemText(e)),
  });

  const pick = async (f?: File) => {
    setPreview(undefined); setProblem(undefined); setSkip(false);
    if (!f) { setText(undefined); setFileName(""); return; }
    if (f.size > MAX_IMPORT_BYTES) { setText(undefined); setFileName(f.name); setProblem(problemText(new HttpError(413))); return; }
    const csv = await f.text();
    setText(csv); setFileName(f.name);
    run.mutate(csv);
  };

  const blocked = !!preview && preview.failed > 0 && !skip;
  const nothing = !!preview && preview.creates + preview.updates === 0;
  const cols = c.columns;

  return (
    <Dialog open={open} onClose={close} title={c.title} className="w-[min(94vw,56rem)]"
      description={`Columns: ${cols.join(", ")}. Re-running a file is safe: rows that match someone already on record update them.`}>
      <div className="space-y-4">
        <div className="grid items-end gap-3 sm:grid-cols-[1fr_auto]">
          <Field label="CSV file" hint={`Up to ${MAX_IMPORT_ROWS.toLocaleString()} rows and ${MAX_IMPORT_BYTES / 1024 / 1024} MB.`}>
            {(a) => <Input {...a} ref={fileRef} type="file" accept=".csv,text/csv" onChange={(e) => void pick(e.target.files?.[0])} />}
          </Field>
          <Button variant="secondary" onClick={() => downloadText(c.file, TEMPLATES[kind])}><Download /> Download template</Button>
        </div>

        {problem && <div role="alert" className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm"><AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden /><span>{problem}</span></div>}
        {run.isPending && <p className="text-sm text-muted-foreground" role="status">Checking {fileName}…</p>}

        {preview && (<>
          <div className="flex flex-wrap items-center gap-2 text-sm" role="status">
            <Badge className="border-success/30 bg-success/10 text-success"><CheckCircle2 className="size-3.5" aria-hidden />{preview.creates} to add</Badge>
            <Badge className="border-violet-200 bg-violet-50 text-violet-700 dark:border-white/10 dark:bg-white/5 dark:text-violet-300">{preview.updates} to update</Badge>
            <Badge className={preview.failed ? "border-destructive/30 bg-destructive/10 text-destructive" : "border-border bg-muted text-muted-foreground"}>
              {preview.failed > 0 && <AlertTriangle className="size-3.5" aria-hidden />}{preview.failed} with errors
            </Badge>
            <span className="text-muted-foreground">of {preview.rows.length} rows in {fileName}</span>
          </div>

          <div className="max-h-72 overflow-auto rounded-xl border">
            <Table>
              <THead><tr><TH>Line</TH><TH>Result</TH>{cols.slice(0, kind === "people" ? 4 : 3).map((k) => <TH key={k} className="capitalize">{k}</TH>)}<TH>Problems</TH></tr></THead>
              <TBody>{preview.rows.map((r) => (
                <TR key={r.line}>
                  <TD>{r.line}</TD>
                  <TD>{r.errors.length ? <Badge className="border-destructive/30 bg-destructive/10 text-destructive"><AlertTriangle className="size-3.5" aria-hidden />Error</Badge>
                    : <Badge className={r.action === "create" ? "border-success/30 bg-success/10 text-success" : "border-border bg-muted text-muted-foreground"}>{r.action === "create" ? "Add" : r.action === "update" ? "Update" : "No change"}</Badge>}</TD>
                  {cols.slice(0, kind === "people" ? 4 : 3).map((k) => <TD key={k}>{r.values[k] || <span className="text-muted-foreground">—</span>}</TD>)}
                  <TD className="text-xs">{r.errors.length ? <ul className="list-disc space-y-0.5 pl-4 text-destructive">{r.errors.map((m) => <li key={m}>{m}</li>)}</ul> : <span className="text-muted-foreground">—</span>}</TD>
                </TR>))}</TBody>
            </Table>
          </div>

          {preview.failed > 0 && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="size-4 accent-[hsl(var(--primary))]" checked={skip} onChange={(e) => setSkip(e.target.checked)} />
              Skip the {preview.failed} {preview.failed === 1 ? "row" : "rows"} with errors and import the rest
            </label>)}
          {nothing && <p className="text-sm text-muted-foreground">Nothing in this file can be imported yet. Fix the errors in your spreadsheet and choose the file again.</p>}
        </>)}

        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" onClick={close}>Cancel</Button>
          <Button onClick={() => commit.mutate()} loading={commit.isPending} disabled={!preview || blocked || nothing}><FileUp /> Import {preview ? preview.creates + preview.updates : ""} {c.noun}</Button>
        </div>
      </div>
    </Dialog>
  );
}
