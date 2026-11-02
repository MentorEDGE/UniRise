import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { HttpError } from "@/lib/http";
import type { OrgUnit, OrgUnitType } from "@/lib/types";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form";
import { Skeleton } from "@/components/ui/feedback";
import { ConfirmDialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";

const childType: Record<OrgUnitType, OrgUnitType | null> = { institution: "school", school: "department", department: "group", group: null };

/** Flatten the tree depth-first so each row knows its indent. */
function flatten(units: OrgUnit[], parentId?: number, depth = 0): { unit: OrgUnit; depth: number }[] {
  return units.filter((u) => u.parentId === parentId).flatMap((u) => [{ unit: u, depth }, ...flatten(units, u.id, depth + 1)]);
}

// shortcut: no move/re-parent yet; add it when the API supports changing parent_id.
export default function Organisation() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const units = useQuery({ queryKey: ["org-units"], queryFn: api.orgUnits });
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState<number | "">("");
  const [renaming, setRenaming] = useState<{ id: number; name: string } | null>(null);
  const [del, setDel] = useState<OrgUnit | null>(null);
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
      <PageHeader eyebrow="Directory" title="Organisation" description="Institution, schools, departments and research groups. Reports roll up this tree. A unit can be deleted once nothing sits under it." />
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
              <Button variant="ghost" size="icon" aria-label={`Rename ${unit.name}`} onClick={() => setRenaming({ id: unit.id, name: unit.name })}><Pencil /></Button>
              {unit.type !== "institution" && <Button variant="ghost" size="icon" aria-label={`Delete ${unit.name}`} onClick={() => setDel(unit)}><Trash2 /></Button>}
            </>)}
          </li>))}
      </ul></Card>
      <ConfirmDialog open={del !== null} onClose={() => setDel(null)} onConfirm={() => del && remove.mutate(del.id)} loading={remove.isPending}
        title={`Delete ${del?.name ?? "unit"}?`} description="This is only possible when no people or child units belong to it." />
    </div>
  );
}
