import { HttpError, http, qs } from "./http";
import { db, demoUsers } from "@/mock/store";
import { stageNames } from "@/mock/seed";
import type {
  Award, Department, DepartmentRow, MenteeDetail, MenteeRow, Milestone, MilestoneView, OrgUnit, OrgUnitType, Page, Publication,
  PublicationFilters, Researcher, Suggestion, Summary, TopResearcher, UnitRollup, UnitRow, User, YearCount,
} from "./types";
import { DOI_RE } from "./utils";

export const USE_MOCK = import.meta.env.VITE_USE_MOCK !== "false";
const wait = <T,>(v: T, ms = 220) => new Promise<T>((r) => setTimeout(() => r(v), ms));

const SESSION_KEY = "rms-demo-session"; // demo only; real auth uses a HttpOnly cookie
const mockUser = (): User | null => {
  const k = sessionStorage.getItem(SESSION_KEY);
  return k ? demoUsers[k] ?? null : null;
};

function paginate<T>(rows: T[], page: number, size: number): Page<T> {
  return { items: rows.slice(page * size, page * size + size), total: rows.length, page, size };
}

/** Org units under (and including) rootId. */
function subtree(rootId: number): Set<number> {
  const ids = new Set([rootId]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const x of db.orgUnits) if (x.parentId !== undefined && ids.has(x.parentId) && !ids.has(x.id)) { ids.add(x.id); grew = true; }
  }
  return ids;
}

/** Researcher ids the user may see; null = everyone in the tenant. Dean/HoD: their org subtree. Supervisor: self and mentees. */
function scopeIds(u: User | null): Set<number> | null {
  if (u && (u.role === "DEAN" || u.role === "HOD")) {
    const units = subtree(u.scopeUnitId!);
    return new Set(db.researchers.filter((r) => units.has(r.departmentId)).map((r) => r.id));
  }
  if (u?.role === "SUPERVISOR") return new Set([u.researcherId!, ...db.relationships.filter((x) => x.mentorId === u.researcherId).map((x) => x.menteeId)]);
  return null;
}

function scopeResearchers(u: User | null) {
  const ids = scopeIds(u);
  return ids ? db.researchers.filter((r) => ids.has(r.id)) : db.researchers;
}

const departmentsOf = () => db.orgUnits.filter((x) => x.type === "department");
const visibleUnits = (u: User | null) => {
  if (u && (u.role === "DEAN" || u.role === "HOD")) { const s = subtree(u.scopeUnitId!); return db.orgUnits.filter((x) => s.has(x.id)); }
  return db.orgUnits;
};

const today = () => new Date().toISOString().slice(0, 10);
const withStatus = (m: Milestone): MilestoneView => ({ ...m, status: m.completedAt ? "done" : m.dueDate < today() ? "overdue" : "upcoming" });
const milestonesOf = (scholarId: number) => db.milestones.filter((m) => m.scholarId === scholarId).sort((a, b) => a.id - b.id).map(withStatus);
const currentOf = (ms: MilestoneView[]) => ms.find((m) => m.status !== "done");

/** A plain researcher or scholar sees only themselves; everyone else is limited by scope. */
function canSee(u: User | null, id: number) {
  if (!u) return false;
  if (u.role === "RESEARCHER") return u.researcherId === id;
  const ids = scopeIds(u);
  return !ids || ids.has(id);
}

const withCounts = (rs: Researcher[]): Researcher[] =>
  rs.map((r) => ({ ...r, publicationCount: db.publications.filter((p) => p.state === "verified" && p.authorIds.includes(r.id)).length }));

/* ---------------------------- mock implementation ---------------------------- */
const mock = {
  me: () => wait(mockUser()),
  signIn: (role: string) => {
    if (!demoUsers[role]) throw new HttpError(401);
    sessionStorage.setItem(SESSION_KEY, role);
    return wait(demoUsers[role]);
  },
  signOut: () => { sessionStorage.removeItem(SESSION_KEY); return wait(undefined); },

  summary: (): Promise<Summary> => {
    const rs = scopeResearchers(mockUser());
    const ids = new Set(rs.map((r) => r.id));
    return wait({
      departments: new Set(rs.map((r) => r.departmentId)).size,
      researchers: rs.length,
      publications: db.publications.filter((p) => p.state === "verified" && p.authorIds.some((a) => ids.has(a))).length,
      awards: db.awards.filter((a) => ids.has(a.researcherId)).length,
      pendingReview: db.suggestions.length,
    });
  },
  byYear: (): Promise<YearCount[]> => {
    const ids = new Set(scopeResearchers(mockUser()).map((r) => r.id));
    const m = new Map<number, number>();
    db.publications.filter((p) => p.state === "verified" && p.authorIds.some((a) => ids.has(a))).forEach((p) => m.set(p.year, (m.get(p.year) ?? 0) + 1));
    return wait([...m].sort((a, b) => a[0] - b[0]).map(([year, count]) => ({ year, count })));
  },
  topResearchers: (): Promise<TopResearcher[]> =>
    wait(withCounts(scopeResearchers(mockUser())).sort((a, b) => (b.publicationCount ?? 0) - (a.publicationCount ?? 0)).slice(0, 5)
      .map((r) => ({ researcherId: r.id, name: r.name, publications: r.publicationCount ?? 0 }))),
  departmentReport: (): Promise<DepartmentRow[]> => {
    const inScope = new Set(scopeResearchers(mockUser()).map((r) => r.departmentId));
    return wait(departmentsOf().filter((d) => inScope.has(d.id)).map((d) => {
      const ids = new Set(db.researchers.filter((r) => r.departmentId === d.id).map((r) => r.id));
      return {
        departmentId: d.id, name: d.name,
        publications: db.publications.filter((p) => p.state === "verified" && p.authorIds.some((a) => ids.has(a))).length,
        awards: db.awards.filter((a) => ids.has(a.researcherId)).length,
        funding: db.awards.filter((a) => ids.has(a.researcherId)).reduce((s, a) => s + a.amount, 0),
      };
    }));
  },

  departments: (): Promise<Department[]> => wait(departmentsOf()),
  orgUnits: (): Promise<OrgUnit[]> => wait([...visibleUnits(mockUser())]),
  createOrgUnit: (name: string, parentId: number, type: OrgUnitType) => {
    const n: OrgUnit = { id: db.nextId.orgUnit++, parentId, type, name };
    db.orgUnits.push(n);
    return wait(n);
  },
  renameOrgUnit: (id: number, name: string) => {
    const x = db.orgUnits.find((u) => u.id === id);
    if (!x) throw new HttpError(404);
    x.name = name;
    return wait(x);
  },
  deleteOrgUnit: (id: number) => {
    if (db.orgUnits.some((x) => x.parentId === id) || db.researchers.some((r) => r.departmentId === id)) throw new HttpError(409);
    db.orgUnits = db.orgUnits.filter((x) => x.id !== id);
    return wait(undefined);
  },

  milestones: (scholarId?: number): Promise<MilestoneView[]> => {
    const u = mockUser();
    const id = scholarId ?? u?.researcherId;
    if (!id || !canSee(u, id)) throw new HttpError(403);
    return wait(milestonesOf(id));
  },
  mentees: (): Promise<MenteeRow[]> => {
    const u = mockUser();
    return wait(db.relationships.filter((x) => x.mentorId === u?.researcherId).map((rel): MenteeRow => {
      const ms = milestonesOf(rel.menteeId);
      return {
        researcher: db.researchers.find((r) => r.id === rel.menteeId)!,
        relationship: rel.type,
        current: currentOf(ms),
        overdue: ms.filter((m) => m.status === "overdue").length,
        lastMeeting: db.meetings.filter((m) => m.scholarId === rel.menteeId && m.mentorId === u?.researcherId).map((m) => m.heldOn).sort().pop(),
      };
    }));
  },
  menteeDetail: (id: number): Promise<MenteeDetail> => {
    const u = mockUser();
    if (!canSee(u, id)) throw new HttpError(403);
    const researcher = db.researchers.find((r) => r.id === id);
    if (!researcher) throw new HttpError(404);
    // Meeting logs are confidential: only the scholar and the supervisor named on the record see them, not unit heads or admins.
    const meetings = db.meetings.filter((m) => m.scholarId === id && (u?.researcherId === id || u?.researcherId === m.mentorId))
      .sort((a, b) => b.heldOn.localeCompare(a.heldOn));
    return wait({ researcher, milestones: milestonesOf(id), meetings });
  },
  unitRollup: (unitId: number): Promise<UnitRollup> => {
    if (!visibleUnits(mockUser()).some((x) => x.id === unitId)) throw new HttpError(403);
    const unit = db.orgUnits.find((x) => x.id === unitId);
    if (!unit) throw new HttpError(404);
    const row = (x: OrgUnit): UnitRow => {
      const units = subtree(x.id);
      const rs = db.researchers.filter((r) => units.has(r.departmentId));
      const ids = new Set(rs.map((r) => r.id));
      const scholars = rs.filter((r) => r.kind === "scholar");
      const awards = db.awards.filter((a) => ids.has(a.researcherId));
      return {
        unitId: x.id, name: x.name, type: x.type, researchers: rs.length, scholars: scholars.length,
        // Each publication counts once per unit, however many of its authors sit in it.
        publications: db.publications.filter((p) => p.state === "verified" && p.authorIds.some((a) => ids.has(a))).length,
        awards: awards.length, funding: awards.reduce((s, a) => s + a.amount, 0),
        overdue: scholars.flatMap((s) => milestonesOf(s.id)).filter((m) => m.status === "overdue").length,
      };
    };
    const inUnit = subtree(unitId);
    const stageCount = new Map<string, number>();
    for (const r of db.researchers.filter((x) => x.kind === "scholar" && inUnit.has(x.departmentId))) {
      const stage = currentOf(milestonesOf(r.id))?.stage ?? "Completed";
      stageCount.set(stage, (stageCount.get(stage) ?? 0) + 1);
    }
    return wait({
      unit, asOf: today(), totals: row(unit), children: db.orgUnits.filter((x) => x.parentId === unitId).map(row),
      byStage: [...stageNames, "Completed"].filter((s) => stageCount.has(s)).map((stage) => ({ stage, count: stageCount.get(stage)! })),
    });
  },

  researchers: (departmentId?: number, q?: string): Promise<Researcher[]> => {
    let rs = withCounts(scopeResearchers(mockUser()));
    if (departmentId) rs = rs.filter((r) => r.departmentId === departmentId);
    if (q) rs = rs.filter((r) => r.name.toLowerCase().includes(q.toLowerCase()));
    return wait(rs);
  },
  researcher: (id: number) => {
    const r = withCounts(db.researchers).find((x) => x.id === id);
    if (!r) throw new HttpError(404);
    return wait(r);
  },
  saveResearcher: (r: Omit<Researcher, "id"> & { id?: number }) => {
    if (r.id) { db.researchers = db.researchers.map((x) => (x.id === r.id ? { ...x, ...r } as Researcher : x)); return wait(r as Researcher); }
    const n = { ...r, id: db.nextId.researcher++ } as Researcher; db.researchers.push(n); return wait(n);
  },

  publications: (f: PublicationFilters): Promise<Page<Publication>> => {
    const u = mockUser();
    let rows = [...db.publications];
    const ids = scopeIds(u);
    if (ids) rows = rows.filter((p) => p.authorIds.some((a) => ids.has(a)));
    if (u?.role === "RESEARCHER") rows = rows.filter((p) => u.researcherId && p.authorIds.includes(u.researcherId));
    if (f.q) rows = rows.filter((p) => (p.title + p.venue + (p.doi ?? "")).toLowerCase().includes(f.q!.toLowerCase()));
    if (f.year) rows = rows.filter((p) => p.year === f.year);
    if (f.type) rows = rows.filter((p) => p.type === f.type);
    if (f.state) rows = rows.filter((p) => p.state === f.state);
    if (f.departmentId) { const ids = new Set(db.researchers.filter((r) => r.departmentId === f.departmentId).map((r) => r.id)); rows = rows.filter((p) => p.authorIds.some((a) => ids.has(a))); }
    const [key, dir] = (f.sort ?? "year:desc").split(":");
    rows.sort((a, b) => { const av = (a as never)[key] as string | number, bv = (b as never)[key] as string | number; return (av > bv ? 1 : av < bv ? -1 : 0) * (dir === "asc" ? 1 : -1); });
    return wait(paginate(rows, f.page, f.size));
  },
  publication: (id: number) => { const p = db.publications.find((x) => x.id === id); if (!p) throw new HttpError(404); return wait(p); },
  savePublication: (p: Omit<Publication, "id" | "state" | "source"> & { id?: number }) => {
    if (p.doi && db.publications.some((x) => x.doi?.toLowerCase() === p.doi!.toLowerCase() && x.id !== p.id)) throw new HttpError(409);
    if (p.id) { db.publications = db.publications.map((x) => (x.id === p.id ? { ...x, ...p } : x)); return wait(db.publications.find((x) => x.id === p.id)!); }
    const n: Publication = { ...p, id: db.nextId.publication++, state: "unverified", source: "manual" }; db.publications.unshift(n); return wait(n);
  },
  importDoi: (doi: string) => {
    if (!DOI_RE.test(doi)) throw new HttpError(400);
    const dup = db.publications.find((x) => x.doi?.toLowerCase() === doi.toLowerCase());
    if (dup) throw Object.assign(new HttpError(409), { existingId: dup.id });
    if (doi.includes("fail")) throw new HttpError(502);
    const n: Publication = { id: db.nextId.publication++, title: `Imported work ${doi.split("/").pop()}`, doi, venue: "Journal fetched from Crossref", type: "journal-article", year: 2026, authorIds: [], state: "suggested", source: "crossref" };
    db.publications.unshift(n); return wait(n, 700);
  },
  deletePublication: (id: number) => { db.publications = db.publications.filter((p) => p.id !== id); return wait(undefined); },

  awards: (): Promise<Award[]> => {
    const ids = new Set(scopeResearchers(mockUser()).map((r) => r.id));
    const u = mockUser();
    return wait(db.awards.filter((a) => (u?.role === "RESEARCHER" ? a.researcherId === u.researcherId : ids.has(a.researcherId))));
  },
  saveAward: (a: Omit<Award, "id"> & { id?: number }) => {
    if (a.id) { db.awards = db.awards.map((x) => (x.id === a.id ? { ...x, ...a } : x)); return wait(a as Award); }
    const n = { ...a, id: db.nextId.award++ }; db.awards.push(n); return wait(n);
  },
  deleteAward: (id: number) => { db.awards = db.awards.filter((a) => a.id !== id); return wait(undefined); },

  suggestions: (): Promise<Suggestion[]> => {
    const u = mockUser();
    const own = u?.role === "RESEARCHER" || u?.role === "SUPERVISOR";
    return wait(db.suggestions.filter((s) => !own || s.researcherId === u?.researcherId));
  },
  decide: (id: number, decision: "confirm" | "reject") => {
    const s = db.suggestions.find((x) => x.id === id);
    if (s && decision === "confirm") {
      const p = db.publications.find((x) => x.id === s.publication.id);
      if (p) { p.state = "verified"; if (!p.authorIds.includes(s.researcherId)) p.authorIds.push(s.researcherId); }
    }
    db.suggestions = db.suggestions.filter((x) => x.id !== id);
    return wait(undefined, 120);
  },
};

/* ----------------------------- real implementation ---------------------------- */
const real: typeof mock = {
  me: () => http<User>("/me").catch((e) => { if (e instanceof HttpError && e.status === 401) return null as never; throw e; }),
  signIn: () => { location.assign("/api/auth/login"); return new Promise<never>(() => {}); },
  signOut: async () => { await http<void>("/auth/logout", { method: "POST" }); },
  summary: () => http("/reports/summary"),
  byYear: () => http("/reports/publications-by-year"),
  topResearchers: () => http("/reports/top-researchers"),
  departmentReport: () => http("/reports/departments"),
  departments: async () => (await http<Page<Department>>("/departments?size=200")).items,
  // The calls below target planned endpoints (TRD §5): org tree, milestones, supervision, unit rollups.
  orgUnits: async () => (await http<Page<OrgUnit>>("/org-units?size=200")).items,
  createOrgUnit: (name, parentId, type) => http("/org-units", { method: "POST", body: JSON.stringify({ name, parentId, type }) }),
  renameOrgUnit: (id, name) => http(`/org-units/${id}`, { method: "PUT", body: JSON.stringify({ name }) }),
  deleteOrgUnit: (id) => http(`/org-units/${id}`, { method: "DELETE" }),
  milestones: (scholarId) => http(`/milestones${qs({ scholarId })}`),
  mentees: () => http("/relationships/mentees"),
  menteeDetail: (id) => http(`/relationships/mentees/${id}`),
  unitRollup: (unitId) => http(`/reports/units/${unitId}`),
  researchers: async (departmentId, q) => (await http<Page<Researcher>>(`/researchers${qs({ departmentId, q, size: 200 })}`)).items,
  researcher: (id) => http(`/researchers/${id}`),
  saveResearcher: (r) => (r.id ? http(`/researchers/${r.id}`, { method: "PUT", body: JSON.stringify(r) }) : http("/researchers", { method: "POST", body: JSON.stringify(r) })),
  publications: (f) => http(`/publications${qs({ ...f, type: f.type, state: f.state })}`),
  publication: (id) => http(`/publications/${id}`),
  savePublication: (p) => (p.id ? http(`/publications/${p.id}`, { method: "PUT", body: JSON.stringify(p) }) : http("/publications", { method: "POST", body: JSON.stringify(p) })),
  importDoi: (doi) => http(`/publications/import${qs({ doi })}`, { method: "POST" }),
  deletePublication: (id) => http(`/publications/${id}`, { method: "DELETE" }),
  awards: async () => (await http<Page<Award>>("/awards?size=200")).items,
  saveAward: (a) => (a.id ? http(`/awards/${a.id}`, { method: "PUT", body: JSON.stringify(a) }) : http("/awards", { method: "POST", body: JSON.stringify(a) })),
  deleteAward: (id) => http(`/awards/${id}`, { method: "DELETE" }),
  suggestions: () => http("/claims?state=suggested"), // planned endpoint (TRD §5)
  decide: (id, decision) => http(`/claims/${id}/${decision}`, { method: "POST" }), // planned endpoint
};

export const api = USE_MOCK ? mock : real;
