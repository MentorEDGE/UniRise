// Feature slice "people": sample-data (mock) and server (real) versions of its API calls. Keys must match between the two.
import { HttpError, http, qs } from "@/lib/http";
import { db } from "@/mock/store";
import { audit, canSee, mockUser, requireRole, scopeResearchers, subtree, today, wait } from "@/mock/helpers";
import { MAX_IMPORT_BYTES, MAX_IMPORT_ROWS, ORG_UNIT_COLUMNS, PEOPLE_COLUMNS, parseCsv } from "@/features/people/csv";
import { ORCID_RE } from "@/lib/utils";
import type {
  Appointment, Claim, DirectoryEntry, ImportPreview, ImportResult, ImportRow, OrgUnit, OrgUnitType, Page, Publication, ReassignmentItem, Relationship,
  RelationshipType, Researcher, SupervisionView, User,
} from "@/lib/types";

export type ImportKind = "people" | "org-units";
export type StatusFilter = "active" | "left" | "all";
export type AppointmentRow = Appointment & { unitName: string };
export type AppointmentInput = Omit<Appointment, "id"> & { id?: number };
/** One supervision relationship with both names, for the Supervision screen. */
export interface SupervisionRow { relationship: Relationship; scholar: DirectoryEntry; mentor: DirectoryEntry; mentorLeft: boolean }
export interface MarkLeftResult { researcher: Researcher; endedAppointments: number; endedRoleGrants: number }
export interface ConsentResult { publicProfile: boolean; /** False while the institution has the public profile site switched off. */ effective: boolean }

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const isIsoDate = (s: string) => ISO_DATE.test(s) && !Number.isNaN(Date.parse(s));
const norm = (s: string) => s.trim().toLowerCase();

const entry = (r: Researcher): DirectoryEntry => ({ id: r.id, name: r.name, title: r.title, departmentId: r.departmentId, kind: r.kind, employeeId: r.employeeId, rollNo: r.rollNo });
const person = (id: number) => db.researchers.find((r) => r.id === id);
const isScholar = (r: Researcher) => r.kind === "scholar";
const isLeft = (r?: Researcher) => r?.status === "left";

/**
 * A supervision relationship is active from validFrom and until validTo is reached: validTo is the first day it no longer applies,
 * so a new primary assigned today replaces the old one today and there is never a day with two primaries.
 */
const relActive = (x: Relationship, on = today()) => (!x.validFrom || x.validFrom <= on) && (!x.validTo || x.validTo > on);
const activeRels = () => db.relationships.filter((x) => relActive(x));

/** Dean or HoD whose unit subtree holds the scholar; the admin may act on anyone. */
function requireSupervisionScope(u: User | null, scholarId: number): User {
  requireRole(u, ["RESEARCH_ADMIN", "HOD", "DEAN"]);
  if (u!.role !== "RESEARCH_ADMIN") {
    const s = person(scholarId);
    if (!s || !u!.scopeUnitId || !subtree(u!.scopeUnitId).has(s.departmentId)) throw new HttpError(403);
  }
  return u!;
}

function needsReassignment(scholar: Researcher): { rel: Relationship; mentor: Researcher } | null {
  const rels = activeRels().filter((x) => x.menteeId === scholar.id);
  const primaries = rels.filter((x) => x.type === "primary");
  if (primaries.length === 0) return null;
  const working = (x: Relationship) => !isLeft(person(x.mentorId));
  if (primaries.some(working)) return null;
  if (rels.some((x) => x.type === "backup" && working(x))) return null;
  const rel = primaries[0];
  return { rel, mentor: person(rel.mentorId)! };
}

/* ------------------------------------ CSV import ------------------------------------ */
const unitByName = (name: string, type?: OrgUnitType) => db.orgUnits.filter((x) => norm(x.name) === norm(name) && (!type || x.type === type));
const allowedParent: Record<OrgUnitType, OrgUnitType | null> = { institution: null, school: "institution", department: "school", group: "department" };

function readCsv(kind: ImportKind, csv: string) {
  if (new TextEncoder().encode(csv).length > MAX_IMPORT_BYTES) throw new HttpError(413);
  const parsed = parseCsv(csv);
  if (parsed.unterminated) throw new HttpError(400);
  if (parsed.rows.length > MAX_IMPORT_ROWS) throw new HttpError(413);
  const header = parsed.header.map(norm);
  const required = kind === "people" ? ["name", "email", "title", "department"] : ORG_UNIT_COLUMNS;
  if (parsed.rows.length === 0 || required.some((c) => !header.includes(norm(c)))) throw new HttpError(400);
  const known = (kind === "people" ? PEOPLE_COLUMNS : ORG_UNIT_COLUMNS).map((c) => ({ key: c, at: header.indexOf(norm(c)) }));
  return parsed.rows.map((r) => ({
    line: r.line,
    values: Object.fromEntries(known.map((k) => [k.key, k.at >= 0 ? (r.cells[k.at] ?? "").trim() : ""])) as Record<string, string>,
  }));
}

function previewPeople(csv: string): ImportRow[] {
  const seenEmp = new Map<string, number>(), seenEmail = new Map<string, number>(), seenOrcid = new Map<string, number>();
  return readCsv("people", csv).map(({ line, values: v }): ImportRow => {
    const errors: string[] = [];
    if (!v.name) errors.push("Name is required.");
    if (!v.email) errors.push("Email is required."); else if (!EMAIL_RE.test(v.email)) errors.push("Email is not a valid address.");
    if (!v.title) errors.push("Title is required.");
    if (!v.department) errors.push("Department is required.");
    else {
      const d = unitByName(v.department, "department");
      if (d.length === 0) errors.push(`Department "${v.department}" does not exist.`);
      else if (d.length > 1) errors.push(`Department "${v.department}" is ambiguous.`);
    }
    if (v.orcid && !ORCID_RE.test(v.orcid)) errors.push("ORCID must look like 0000-0002-1825-0097.");
    if (v.kind && v.kind !== "faculty" && v.kind !== "scholar") errors.push('Kind must be "faculty" or "scholar".');

    const dup = (map: Map<string, number>, key: string, label: string) => {
      if (!key) return;
      const first = map.get(key);
      if (first !== undefined) errors.push(`${label} repeats line ${first} of this file.`); else map.set(key, line);
    };
    dup(seenEmp, norm(v.employeeId), "Employee ID");
    dup(seenEmail, norm(v.email), "Email");
    dup(seenOrcid, norm(v.orcid), "ORCID");

    // Re-running the same file is safe: a row that matches an existing person (employee ID, else email) updates them.
    const match = v.employeeId ? db.researchers.find((r) => r.employeeId && norm(r.employeeId) === norm(v.employeeId)) : v.email ? db.researchers.find((r) => norm(r.email) === norm(v.email)) : undefined;
    if (v.email && EMAIL_RE.test(v.email)) {
      const owner = db.researchers.find((r) => norm(r.email) === norm(v.email));
      if (owner && match && owner.id !== match.id) errors.push("This email belongs to a different person already on record.");
      if (owner && !match) errors.push("This email belongs to someone already on record; add their employee ID to update them.");
    }
    if (v.orcid && ORCID_RE.test(v.orcid)) {
      const owner = db.researchers.find((r) => r.orcid && norm(r.orcid) === norm(v.orcid));
      if (owner && owner.id !== match?.id) errors.push("This ORCID iD belongs to another person on record.");
    }
    return { line, values: v, errors, action: errors.length ? "skip" : match ? "update" : "create" };
  });
}

function previewOrgUnits(csv: string): ImportRow[] {
  const pending: OrgUnit[] = []; // units created by earlier valid rows of the same file
  const byName = (name: string, type?: OrgUnitType) => [...unitByName(name, type), ...pending.filter((x) => norm(x.name) === norm(name) && (!type || x.type === type))];
  const seen = new Map<string, number>();
  return readCsv("org-units", csv).map(({ line, values: v }): ImportRow => {
    const errors: string[] = [];
    let action: ImportRow["action"] = "skip";
    if (!v.name) errors.push("Name is required.");
    const type = norm(v.type) as OrgUnitType;
    if (!v.type) errors.push("Type is required.");
    else if (type === "institution") errors.push("An institution can't be imported; add schools, departments or groups under it.");
    else if (!["school", "department", "group"].includes(type)) errors.push('Type must be "school", "department" or "group".');
    let parent: OrgUnit | undefined;
    if (!v.parent) errors.push("Parent is required.");
    else {
      const found = byName(v.parent);
      if (found.length === 0) errors.push(`Parent "${v.parent}" does not exist (list parents before their children).`);
      else if (found.length > 1) errors.push(`Parent "${v.parent}" is ambiguous.`);
      else parent = found[0];
    }
    if (parent && allowedParent[type] && parent.type !== allowedParent[type]) errors.push(`A ${type} must sit under a ${allowedParent[type]}, not a ${parent.type}.`);
    if (!errors.length && parent) {
      const key = `${type}|${norm(v.name)}|${parent.id}`;
      const first = seen.get(key);
      const same = byName(v.name, type);
      if (first !== undefined) errors.push(`Repeats line ${first} of this file.`);
      else if (same.some((x) => x.parentId === parent!.id)) action = "skip"; // already there: nothing to do
      else if (same.length) errors.push(`A ${type} named "${v.name}" already exists under another parent; use Move on the Organisation page.`);
      else { action = "create"; pending.push({ id: -line, parentId: parent.id, type, name: v.name }); }
      seen.set(key, line);
    }
    return { line, values: v, errors, action: errors.length ? "skip" : action };
  });
}

function summarise(kind: ImportKind, rows: ImportRow[]): ImportPreview {
  const ok = rows.filter((r) => r.errors.length === 0);
  return { kind, rows, ok: ok.length, failed: rows.length - ok.length, creates: ok.filter((r) => r.action === "create").length, updates: ok.filter((r) => r.action === "update").length };
}
const previewOf = (kind: ImportKind, csv: string) => summarise(kind, kind === "people" ? previewPeople(csv) : previewOrgUnits(csv));

function commitPeople(rows: ImportRow[]) {
  for (const { values: v, action } of rows) {
    const dept = unitByName(v.department, "department")[0];
    const kind = v.kind === "scholar" ? "scholar" : "faculty";
    if (action === "update") {
      const r = (v.employeeId ? db.researchers.find((x) => x.employeeId && norm(x.employeeId) === norm(v.employeeId)) : db.researchers.find((x) => norm(x.email) === norm(v.email)))!;
      Object.assign(r, { name: v.name, email: v.email, title: v.title, departmentId: dept.id });
      if (v.orcid) r.orcid = v.orcid;
      if (v.employeeId) r.employeeId = v.employeeId;
      if (v.rollNo) r.rollNo = v.rollNo;
    } else if (action === "create") {
      const r: Researcher = {
        id: db.nextId.researcher++, name: v.name, email: v.email, title: v.title, departmentId: dept.id, kind, status: "active",
        orcid: v.orcid || undefined, employeeId: v.employeeId || undefined, rollNo: kind === "scholar" ? v.rollNo || undefined : undefined,
      };
      db.researchers.push(r);
      db.appointments.push({ id: db.nextId.appointment++, researcherId: r.id, unitId: dept.id, designation: r.title, fte: 1, validFrom: today() });
    }
  }
}

function commitOrgUnits(rows: ImportRow[]) {
  for (const { values: v, action } of rows) {
    if (action !== "create") continue;
    const parent = unitByName(v.parent)[0];
    db.orgUnits.push({ id: db.nextId.orgUnit++, parentId: parent.id, type: norm(v.type) as OrgUnitType, name: v.name });
  }
}

/* ------------------------------------ mock ------------------------------------ */
export const mock = {
  importPreview: (kind: ImportKind, csvText: string): Promise<ImportPreview> => {
    requireRole(mockUser(), ["RESEARCH_ADMIN"]);
    return wait(previewOf(kind, csvText), 350);
  },
  importCommit: (kind: ImportKind, csvText: string, skipErrors = false): Promise<ImportResult> => {
    requireRole(mockUser(), ["RESEARCH_ADMIN"]);
    const p = previewOf(kind, csvText);
    if (p.failed > 0 && !skipErrors) throw new HttpError(400);
    const good = p.rows.filter((r) => r.errors.length === 0);
    if (kind === "people") commitPeople(good); else commitOrgUnits(good);
    const result: ImportResult = { created: p.creates, updated: p.updates, skipped: p.rows.length - p.creates - p.updates };
    audit(`Imported ${kind === "people" ? "people" : "organisation units"} from CSV`, "import", undefined, `${result.created} created, ${result.updated} updated, ${result.skipped} skipped`);
    return wait(result, 500);
  },

  researchers: (departmentId?: number, q?: string, status?: StatusFilter): Promise<Researcher[]> => {
    let rs = scopeResearchers(mockUser()).map((r) => ({ ...r, publicationCount: db.publications.filter((p) => p.state === "verified" && p.authorIds.includes(r.id)).length }));
    if (departmentId) rs = rs.filter((r) => r.departmentId === departmentId);
    if (q) rs = rs.filter((r) => r.name.toLowerCase().includes(q.toLowerCase()));
    if (status === "active") rs = rs.filter((r) => !isLeft(r));
    if (status === "left") rs = rs.filter((r) => isLeft(r));
    return wait(rs);
  },

  markLeft: ({ researcherId, leftOn }: { researcherId: number; leftOn: string }): Promise<MarkLeftResult> => {
    requireRole(mockUser(), ["RESEARCH_ADMIN"]);
    const r = person(researcherId);
    if (!r) throw new HttpError(404);
    if (!isIsoDate(leftOn)) throw new HttpError(400);
    if (isLeft(r)) throw new HttpError(409);
    r.status = "left";
    r.leftOn = leftOn;
    // Access and appointments end on that date; publications, awards and grants stay in every report.
    let endedAppointments = 0, endedRoleGrants = 0;
    for (const a of db.appointments) {
      if (a.researcherId === researcherId && (!a.validTo || a.validTo > leftOn)) { a.validTo = leftOn < a.validFrom ? a.validFrom : leftOn; endedAppointments++; }
    }
    for (const g of db.roleGrants) {
      if (g.researcherId === researcherId && (!g.validTo || g.validTo > leftOn)) { g.validTo = leftOn < g.validFrom ? g.validFrom : leftOn; endedRoleGrants++; }
    }
    audit("Marked person as left", "researcher", researcherId, `${r.name}, left on ${leftOn}`);
    return wait({ researcher: { ...r }, endedAppointments, endedRoleGrants });
  },
  reinstate: (researcherId: number): Promise<Researcher> => {
    requireRole(mockUser(), ["RESEARCH_ADMIN"]);
    const r = person(researcherId);
    if (!r) throw new HttpError(404);
    if (!isLeft(r)) throw new HttpError(409);
    r.status = "active";
    delete r.leftOn;
    audit("Reinstated person", "researcher", researcherId, r.name);
    return wait({ ...r });
  },

  supervision: (researcherId: number): Promise<SupervisionView> => {
    const u = mockUser();
    const r = person(researcherId);
    if (!r) throw new HttpError(404);
    if (!canSee(u, researcherId)) throw new HttpError(403);
    const rels = activeRels();
    return wait({
      researcherId,
      supervisors: rels.filter((x) => x.menteeId === researcherId).flatMap((relationship) => {
        const m = person(relationship.mentorId);
        return m ? [{ relationship, mentor: entry(m), mentorLeft: isLeft(m) }] : [];
      }),
      mentees: rels.filter((x) => x.mentorId === researcherId).flatMap((relationship) => {
        const m = person(relationship.menteeId);
        return m ? [{ relationship, mentee: entry(m) }] : [];
      }),
      needsReassignment: isScholar(r) && needsReassignment(r) !== null,
    });
  },
  reassignments: (): Promise<ReassignmentItem[]> => {
    const u = requireRole(mockUser(), ["RESEARCH_ADMIN", "HOD", "DEAN"]);
    const units = u.role === "RESEARCH_ADMIN" ? null : subtree(u.scopeUnitId ?? -1);
    const items = db.researchers
      .filter((s) => isScholar(s) && !isLeft(s) && (!units || units.has(s.departmentId)))
      .flatMap((s): ReassignmentItem[] => {
        const n = needsReassignment(s);
        return n ? [{ scholar: entry(s), relationship: n.rel, leftSupervisor: entry(n.mentor), leftOn: n.mentor.leftOn, hasBackup: false }] : [];
      });
    return wait(items);
  },
  supervisionRows: (): Promise<SupervisionRow[]> => {
    const u = requireRole(mockUser(), ["RESEARCH_ADMIN", "HOD", "DEAN"]);
    const units = u.role === "RESEARCH_ADMIN" ? null : subtree(u.scopeUnitId ?? -1);
    return wait(activeRels().flatMap((relationship): SupervisionRow[] => {
      const s = person(relationship.menteeId), m = person(relationship.mentorId);
      if (!s || !m || (units && !units.has(s.departmentId))) return [];
      return [{ relationship, scholar: entry(s), mentor: entry(m), mentorLeft: isLeft(m) }];
    }));
  },
  /** Active faculty by name, from the whole institution: a scholar's supervisor may sit in another unit. */
  mentorCandidates: (): Promise<DirectoryEntry[]> => {
    requireRole(mockUser(), ["RESEARCH_ADMIN", "HOD", "DEAN"]);
    return wait(db.researchers.filter((r) => !isScholar(r) && !isLeft(r)).map(entry), 120);
  },
  assignSupervisor: ({ scholarId, mentorId, type }: { scholarId: number; mentorId: number; type: RelationshipType }): Promise<Relationship> => {
    const u = mockUser();
    const s = person(scholarId), m = person(mentorId);
    if (!s || !m) { requireRole(u, ["RESEARCH_ADMIN", "HOD", "DEAN"]); throw new HttpError(404); }
    requireSupervisionScope(u, scholarId);
    if (!isScholar(s) || isScholar(m) || isLeft(m) || mentorId === scholarId || !["primary", "co", "backup"].includes(type)) throw new HttpError(400);
    if (activeRels().some((x) => x.menteeId === scholarId && x.mentorId === mentorId)) throw new HttpError(409);
    if (type === "primary") for (const x of activeRels()) if (x.menteeId === scholarId && x.type === "primary") x.validTo = today();
    const rel: Relationship = { id: db.nextId.relationship++, mentorId, menteeId: scholarId, type, validFrom: today() };
    db.relationships.push(rel);
    audit(`Assigned ${type} supervisor`, "relationship", rel.id, `${m.name} for ${s.name}`);
    return wait({ ...rel });
  },
  endRelationship: (id: number): Promise<Relationship> => {
    const u = mockUser();
    const rel = db.relationships.find((x) => x.id === id);
    if (!rel) { requireRole(u, ["RESEARCH_ADMIN", "HOD", "DEAN"]); throw new HttpError(404); }
    requireSupervisionScope(u, rel.menteeId);
    if (!relActive(rel)) throw new HttpError(409);
    rel.validTo = today();
    audit("Ended supervision", "relationship", id, `${person(rel.mentorId)?.name} / ${person(rel.menteeId)?.name}`);
    return wait({ ...rel });
  },

  moveOrgUnit: ({ id, newParentId }: { id: number; newParentId: number }): Promise<OrgUnit> => {
    requireRole(mockUser(), ["RESEARCH_ADMIN"]);
    const unit = db.orgUnits.find((x) => x.id === id);
    const parent = db.orgUnits.find((x) => x.id === newParentId);
    if (!unit || !parent) throw new HttpError(404);
    if (allowedParent[unit.type] !== parent.type) throw new HttpError(400);
    if (subtree(id).has(newParentId)) throw new HttpError(409);
    if (unit.parentId !== newParentId) {
      const from = db.orgUnits.find((x) => x.id === unit.parentId)?.name ?? "—";
      unit.parentId = newParentId;
      audit("Moved organisation unit", "org-unit", id, `${unit.name}: ${from} to ${parent.name}`);
    }
    return wait({ ...unit });
  },

  claims: (researcherId: number): Promise<Claim[]> => {
    const u = mockUser();
    if (!person(researcherId)) throw new HttpError(404);
    if (!canSee(u, researcherId)) throw new HttpError(403);
    const byId = new Map<number, Publication>();
    for (const p of db.publications) if (p.state !== "verified" && p.authorIds.includes(researcherId)) byId.set(p.id, p);
    for (const s of db.suggestions) if (s.researcherId === researcherId) byId.set(s.publication.id, db.publications.find((p) => p.id === s.publication.id) ?? s.publication);
    return wait([...byId.values()].filter((p) => p.state !== "verified").map((publication): Claim => ({ id: publication.id, publication, state: publication.state, source: publication.source })));
  },

  appointments: (researcherId: number): Promise<AppointmentRow[]> => {
    if (!person(researcherId)) throw new HttpError(404);
    if (!canSee(mockUser(), researcherId)) throw new HttpError(403);
    return wait(db.appointments.filter((a) => a.researcherId === researcherId).sort((a, b) => b.validFrom.localeCompare(a.validFrom))
      .map((a) => ({ ...a, unitName: db.orgUnits.find((x) => x.id === a.unitId)?.name ?? "—" })));
  },
  saveAppointment: (a: AppointmentInput): Promise<Appointment> => {
    requireRole(mockUser(), ["RESEARCH_ADMIN"]);
    if (!person(a.researcherId) || !db.orgUnits.some((x) => x.id === a.unitId)) throw new HttpError(404);
    if (!a.designation.trim() || !(a.fte > 0 && a.fte <= 1) || !isIsoDate(a.validFrom) || (a.validTo && (!isIsoDate(a.validTo) || a.validTo < a.validFrom))) throw new HttpError(400);
    const overlaps = db.appointments.some((x) => x.id !== a.id && x.researcherId === a.researcherId && x.unitId === a.unitId
      && x.validFrom <= (a.validTo ?? "9999-12-31") && (!x.validTo || x.validTo >= a.validFrom));
    if (overlaps) throw new HttpError(409);
    const row: Appointment = { id: a.id ?? db.nextId.appointment++, researcherId: a.researcherId, unitId: a.unitId, designation: a.designation.trim(), fte: a.fte, validFrom: a.validFrom, validTo: a.validTo || undefined };
    if (a.id) {
      const at = db.appointments.findIndex((x) => x.id === a.id);
      if (at < 0 || db.appointments[at].researcherId !== a.researcherId) throw new HttpError(404);
      db.appointments[at] = row;
    } else db.appointments.push(row);
    audit(a.id ? "Updated appointment" : "Added appointment", "appointment", row.id, `${person(a.researcherId)!.name}: ${row.designation}, ${row.fte} FTE`);
    return wait({ ...row });
  },
  endAppointment: (id: number): Promise<Appointment> => {
    requireRole(mockUser(), ["RESEARCH_ADMIN"]);
    const a = db.appointments.find((x) => x.id === id);
    if (!a) throw new HttpError(404);
    if (a.validTo && a.validTo <= today()) throw new HttpError(409);
    a.validTo = a.validFrom > today() ? a.validFrom : today();
    audit("Ended appointment", "appointment", id, person(a.researcherId)?.name);
    return wait({ ...a });
  },

  connectOrcid: (): Promise<Researcher> => {
    const u = mockUser();
    if (!u) throw new HttpError(401);
    const r = u.researcherId ? person(u.researcherId) : undefined;
    if (!r) throw new HttpError(403);
    if (!r.orcid) throw new HttpError(400);
    r.orcidVerified = true;
    audit("Connected ORCID", "researcher", r.id, r.orcid);
    return wait({ ...r });
  },
  publicConsent: (): Promise<ConsentResult> => {
    const u = mockUser();
    if (!u) throw new HttpError(401);
    const r = u.researcherId ? person(u.researcherId) : undefined;
    if (!r) throw new HttpError(403);
    return wait({ publicProfile: !!r.publicProfile, effective: !!r.publicProfile && db.settings.publicProfilesEnabled }, 120);
  },
  setPublicConsent: (on: boolean): Promise<ConsentResult> => {
    const u = mockUser();
    if (!u) throw new HttpError(401);
    const r = u.researcherId ? person(u.researcherId) : undefined;
    if (!r) throw new HttpError(403);
    r.publicProfile = on;
    audit(on ? "Consented to public profile" : "Withdrew public profile consent", "researcher", r.id);
    return wait({ publicProfile: on, effective: on && db.settings.publicProfilesEnabled });
  },
};

/* ------------------------------------ real (planned endpoints, TRD §5 style) ------------------------------------ */
const json = (body: unknown) => JSON.stringify(body);
export const real: typeof mock = {
  importPreview: (kind, csv) => http(`/imports/${kind}/preview`, { method: "POST", body: json({ csv }) }),
  importCommit: (kind, csv, skipErrors = false) => http(`/imports/${kind}/commit`, { method: "POST", body: json({ csv, skipErrors }) }),
  researchers: async (departmentId, q, status) => (await http<Page<Researcher>>(`/researchers${qs({ departmentId, q, status: status === "all" ? undefined : status, size: 200 })}`)).items,
  markLeft: ({ researcherId, leftOn }) => http(`/researchers/${researcherId}/leave`, { method: "POST", body: json({ leftOn }) }),
  reinstate: (id) => http(`/researchers/${id}/reinstate`, { method: "POST" }),
  supervision: (id) => http(`/researchers/${id}/supervision`),
  reassignments: () => http("/supervision/reassignments"),
  supervisionRows: () => http("/supervision/relationships"),
  mentorCandidates: () => http("/supervision/mentor-candidates"),
  assignSupervisor: (b) => http("/supervision/relationships", { method: "POST", body: json(b) }),
  endRelationship: (id) => http(`/supervision/relationships/${id}/end`, { method: "POST" }),
  moveOrgUnit: ({ id, newParentId }) => http(`/org-units/${id}/move`, { method: "POST", body: json({ newParentId }) }),
  claims: (id) => http(`/researchers/${id}/claims`),
  appointments: (id) => http(`/researchers/${id}/appointments`),
  saveAppointment: (a) => (a.id ? http(`/appointments/${a.id}`, { method: "PUT", body: json(a) }) : http("/appointments", { method: "POST", body: json(a) })),
  endAppointment: (id) => http(`/appointments/${id}/end`, { method: "POST" }),
  connectOrcid: () => http("/me/orcid/connect", { method: "POST" }),
  publicConsent: () => http("/me/public-consent"),
  setPublicConsent: (on) => http("/me/public-consent", { method: "PUT", body: json({ on }) }),
};
