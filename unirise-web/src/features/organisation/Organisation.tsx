import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileUp, MoveRight, Pencil, Plus, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { HttpError } from "@/lib/http";
import type { OrgUnit, OrgUnitType } from "@/lib/types";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form";
import { ErrorBanner, Skeleton } from "@/components/ui/feedback";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/form";
import { ImportDialog } from "@/features/people/ImportDialog";
import { useToast } from "@/components/ui/toast";

const childType: Record<OrgUnitType, OrgUnitType | null> = { institution: "school", school: "department", department: "group", group: null };

/** Flatten the tree depth-first so each row knows its indent. */
function flatten(units: OrgUnit[], parentId?: number, depth = 0): { unit: OrgUnit; depth: number }[] {
  return units.filter((u) => u.parentId === parentId).flatMap((u) => [{ unit: u, depth }, ...flatten(units, u.id, depth + 1)]);
}

/** The parent type each unit type must sit under (R23). */
const parentType: Record<OrgUnitType, OrgUnitType | null> = { institution: null, school: "institution", department: "school", group: "department" };

function MoveDialog({ unit, units, onClose }: { unit: OrgUnit | null; units: OrgUnit[]; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [target, setTarget] = useState<number | "">("");
  const [touched, setTouched] = useState(false);
  const wanted = unit ? parentType[unit.type] : null;
  const options = flatten(units, undefined).filter((r) => r.unit.type === wanted && r.unit.id !== unit?.parentId);
  const move = useMutation({
    mutationFn: () => api.moveOrgUnit({ id: unit!.id, newParentId: target as number }),
    onSuccess: () => {
      for (const k of ["org-units", "departments", "summary", "researchers"]) qc.invalidateQueries({ queryKey: [k] });
      toast({ tone: "ok", message: `${unit!.name} moved. Reports now roll it up under its new parent.` });
      close();
    },
    onError: (e) => toast({ tone: "error", message: e instanceof HttpError && e.status === 409 ? "A unit can't be moved under itself or one of its own children." : e instanceof HttpError && e.status === 400 ? "That parent isn't allowed for this kind of unit." : "Couldn't move the unit. Try again." }),
  });
  const close = () => { setTarget(""); setTouched(false); onClose(); };
  const error = touched && target === "" ? "Choose the new parent" : undefined;
  return (
    <Dialog open={unit !== null} onClose={close} title={`Move ${unit?.name ?? "unit"}`}
      description={wanted ? `A ${unit?.type} sits under a ${wanted}. Its people and child units move with it, and reports roll up under the new parent from now on.` : undefined}>
      <form className="space-y-4" noValidate onSubmit={(e) => { e.preventDefault(); setTouched(true); if (target !== "") move.mutate(); }}>
        <Field label={`New ${wanted ?? "parent"}`} error={error} hint={options.length === 0 ? `There is no other ${wanted} to move it to.` : undefined}>
          {(a) => <Select {...a} value={target} onChange={(e) => setTarget(e.target.value ? Number(e.target.value) : "")}>
            <option value="">Select…</option>
            {options.map((r) => <option key={r.unit.id} value={r.unit.id}>{r.unit.name}</option>)}
          </Select>}
        </Field>
        <div className="flex justify-end gap-3 pt-2"><Button variant="secondary" onClick={close}>Cancel</Button><Button type="submit" loading={move.isPending} disabled={options.length === 0}>Move</Button></div>
      </form>
    </Dialog>
  );
}

export default function Organisation() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const units = useQuery({ queryKey: ["org-units"], queryFn: api.orgUnits });
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState<number | "">("");
  const [renaming, setRenaming] = useState<{ id: number; name: string } | null>(null);
  const [del, setDel] = useState<OrgUnit | null>(null);
  const [moving, setMoving] = useState<OrgUnit | null>(null);
  const [importing, setImporting] = useState(false);
  const invalidate = () => { qc.invalidateQueries({ queryKey: ["org-units"] }); qc.invalidateQueries({ queryKey: ["departments"] }); qc.invalidateQueries({ queryKey: ["summary"] }); };

  const rows = flatten(units.data ?? [], undefined);
  const parents = rows.filter((r) => childType[r.unit.type]);
  const parent = units.data?.find((u) => u.id === parentId);
  const type = parent ? childType[parent.type] : null;

  const create = useMutation({
    mutationFn: () => api.createOrgUnit(name.trim(), parent!.id, type!),
    onSuccess: () => { setName(""); invalidate(); toast({ tone: "ok", message: "Unit added." }); },
    onError: () => toast({ tone: "error", message: "Couldn't add the unit. Try again." }),
  });
  const rename = useMutation({ mutationFn: () => api.renameOrgUnit(renaming!.id, renaming!.name.trim()), onSuccess: () => { setRenaming(null); invalidate(); } });
  const remove = useMutation({
    mutationFn: (id: number) => api.deleteOrgUnit(id),
    onSuccess: () => { setDel(null); invalidate(); toast({ tone: "ok", message: "Unit deleted." }); },
    onError: (e) => { setDel(null); toast({ tone: "error", message: e instanceof HttpError && e.status === 409 ? "Can't delete: people or child units still belong to this unit." : "Couldn't delete." }); },
  });

  return (
    <div className="max-w-3xl">
      <PageHeader eyebrow="Directory" title="Organisation" description="Institution, schools, departments and research groups. Reports roll up this tree. A unit can be deleted once nothing sits under it."
        actions={<Button variant="secondary" onClick={() => setImporting(true)}><FileUp /> Import CSV</Button>} />
      {units.isError && <div className="mb-4"><ErrorBanner error={units.error} onRetry={() => units.refetch()} /></div>}
      <Card><CardHeader><CardTitle>Add unit</CardTitle><CardDescription>Choose where it goes; its type follows from the parent.</CardDescription></CardHeader>
        <CardContent>
          <form className="grid gap-3 sm:grid-cols-[1fr_2fr_auto]" onSubmit={(e) => { e.preventDefault(); if (name.trim() && parent && type) create.mutate(); }}>
            <Select aria-label="Parent unit" value={parentId} onChange={(e) => setParentId(e.target.value ? Number(e.target.value) : "")}>
              <option value="">Parent unit…</option>
              {parents.map((r) => <option key={r.unit.id} value={r.unit.id}>{"— ".repeat(r.depth)}{r.unit.name}</option>)}
            </Select>
            <Input aria-label="Unit name" placeholder={type ? `New ${type} name` : "Unit name"} value={name} onChange={(e) => setName(e.target.value)} />
            <Button type="submit" loading={create.isPending} disabled={!name.trim() || !type}><Plus /> Add</Button>
          </form>
        </CardContent></Card>

      <Card className="mt-6 overflow-hidden"><ul className="divide-y">
        {units.isLoading && <li className="p-6"><Skeleton className="h-8" /></li>}
        {rows.map(({ unit, depth }) => (
          <li key={unit.id} className="flex items-center gap-3 py-3 pr-4" style={{ paddingLeft: `${1.5 + depth * 1.5}rem` }}>
            {renaming?.id === unit.id ? (
              <form className="flex flex-1 gap-2" onSubmit={(e) => { e.preventDefault(); rename.mutate(); }}>
                <Input aria-label="New name" autoFocus value={renaming.name} onChange={(e) => setRenaming({ id: unit.id, name: e.target.value })} />
                <Button type="submit" size="sm" loading={rename.isPending}>Save</Button><Button size="sm" variant="secondary" onClick={() => setRenaming(null)}>Cancel</Button>
              </form>
            ) : (<>
              <span className="flex-1 font-medium">{unit.name}</span>
              <Badge className="border-violet-200 bg-violet-50 capitalize text-violet-700 dark:border-white/10 dark:bg-white/5 dark:text-violet-300">{unit.type}</Badge>
              {unit.type !== "institution" && <Button variant="ghost" size="icon" aria-label={`Move ${unit.name}`} onClick={() => setMoving(unit)}><MoveRight /></Button>}
              <Button variant="ghost" size="icon" aria-label={`Rename ${unit.name}`} onClick={() => setRenaming({ id: unit.id, name: unit.name })}><Pencil /></Button>
              {unit.type !== "institution" && <Button variant="ghost" size="icon" aria-label={`Delete ${unit.name}`} onClick={() => setDel(unit)}><Trash2 /></Button>}
            </>)}
          </li>))}
      </ul></Card>
      <MoveDialog unit={moving} units={units.data ?? []} onClose={() => setMoving(null)} />
      <ImportDialog kind="org-units" open={importing} onClose={() => setImporting(false)} />
      <ConfirmDialog open={del !== null} onClose={() => setDel(null)} onConfirm={() => del && remove.mutate(del.id)} loading={remove.isPending}
        title={`Delete ${del?.name ?? "unit"}?`} description="This is only possible when no people or child units belong to it." />
    </div>
  );
}
