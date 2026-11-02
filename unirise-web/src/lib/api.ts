import { HttpError, http, qs } from "./http";
import { db, demoUsers } from "@/mock/store";
import { SESSION_KEY, canSee, logAccess, mockUser, scopeIds, scopeResearchers, subtree, today, wait } from "@/mock/helpers";
import * as extPeople from "@/mock/ext/people";
import * as extProgress from "@/mock/ext/progress";
import * as extQuality from "@/mock/ext/quality";
import * as extAccess from "@/mock/ext/access";
import * as extTenant from "@/mock/ext/tenant";
import * as extReporting from "@/mock/ext/reporting";
import { stageNames } from "@/mock/seed";
import type {
  Award, Department, DepartmentRow, EntryStatus, Grant, GrantStatus, LookupResult, MenteeDetail, MenteeRow, Milestone, MilestoneView, OrgUnit,
  OrgUnitType, Page, Publication, PublicationFilters, ReportParams, ReportTable, Researcher, ReviewAction, SeedProposal, SeedWindow, Suggestion,
  Summary, TopResearcher, UnitRollup, UnitRow, User, YearCount, DirectoryEntry,
} from "./types";
import { DOI_RE } from "./utils";

export const USE_MOCK = import.meta.env.VITE_USE_MOCK !== "false";
function paginate<T>(rows: T[], page: number, size: number): Page<T> {
  return { items: rows.slice(page * size, page * size + size), total: rows.length, page, size };
}

const departmentsOf = () => db.orgUnits.filter((x) => x.type === "department");
const visibleUnits = (u: User | null) => {
  if (u && (u.role === "DEAN" || u.role === "HOD")) { const s = subtree(u.scopeUnitId!); return db.orgUnits.filter((x) => s.has(x.id)); }
  return db.orgUnits;
};

const reviewStatus: Record<ReviewAction, EntryStatus> = { approve: "approved", rework: "rework", revision_required: "revision_required", reject: "rejected" };
const grantReviewStatus: Record<ReviewAction, GrantStatus> = { approve: "sanctioned", rework: "rework", revision_required: "rework", reject: "rejected" };
const instituteOf = (deptId: number) => {
  const d = db.orgUnits.find((u) => u.id === deptId);
  return { institute: db.orgUnits.find((u) => u.id === d?.parentId)?.name ?? "—", department: d?.name ?? "—" };
};
const uniq = <T,>(xs: T[]) => [...new Set(xs)];

/** Group identical keys and count them, largest first. */
function tally(keys: string[][], cols: string[], countLabel: string): ReportTable {
  const m = new Map<string, { k: string[]; n: number }>();
  for (const k of keys) { const id = k.join("\u0001"); const e = m.get(id) ?? { k, n: 0 }; e.n++; m.set(id, e); }
  return { columns: [...cols, countLabel], rows: [...m.values()].sort((a, b) => b.n - a.n || a.k[0].localeCompare(b.k[0])).map((e) => [...e.k, e.n]) };
}

function grantsInScope(u: User | null): Grant[] {
  const ids = scopeIds(u);
  return db.grants.filter((g) => !ids || ids.has(g.ownerId) || g.investigators.some((i) => i.researcherId !== undefined && ids.has(i.researcherId)));
}

function publicationReport(slug: string, p: ReportParams): ReportTable {
  const ids = scopeIds(mockUser());
  const yf = p.from ? Number(p.from.slice(0, 4)) : -Infinity;
  const yt = p.to ? Number(p.to.slice(0, 4)) : Infinity;
  const pubs = db.publications.filter((x) => x.state === "verified" && x.year >= yf && x.year <= yt && (!ids || x.authorIds.some((a) => ids.has(a))));
  const people = (x: Publication) => x.authorIds.map((id) => db.researchers.find((r) => r.id === id)).filter((r): r is Researcher => !!r);
  const outsiders = (x: Publication) => (x.authors ?? []).filter((a) => a.kind !== "internal-faculty" && a.kind !== "internal-student");
  const list = (kind: "faculty" | "scholar", key: "employeeId" | "rollNo", label: string): ReportTable => ({
    columns: [label, "Name", "Publication ID", "Title", "Year"],
    rows: pubs.flatMap((x) => people(x).filter((r) => (r.kind ?? "faculty") === kind && r[key]).map((r) => [r[key]!, r.name, x.id, x.title, x.year])).sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  });
  switch (slug) {
    case "pub-university": return tally(pubs.map((x) => [String(x.year)]), ["Year"], "Publications");
    case "pub-institute-count": return tally(pubs.flatMap((x) => uniq(people(x).map((r) => instituteOf(r.departmentId).institute)).map((i) => [i])), ["Institute"], "Publications");
    case "pub-institute-department": return tally(pubs.flatMap((x) => uniq(people(x).map((r) => instituteOf(r.departmentId))).map((d) => [d.institute, d.department])), ["Institute", "Department"], "Publications");
    case "pub-employee": return list("faculty", "employeeId", "Employee ID");
    case "pub-roll": return list("scholar", "rollNo", "Roll number");
    case "pub-employee-count": return tally(pubs.flatMap((x) => people(x).filter((r) => r.employeeId).map((r) => [r.employeeId!, r.name])), ["Employee ID", "Name"], "Publications");
    case "pub-journal": return tally(pubs.map((x) => [x.venue, x.type.replace("-", " ")]), ["Journal or venue", "Type"], "Publications");
    case "pub-faculty-journal": return tally(pubs.filter((x) => people(x).some((r) => r.kind !== "scholar")).map((x) => [x.venue]), ["Journal"], "Faculty-authored");
    case "pub-student-journal": return tally(pubs.filter((x) => x.studentPublication).map((x) => [x.venue]), ["Journal"], "Student-authored");
    case "pub-inter-institution": return tally(pubs.flatMap((x) => uniq(outsiders(x).map((a) => a.institution)).map((i) => [i])), ["Partner institution"], "Joint publications");
    case "pub-continent": return tally(pubs.flatMap((x) => uniq(outsiders(x).map((a) => a.continent ?? "Unknown")).map((c) => [c])), ["Continent"], "Publications");
    default: throw new HttpError(404);
  }
}

function grantReport(slug: string, p: ReportParams): ReportTable {
  const basis = p.basis ?? "applied";
  const dateOf = (g: Grant) => (basis === "entered" ? g.enteredOn : basis === "sanctioned" ? g.sanctionedOn : g.appliedOn);
  const gs = grantsInScope(mockUser()).filter((g) => { const d = dateOf(g); return !!d && (!p.from || d >= p.from) && (!p.to || d <= p.to); });
  const lead = (g: Grant) => g.investigators.find((i) => i.isLead) ?? g.investigators[0];
  const dept = (g: Grant) => { const r = db.researchers.find((x) => x.id === lead(g)?.researcherId); return r ? instituteOf(r.departmentId) : { institute: lead(g)?.institution ?? "—", department: lead(g)?.department ?? "—" }; };
  const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
  switch (slug) {
    case "grant-type": {
      const types = uniq(gs.map((g) => g.type));
      return { columns: ["Grant type", "Grants", "Applied (INR)", "Sanctioned (INR)"], rows: types.map((t) => { const x = gs.filter((g) => g.type === t); return [t, x.length, sum(x.map((g) => g.appliedAmount)), sum(x.map((g) => g.sanctionedAmount ?? 0))]; }) };
    }
    case "grant-institute-department": return tally(gs.map((g) => [dept(g).institute, dept(g).department]), ["Institute", "Department"], "Grants");
    case "grant-institution-count": return tally(gs.map((g) => [dept(g).institute]), ["Institute"], "Grants");
    case "grant-year-received": {
      const sanctioned = grantsInScope(mockUser()).filter((g) => g.sanctionedOn);
      const years = uniq(sanctioned.map((g) => g.sanctionedOn!.slice(0, 4))).sort();
      return { columns: ["Year", "Grants sanctioned", "Amount (INR)"], rows: years.map((y) => { const x = sanctioned.filter((g) => g.sanctionedOn!.startsWith(y)); return [y, x.length, sum(x.map((g) => g.sanctionedAmount ?? 0))]; }) };
    }
    case "grant-inter-institute":
      return { columns: ["Grant ID", "Title", "Institutions", "Applied (INR)"], rows: gs.filter((g) => uniq(g.investigators.map((i) => i.institution)).length > 1).map((g) => [`G-${String(g.id).padStart(5, "0")}`, g.title, uniq(g.investigators.map((i) => i.institution)).join("; "), g.appliedAmount]) };
    case "grant-sharing":
      return { columns: ["Grant ID", "Title", "Investigator", "Role", "Share %", "Share (INR)"], rows: gs.flatMap((g) => g.investigators.map((i) => [`G-${String(g.id).padStart(5, "0")}`, g.title, i.name, i.role, i.sharePct, Math.round(((g.sanctionedAmount ?? g.appliedAmount) * i.sharePct) / 100)])) };
    case "grant-sanctioned":
      return { columns: ["Grant ID", "Title", "Agency", "Sanctioned on", "Sanctioned (INR)", "Duration (months)"], rows: gs.filter((g) => g.status === "sanctioned").map((g) => [`G-${String(g.id).padStart(5, "0")}`, g.title, g.agency, g.sanctionedOn ?? "—", g.sanctionedAmount ?? 0, g.durationMonths ?? "—"]) };
    case "grant-employee": {
      const rows = gs.flatMap((g) => g.investigators.filter((i) => i.researcherId).map((i) => ({ r: db.researchers.find((x) => x.id === i.researcherId), g }))).filter((x) => x.r?.employeeId);
      const ids = uniq(rows.map((x) => x.r!.employeeId!));
      return { columns: ["Employee ID", "Name", "Grants", "Applied (INR)"], rows: ids.map((e) => { const x = rows.filter((y) => y.r!.employeeId === e); return [e, x[0].r!.name, x.length, sum(x.map((y) => y.g.appliedAmount))]; }) };
    }
    default: throw new HttpError(404);
  }
}
const withStatus = (m: Milestone): MilestoneView => ({ ...m, status: m.completedAt ? "done" : m.dueDate < today() ? "overdue" : "upcoming" });
const milestonesOf = (scholarId: number) => db.milestones.filter((m) => m.scholarId === scholarId).sort((a, b) => a.id - b.id).map(withStatus);
const currentOf = (ms: MilestoneView[]) => ms.find((m) => m.status !== "done");

/** Suggestions a user may act on: their own (researcher, supervisor) or all of them (research admin). */
function suggestionsFor(u: User | null) {
  if (!u) return [];
  if (u.role === "RESEARCH_ADMIN") return db.suggestions;
  if (u.role === "RESEARCHER" || u.role === "SUPERVISOR") return db.suggestions.filter((s) => s.researcherId === u.researcherId);
  return [];
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
      pendingReview: suggestionsFor(mockUser()).length,
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
    const u = mockUser();
    const r = withCounts(db.researchers).find((x) => x.id === id);
    if (!r) throw new HttpError(404);
    if (!canSee(u, id)) throw new HttpError(403);
    // A named drill-down by an executive or dean is recorded (PRD R27); confidential data is never part of a profile.
    if (u && (u.role === "EXECUTIVE" || u.role === "DEAN") && u.researcherId !== id) logAccess({ action: "drill-down", targetName: r.name, targetId: id, note: "Opened a named profile; confidential data excluded" });
    return wait(r);
  },
  /** Names only (part of the public scholarly record): used by author pickers and name lookups, never email or IDs. */
  directory: (): Promise<DirectoryEntry[]> => wait(db.researchers.map((r) => ({ id: r.id, name: r.name, title: r.title, departmentId: r.departmentId, kind: r.kind, employeeId: r.employeeId, rollNo: r.rollNo }))),
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
    if (f.q) rows = rows.filter((p) => (p.title + p.venue + (p.doi ?? "") + (p.authors ?? []).map((a) => a.name).join(" ")).toLowerCase().includes(f.q!.toLowerCase()));
    if (f.status) rows = rows.filter((p) => (p.entryStatus ?? "approved") === f.status);
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
  reviewPublication: (id: number, action: ReviewAction, comment?: string) => {
    const p = db.publications.find((x) => x.id === id);
    if (!p) throw new HttpError(404);
    p.entryStatus = reviewStatus[action];
    p.reviewComment = comment;
    if (action === "approve") p.state = "verified"; // only approved entries count in reports
    return wait(p);
  },

  grants: (): Promise<Grant[]> => {
    const u = mockUser();
    const all = grantsInScope(u);
    // A plain researcher sees only grants they own or sit on.
    return wait(u?.role === "RESEARCHER" ? all.filter((g) => g.ownerId === u.researcherId || g.investigators.some((i) => i.researcherId === u.researcherId)) : all);
  },
  grant: (id: number) => { const g = db.grants.find((x) => x.id === id); if (!g) throw new HttpError(404); return wait(g); },
  saveGrant: (g: Omit<Grant, "id" | "enteredOn" | "ownerId"> & { id?: number }) => {
    if (g.status === "submitted" && (!g.title.trim() || !g.agency.trim() || !g.investigators.some((i) => i.isLead))) throw new HttpError(400);
    if (g.id) { db.grants = db.grants.map((x) => (x.id === g.id ? { ...x, ...g, id: x.id } : x)); return wait(db.grants.find((x) => x.id === g.id)!); }
    const n: Grant = { ...g, id: db.nextId.grant++, enteredOn: today(), ownerId: mockUser()?.researcherId ?? 0 };
    db.grants.unshift(n);
    return wait(n);
  },
  reviewGrant: (id: number, action: ReviewAction, comment?: string) => {
    const g = db.grants.find((x) => x.id === id);
    if (!g) throw new HttpError(404);
    g.status = grantReviewStatus[action];
    g.reviewComment = comment;
    if (action === "approve") { g.sanctionedOn = today(); g.sanctionedAmount = g.sanctionedAmount ?? g.appliedAmount; }
    return wait(g);
  },

  seedWindow: (): Promise<SeedWindow> => wait(db.seedWindow),
  seedProposals: (f: { from?: string; to?: string; status?: EntryStatus | "" } = {}): Promise<SeedProposal[]> => {
    const u = mockUser();
    const ids = scopeIds(u);
    const mine = (s: SeedProposal) => s.ownerId === u?.researcherId || s.investigators.some((i) => i.researcherId === u?.researcherId);
    return wait(db.seedProposals
      .filter((s) => (u?.role === "RESEARCHER" ? mine(s) : !ids || ids.has(s.ownerId)))
      .filter((s) => (!f.from || s.appliedOn >= f.from) && (!f.to || s.appliedOn <= f.to) && (!f.status || s.status === f.status))
      .sort((a, b) => b.appliedOn.localeCompare(a.appliedOn)));
  },
  seedProposal: (id: number) => { const s = db.seedProposals.find((x) => x.id === id); if (!s) throw new HttpError(404); return wait(s); },
  saveSeedProposal: (s: Omit<SeedProposal, "id" | "appliedOn" | "ownerId" | "windowLabel"> & { id?: number }) => {
    if (s.id) { db.seedProposals = db.seedProposals.map((x) => (x.id === s.id ? { ...x, ...s, id: x.id } : x)); return wait(db.seedProposals.find((x) => x.id === s.id)!); }
    // The server, not the UI, enforces the quarterly application window.
    if (today() < db.seedWindow.opensOn || today() > db.seedWindow.closesOn) throw new HttpError(409);
    const n: SeedProposal = { ...s, id: db.nextId.seed++, appliedOn: today(), windowLabel: db.seedWindow.label, ownerId: mockUser()?.researcherId ?? 0 };
    db.seedProposals.unshift(n);
    return wait(n);
  },
  reviewSeedProposal: (id: number, action: ReviewAction, comment?: string) => {
    const s = db.seedProposals.find((x) => x.id === id);
    if (!s) throw new HttpError(404);
    s.status = reviewStatus[action];
    s.reviewComment = comment;
    return wait(s);
  },

  report: (slug: string, p: ReportParams = {}): Promise<ReportTable> => wait(slug.startsWith("pub-") ? publicationReport(slug, p) : grantReport(slug, p)),
  lookup: (kind: "employee" | "orcid" | "scopus", value: string): Promise<LookupResult> => {
    const v = value.trim().toLowerCase();
    const field = kind === "employee" ? "employeeId" : kind === "orcid" ? "orcid" : "scopusId";
    const r = scopeResearchers(mockUser()).find((x) => (x[field] ?? "").toLowerCase() === v);
    if (!v || !r) throw new HttpError(404);
    return wait({
      researcher: r, ...instituteOf(r.departmentId),
      publications: db.publications.filter((p) => p.state === "verified" && p.authorIds.includes(r.id)).sort((a, b) => b.year - a.year),
      grants: db.grants.filter((g) => g.investigators.some((i) => i.researcherId === r.id)).length,
    });
  },

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

  suggestions: (): Promise<Suggestion[]> => wait(suggestionsFor(mockUser())),
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
  directory: () => http("/researchers/directory"), // planned endpoint: names only
  saveResearcher: (r) => (r.id ? http(`/researchers/${r.id}`, { method: "PUT", body: JSON.stringify(r) }) : http("/researchers", { method: "POST", body: JSON.stringify(r) })),
  publications: (f) => http(`/publications${qs({ ...f, type: f.type, state: f.state })}`),
  publication: (id) => http(`/publications/${id}`),
  savePublication: (p) => (p.id ? http(`/publications/${p.id}`, { method: "PUT", body: JSON.stringify(p) }) : http("/publications", { method: "POST", body: JSON.stringify(p) })),
  importDoi: (doi) => http(`/publications/import${qs({ doi })}`, { method: "POST" }),
  deletePublication: (id) => http(`/publications/${id}`, { method: "DELETE" }),
  // Planned endpoints (TRD §5): review workflow, grants, seed money, report catalogue, researcher lookup.
  reviewPublication: (id, action, comment) => http(`/publications/${id}/review`, { method: "POST", body: JSON.stringify({ action, comment }) }),
  grants: async () => (await http<Page<Grant>>("/grants?size=200")).items,
  grant: (id) => http(`/grants/${id}`),
  saveGrant: (g) => (g.id ? http(`/grants/${g.id}`, { method: "PUT", body: JSON.stringify(g) }) : http("/grants", { method: "POST", body: JSON.stringify(g) })),
  reviewGrant: (id, action, comment) => http(`/grants/${id}/review`, { method: "POST", body: JSON.stringify({ action, comment }) }),
  seedWindow: () => http("/seed-money/window"),
  seedProposals: (f) => http(`/seed-money${qs({ ...f })}`),
  seedProposal: (id) => http(`/seed-money/${id}`),
  saveSeedProposal: (s) => (s.id ? http(`/seed-money/${s.id}`, { method: "PUT", body: JSON.stringify(s) }) : http("/seed-money", { method: "POST", body: JSON.stringify(s) })),
  reviewSeedProposal: (id, action, comment) => http(`/seed-money/${id}/review`, { method: "POST", body: JSON.stringify({ action, comment }) }),
  report: (slug, p) => http(`/reports/${slug}${qs({ ...p })}`),
  lookup: (kind, value) => http(`/researchers/lookup${qs({ kind, value })}`),
  awards: async () => (await http<Page<Award>>("/awards?size=200")).items,
  saveAward: (a) => (a.id ? http(`/awards/${a.id}`, { method: "PUT", body: JSON.stringify(a) }) : http("/awards", { method: "POST", body: JSON.stringify(a) })),
  deleteAward: (id) => http(`/awards/${id}`, { method: "DELETE" }),
  suggestions: () => http("/claims?state=suggested"), // planned endpoint (TRD §5)
  decide: (id, decision) => http(`/claims/${id}/${decision}`, { method: "POST" }), // planned endpoint
};

/**
 * Feature slices (mock/ext/*) add and override calls. Each exports a `mock` and a matching `real`
 * object, so the sample-data mode and the server mode stay in step.
 */
const extMock = { ...extPeople.mock, ...extProgress.mock, ...extQuality.mock, ...extAccess.mock, ...extTenant.mock, ...extReporting.mock };
const extReal = { ...extPeople.real, ...extProgress.real, ...extQuality.real, ...extAccess.real, ...extTenant.real, ...extReporting.real };
type Ext = typeof extMock;
type Api = Omit<typeof mock, keyof Ext> & Ext;
export const api: Api = (USE_MOCK ? { ...mock, ...extMock } : { ...real, ...extReal }) as Api;
