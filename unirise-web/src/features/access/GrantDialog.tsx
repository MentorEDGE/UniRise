import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { api } from "@/lib/api";
import { HttpError } from "@/lib/http";
import { useAuth } from "@/app/auth";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { GRANTABLE_ROLES, SCOPED_ROLES, kindLabel, roleLabel, type GrantKind } from "./types";
import type { Role } from "@/lib/types";

const OTHER = "other";
const schema = z.object({
  person: z.string().min(1, "Choose a person, or enter a name"),
  otherName: z.string().trim().optional(),
  role: z.string().min(1, "Choose a role"),
  kind: z.enum(["direct", "acting", "delegated"]),
  scopeUnitId: z.string().optional(),
  validFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a start date"),
  validTo: z.string().optional(),
  note: z.string().trim().max(200, "Keep the note under 200 characters").optional(),
}).superRefine((v, ctx) => {
  if (v.person === OTHER && !v.otherName) ctx.addIssue({ code: "custom", path: ["otherName"], message: "Enter the person's name" });
  if (SCOPED_ROLES.includes(v.role as Role) && !v.scopeUnitId) ctx.addIssue({ code: "custom", path: ["scopeUnitId"], message: "Choose the unit this role covers" });
  if (v.kind !== "direct" && !v.validTo) ctx.addIssue({ code: "custom", path: ["validTo"], message: "Acting and delegated roles need an end date" });
  if (v.validTo && v.validTo < v.validFrom) ctx.addIssue({ code: "custom", path: ["validTo"], message: "The end date can't be before the start date" });
});
type Values = z.infer<typeof schema>;

const today = () => new Date().toISOString().slice(0, 10);

/**
 * One form for both flows. mode "role": a research or IT administrator grants a role (direct, or acting and delegated too).
 * mode "acting": covering for someone, always with an end date.
 */
export function GrantDialog({ open, onClose, mode }: { open: boolean; onClose: () => void; mode: "role" | "acting" }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();
  const isIt = user?.role === "IT_ADMIN";
  const own = user?.role === "HOD" || user?.role === "DEAN";
  const people = useQuery({ queryKey: ["directory"], queryFn: api.directory, enabled: open });
  const units = useQuery({ queryKey: ["org-units"], queryFn: api.orgUnits, enabled: open });

  const roles: Role[] = isIt ? ["IT_ADMIN"] : own ? [user!.role] : mode === "acting" ? ["HOD", "DEAN"] : GRANTABLE_ROLES;
  const kinds: GrantKind[] = mode === "acting" ? ["acting", "delegated"] : isIt ? ["direct"] : ["direct", "acting", "delegated"];
  const defaults = useMemo<Values>(() => ({
    person: "", otherName: "", role: roles[0] === "RESEARCH_ADMIN" && mode === "role" ? "" : roles[0], kind: kinds[0], scopeUnitId: own && user?.scopeUnitId ? String(user.scopeUnitId) : "",
    validFrom: today(), validTo: "", note: "",
  }), [open]);
  const form = useForm<Values>({ resolver: zodResolver(schema) as never, values: defaults });
  const e = form.formState.errors;
  const role = form.watch("role") as Role;
  const person = form.watch("person");
  const kind = form.watch("kind");

  const save = useMutation({
    mutationFn: (v: Values) => {
      const r = person === OTHER ? undefined : people.data?.find((x) => x.id === Number(v.person));
      return api.grantRole({
        holder: person === OTHER ? v.otherName! : r?.name ?? "", researcherId: r?.id, role: v.role as Role, kind: v.kind,
        scopeUnitId: SCOPED_ROLES.includes(v.role as Role) ? Number(v.scopeUnitId) : undefined,
        validFrom: v.validFrom, validTo: v.validTo || undefined, note: v.note || undefined,
      });
    },
    onSuccess: () => {
      for (const k of ["role-grants", "access-review", "users", "audit-log"]) qc.invalidateQueries({ queryKey: [k] });
      toast({ tone: "ok", message: mode === "acting" ? "Acting or delegated role recorded." : "Role granted." });
      onClose();
    },
    onError: (err) => toast({
      tone: "error",
      message: err instanceof HttpError && err.status === 403 ? "You can't grant that role or scope, or it would end after your own role does."
        : err instanceof HttpError && err.status === 400 ? "Check the person, scope and dates, then try again." : "Couldn't save. Try again.",
    }),
  });

  return (
    <Dialog open={open} onClose={onClose} title={mode === "acting" ? "Appoint an acting or delegated role" : "Grant a role"}
      description={mode === "acting" ? "Cover for someone for a set period. The role ends on the date you choose." : "Access comes from a role grant with a scope and dates. A job title alone gives none."}>
      <form onSubmit={form.handleSubmit((v) => save.mutate(v))} className="space-y-4" noValidate>
        <Field label="Person" error={e.person?.message}>
          {(a) => <Select {...a} {...form.register("person")}>
            <option value="">Select…</option>
            {people.data?.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            {!own && <option value={OTHER}>Someone not in the list…</option>}
          </Select>}
        </Field>
        {person === OTHER && <Field label="Name" error={e.otherName?.message}>{(a) => <Input {...a} {...form.register("otherName")} />}</Field>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Role" error={e.role?.message}>
            {(a) => <Select {...a} {...form.register("role")} disabled={roles.length === 1}>
              {roles.length > 1 && <option value="">Select…</option>}
              {roles.map((r) => <option key={r} value={r}>{roleLabel[r]}</option>)}
            </Select>}
          </Field>
          <Field label="Type of grant" error={e.kind?.message}>
            {(a) => <Select {...a} {...form.register("kind")} disabled={kinds.length === 1}>{kinds.map((k) => <option key={k} value={k}>{kindLabel[k]}</option>)}</Select>}
          </Field>
        </div>
        {SCOPED_ROLES.includes(role) && (
          <Field label="Covers" error={e.scopeUnitId?.message} hint="The role sees this unit and everything under it.">
            {(a) => <Select {...a} {...form.register("scopeUnitId")}>
              <option value="">Select…</option>
              {units.data?.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.type})</option>)}
            </Select>}
          </Field>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Starts on" error={e.validFrom?.message}>{(a) => <Input {...a} type="date" {...form.register("validFrom")} />}</Field>
          <Field label={kind === "direct" ? "Ends on (optional)" : "Ends on"} error={e.validTo?.message}
            hint={own ? "It can't end after your own role does." : kind === "direct" ? "Leave empty only if the role has no planned end." : undefined}>
            {(a) => <Input {...a} type="date" {...form.register("validTo")} />}
          </Field>
        </div>
        <Field label="Note (optional)" error={e.note?.message}>{(a) => <Input {...a} placeholder="Why, for example “covering study leave”" {...form.register("note")} />}</Field>
        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={save.isPending}>{mode === "acting" ? "Appoint" : "Grant role"}</Button>
        </div>
      </form>
    </Dialog>
  );
}
