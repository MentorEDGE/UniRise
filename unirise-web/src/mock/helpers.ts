import { db } from "./store";
import { HttpError } from "@/lib/http";
import { demoUsers } from "./store";
import type { AccessLogEntry, Researcher, Role, User } from "@/lib/types";

export const wait = <T,>(v: T, ms = 220) => new Promise<T>((r) => setTimeout(() => r(v), ms));
export const SESSION_KEY = "rms-demo-session"; // demo only; real auth uses a HttpOnly cookie
export const today = () => new Date().toISOString().slice(0, 10);
export const nowIso = () => new Date().toISOString().slice(0, 19);

export const mockUser = (): User | null => {
  const k = sessionStorage.getItem(SESSION_KEY);
  return k ? demoUsers[k] ?? null : null;
};

/** Org units under (and including) rootId. */
export function subtree(rootId: number): Set<number> {
  const ids = new Set([rootId]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const x of db.orgUnits) if (x.parentId !== undefined && ids.has(x.parentId) && !ids.has(x.id)) { ids.add(x.id); grew = true; }
  }
  return ids;
}

/** A role grant counts only while it is valid; this is what makes acting and delegated roles expire. */
export const grantIsActive = (g: { validFrom: string; validTo?: string }, on = today()) => g.validFrom <= on && (!g.validTo || g.validTo >= on);

/**
 * Researcher ids the user may see; null = everyone in the tenant.
 * Dean/HoD: their org subtree. Supervisor: self and mentees. Researcher/scholar: self only.
 * IT admin, guest and platform operator see no research people at all.
 */
export function scopeIds(u: User | null): Set<number> | null {
  if (!u) return new Set();
  if (u.role === "DEAN" || u.role === "HOD") {
    const units = subtree(u.scopeUnitId!);
    return new Set(db.researchers.filter((r) => units.has(r.departmentId)).map((r) => r.id));
  }
  if (u.role === "SUPERVISOR") return new Set([u.researcherId!, ...db.relationships.filter((x) => x.mentorId === u.researcherId).map((x) => x.menteeId)]);
  if (u.role === "RESEARCHER") return new Set(u.researcherId ? [u.researcherId] : []);
  if (u.role === "IT_ADMIN" || u.role === "GUEST" || u.role === "PLATFORM_ADMIN") return new Set();
  return null;
}

export function scopeResearchers(u: User | null): Researcher[] {
  const ids = scopeIds(u);
  return ids ? db.researchers.filter((r) => ids.has(r.id)) : db.researchers;
}

export function canSee(u: User | null, id: number) {
  if (!u) return false;
  const ids = scopeIds(u);
  return !ids || ids.has(id);
}

/** Roles that never see research content (PRD R3: IT admin manages access only). */
export const noResearchContent = (r?: Role) => r === "IT_ADMIN" || r === "PLATFORM_ADMIN" || r === "GUEST";

export function requireRole(u: User | null, roles: Role[]) {
  if (!u) throw new HttpError(401);
  if (!roles.includes(u.role)) throw new HttpError(403);
  return u;
}

export function audit(action: string, entity: string, entityId?: number | string, detail?: string) {
  const u = mockUser();
  db.auditLog.unshift({ id: db.nextId.audit++, at: nowIso(), actor: u?.email ?? "system", action, entity, entityId, detail });
}

export function logAccess(entry: Omit<AccessLogEntry, "id" | "at" | "actor" | "role">) {
  const u = mockUser();
  if (!u) return;
  db.accessLog.unshift({ id: db.nextId.access++, at: nowIso(), actor: u.email, role: u.role, ...entry });
}

/** Appointment-based credit (PRD R29): the units a person belonged to on a date. Falls back to the primary department. */
export function unitsOn(researcherId: number, date: string): number[] {
  const rows = db.appointments.filter((a) => a.researcherId === researcherId && a.validFrom <= date && (!a.validTo || a.validTo >= date));
  if (rows.length) return rows.map((a) => a.unitId);
  const r = db.researchers.find((x) => x.id === researcherId);
  return r ? [r.departmentId] : [];
}

/** Publication date used for credit: the publish month when known, else mid-year. */
export const publicationDate = (p: { year: number; month?: number }) => `${p.year}-${String(p.month ?? 7).padStart(2, "0")}-15`;
