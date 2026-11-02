// Feature slice "reporting": saved reports and exports, report templates, analytics, period close, appointment-based counting, projects.
import { HttpError, http, qs } from "@/lib/http";
import { db } from "@/mock/store";
import {
  audit, canSee, logAccess, mockUser, publicationDate, requireRole, scopeIds, subtree, today, unitsOn, wait,
} from "@/mock/helpers";
import type {
  Award, Grant, OrgUnit, Period, Project, Publication, ReportParams, ReportTable, SavedReport, UnitRollup, UnitRow, UnitSnapshot, User,
} from "@/lib/types";

/* ------------------------------------------------------------------ types */

export type ExtReportSlug = "annual-faculty" | "accreditation-summary" | "collab-network" | "trends" | "benchmark" | "oa-compliance";
export const extReportSlugs: ExtReportSlug[] = ["annual-faculty", "accreditation-summary", "collab-network", "trends", "benchmark", "oa-compliance"];
export const isExtReport = (slug?: string): slug is ExtReportSlug => !!slug && (extReportSlugs as string[]).includes(slug);

export interface ReportChart { kind: "bar" | "line"; x: string; series: string[] }
export interface ReportSection { heading: string; table: ReportTable; chart?: ReportChart; note?: string }
export interface ExtReport { slug: ExtReportSlug; title: string; notice?: string; asOf: string; sections: ReportSection[] }

export type RollupX = UnitRollup & { closed?: boolean; periodLabel?: string; takenAt?: string };

export interface ExportJob { status: "queued" | "running" | "done" | "failed"; progress: number; fileName?: string; format: "csv" | "pdf"; slug: string }

export interface ProjectView extends Project {
  restricted?: boolean;
  leadName?: string;
  awards?: Award[];
  grants?: Grant[];
  publications?: Pick<Publication, "id" | "title" | "year" | "venue">[];
  funding?: number;
  canEdit?: boolean;
}

/* ---------------------------------------------------------------- helpers */

const unitById = (id: number) => db.orgUnits.find((u) => u.id === id);
const nameOf = (id: number) => db.researchers.find((r) => r.id === id)?.name ?? `#${id}`;
const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
const median = (xs: number[]) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const round1 = (n: number) => Math.round(n * 10) / 10;
const isReviewer = (u: User | null) => !!u && (u.role === "RESEARCH_ADMIN" || u.role === "HOD" || u.role === "DEAN");
const overviewRoles = ["RESEARCH_ADMIN", "EXECUTIVE", "DEAN", "HOD", "VIEWER"] as const;

const publicationsInScope = (u: User | null) => {
  const ids = scopeIds(u);
  return db.publications.filter((p) => !p.mergedInto && p.state === "verified" && (!ids || p.authorIds.some((a) => ids.has(a))));
};
/** Department-type units a person belonged to on a date (joint appointments give several). */
const departmentsOn = (researcherId: number, date: string) => {
  const out = new Set<number>();
  for (const id of unitsOn(researcherId, date)) {
    let u: OrgUnit | undefined = unitById(id);
    while (u && u.type !== "department") u = u.parentId ? unitById(u.parentId) : undefined;
    if (u) out.add(u.id);
  }
  return [...out];
};
const inRange = (date: string, from?: string, to?: string) => (!from || date >= from) && (!to || date <= to);

/* ------------------------------------------------------ rollup and periods */

/** Publication credit goes by each author's appointment on the publication date; a publication counts once per unit (PRD R29). */
function computeRollup(unitId: number, range?: { from: string; to: string }): UnitRollup {
  const unit = unitById(unitId);
  if (!unit) throw new HttpError(404);
  const row = (x: OrgUnit): UnitRow => {
    const units = subtree(x.id);
    const people = db.researchers.filter((r) => r.status !== "left" && unitsOn(r.id, today()).some((id) => units.has(id)));
    const ids = new Set(people.map((r) => r.id));
    const scholars = people.filter((r) => r.kind === "scholar");
    const pubs = db.publications.filter((p) => {
      if (p.mergedInto || p.state !== "verified") return false;
      const date = publicationDate(p);
      if (range && !inRange(date, range.from, range.to)) return false;
      return p.authorIds.some((a) => unitsOn(a, date).some((id) => units.has(id)));
    });
    const awards = db.awards.filter((a) => ids.has(a.researcherId) && (!range || inRange(`${a.startYear}-07-01`, range.from, range.to)));
    const overdue = scholars.flatMap((s) => db.milestones.filter((m) => m.scholarId === s.id && !m.completedAt && m.dueDate < today())).length;
    return { unitId: x.id, name: x.name, type: x.type, researchers: people.length, scholars: scholars.length, publications: pubs.length, awards: awards.length, funding: sum(awards.map((a) => a.amount)), overdue };
  };
  const inUnit = subtree(unitId);
  const stageCount = new Map<string, number>();
  const order: string[] = [];
  for (const r of db.researchers.filter((x) => x.kind === "scholar" && x.status !== "left" && unitsOn(x.id, today()).some((id) => inUnit.has(id)))) {
    const ms = db.milestones.filter((m) => m.scholarId === r.id).sort((a, b) => a.id - b.id);
    for (const m of ms) if (!order.includes(m.stage)) order.push(m.stage);
    const stage = ms.find((m) => !m.completedAt)?.stage ?? "Completed";
    stageCount.set(stage, (stageCount.get(stage) ?? 0) + 1);
  }
  return {
    unit, asOf: today(), totals: row(unit), children: db.orgUnits.filter((x) => x.parentId === unitId).map(row),
    byStage: [...order, "Completed"].filter((s) => stageCount.has(s)).map((stage) => ({ stage, count: stageCount.get(stage)! })),
  };
}

/** The seeded closed period gets its snapshots on first access; after that they never change. */
function ensureSnapshots(p: Period) {
  if (!p.closedAt || db.snapshots.some((s) => s.periodId === p.id)) return;
  for (const u of db.orgUnits) db.snapshots.push({ periodId: p.id, takenAt: p.closedAt, rollup: computeRollup(u.id, { from: p.startsOn, to: p.endsOn }) });
}

function unitAllowed(u: User | null, unitId: number) {
  if (!u) throw new HttpError(401);
  if (u.role === "DEAN" || u.role === "HOD") { if (!subtree(u.scopeUnitId!).has(unitId)) throw new HttpError(403); return; }
  if (!(overviewRoles as readonly string[]).includes(u.role)) throw new HttpError(403);
}

/* -------------------------------------------------------------- templates */

function annualFaculty(u: User | null, p: ReportParams): ExtReport {
  const id = p.researcherId ?? u?.researcherId;
  if (!id) throw new HttpError(400);
  if (!canSee(u, id)) throw new HttpError(403);
  const r = db.researchers.find((x) => x.id === id);
  if (!r) throw new HttpError(404);
  const from = p.from, to = p.to;
  const pubs = db.publications.filter((x) => !x.mergedInto && x.state === "verified" && x.authorIds.includes(id) && inRange(publicationDate(x), from, to));
  const grants = db.grants.filter((g) => g.investigators.some((i) => i.researcherId === id) && inRange(g.appliedOn, from, to));
  const awards = db.awards.filter((a) => a.researcherId === id && inRange(`${a.startYear}-07-01`, from, to));
  const seed = db.seedProposals.filter((s) => (s.ownerId === id || s.investigators.some((i) => i.researcherId === id)) && inRange(s.appliedOn, from, to));
  const mentees = db.relationships.filter((x) => x.mentorId === id && !x.validTo);
  const overdue = mentees.flatMap((x) => db.milestones.filter((m) => m.scholarId === x.menteeId && !m.completedAt && m.dueDate < today())).length;
  const unitNames = unitsOn(id, today()).map((x) => unitById(x)?.name).filter(Boolean).join(", ") || "—";
  return {
    slug: "annual-faculty", title: `Annual faculty report: ${r.name}`, asOf: today(),
    notice: `${r.title} · ${unitNames}. Period ${from ?? "start"} to ${to ?? "today"}. Verified publications and recorded grants only.`,
    sections: [
      { heading: "Summary", table: { columns: ["Measure", "Count"], rows: [["Verified publications", pubs.length], ["Grants as investigator", grants.length], ["Awards", awards.length], ["Seed money proposals", seed.length], ["Scholars supervised", mentees.length], ["Overdue milestones among them", overdue]] } },
      { heading: "Publications", table: { columns: ["Title", "Venue", "Year", "Type"], rows: pubs.sort((a, b) => b.year - a.year).map((x) => [x.title, x.venue, x.year, x.type.replace("-", " ")]) } },
      { heading: "Grants", table: { columns: ["Grant", "Agency", "Role", "Applied (INR)", "Status"], rows: grants.map((g) => [g.title, g.agency, g.investigators.find((i) => i.researcherId === id)?.role ?? "", g.appliedAmount, g.status]) } },
      { heading: "Awards", table: { columns: ["Award", "Funder", "Years", "Amount (INR)"], rows: awards.map((a) => [a.title, a.funder, `${a.startYear}-${a.endYear}`, a.amount]) } },
      { heading: "Seed money", table: { columns: ["Proposal", "Category", "Applied on", "Status"], rows: seed.map((s) => [s.title, s.category, s.appliedOn, s.status]) } },
    ],
  };
}

function accreditationSummary(u: User | null, p: ReportParams): ExtReport {
  const ids = scopeIds(u);
  const pubs = publicationsInScope(u).filter((x) => inRange(publicationDate(x), p.from, p.to));
  const byType = new Map<string, number>();
  pubs.forEach((x) => byType.set(x.type, (byType.get(x.type) ?? 0) + 1));
  const grants = db.grants.filter((g) => g.status === "sanctioned" && (!ids || g.investigators.some((i) => i.researcherId !== undefined && ids.has(i.researcherId))) && inRange(g.sanctionedOn ?? "", p.from, p.to));
  const byAgency = new Map<string, { n: number; amt: number }>();
  grants.forEach((g) => { const e = byAgency.get(g.agency) ?? { n: 0, amt: 0 }; e.n++; e.amt += g.sanctionedAmount ?? g.appliedAmount; byAgency.set(g.agency, e); });
  const root = db.orgUnits.find((x) => x.parentId === undefined)!;
  const roll = computeRollup(root.id);
  const depts = db.orgUnits.filter((x) => x.type === "department").filter((d) => !ids || db.researchers.some((r) => ids.has(r.id) && departmentsOn(r.id, today()).includes(d.id)));
  return {
    slug: "accreditation-summary", title: "Accreditation and ranking summary", asOf: today(),
    notice: "SAMPLE FORMAT. The final accreditation or ranking format is agreed with the first customer; these sections show the data that would feed it.",
    sections: [
      { heading: "Research output by type", table: { columns: ["Type", "Verified publications"], rows: [...byType].sort((a, b) => b[1] - a[1]).map(([t, n]) => [t.replace("-", " "), n]) } },
      { heading: "Sanctioned funding by agency", table: { columns: ["Agency", "Grants", "Sanctioned (INR)"], rows: [...byAgency].sort((a, b) => b[1].amt - a[1].amt).map(([a, v]) => [a, v.n, v.amt]) } },
      { heading: "PhD scholars by stage", table: { columns: ["Stage", "Scholars"], rows: roll.byStage.map((s) => [s.stage, s.count]) } },
      { heading: "By department", table: { columns: ["Department", "Researchers", "Scholars", "Publications", "Awards", "Funding (INR)"], rows: depts.map((d) => { const t = computeRollup(d.id).totals; return [d.name, t.researchers, t.scholars, t.publications, t.awards, t.funding]; }) } },
    ],
  };
}

/* -------------------------------------------------------------- analytics */

function collabNetwork(u: User | null, p: ReportParams): ExtReport {
  const depts = db.orgUnits.filter((x) => x.type === "department");
  const pair = new Map<string, number>();
  const partner = new Map<string, { n: number; continent: string }>();
  for (const pub of publicationsInScope(u).filter((x) => inRange(publicationDate(x), p.from, p.to))) {
    const date = publicationDate(pub);
    const ds = [...new Set(pub.authorIds.flatMap((a) => departmentsOn(a, date)))];
    for (const a of ds) for (const b of ds) if (a !== b) pair.set(`${a}|${b}`, (pair.get(`${a}|${b}`) ?? 0) + 1);
    const seen = new Set<string>();
    for (const au of pub.authors ?? []) if (au.kind === "external" && !seen.has(au.institution)) { seen.add(au.institution); const e = partner.get(au.institution) ?? { n: 0, continent: au.continent ?? "Unknown" }; e.n++; partner.set(au.institution, e); }
  }
  return {
    slug: "collab-network", title: "Collaboration across departments", asOf: today(),
    notice: "Counts publications written by authors from two departments. Each cell is a count of distinct publications. No individuals are named.",
    sections: [
      { heading: "Co-authored publications, department by department", table: { columns: ["Department", ...depts.map((d) => d.name)], rows: depts.map((a) => [a.name, ...depts.map((b) => (a.id === b.id ? "—" : pair.get(`${a.id}|${b.id}`) ?? 0))]) } },
      { heading: "Partner institutions", table: { columns: ["Institution", "Continent", "Joint publications"], rows: [...partner].sort((a, b) => b[1].n - a[1].n).map(([i, v]) => [i, v.continent, v.n]) } },
    ],
  };
}

function trends(u: User | null): ExtReport {
  const pubs = publicationsInScope(u);
  const ids = scopeIds(u);
  const awards = db.awards.filter((a) => !ids || ids.has(a.researcherId));
  const years = [...new Set([...pubs.map((x) => x.year), ...awards.map((a) => a.startYear)])].sort();
  const rows = years.map((y, i) => {
    const n = pubs.filter((x) => x.year === y).length;
    const f = sum(awards.filter((a) => a.startYear === y).map((a) => a.amount));
    const prev = i > 0 ? pubs.filter((x) => x.year === years[i - 1]).length : 0;
    return [y, n, i > 0 && prev > 0 ? round1(((n - prev) / prev) * 100) : "—", f] as (string | number)[];
  });
  return {
    slug: "trends", title: "Trends year over year", asOf: today(), notice: "Verified publications by year and funding by the year an award started. Year-over-year change is blank when the previous year has none.",
    sections: [{ heading: "Output and funding", table: { columns: ["Year", "Publications", "Change on previous year (%)", "New funding (INR)"], rows }, chart: { kind: "line", x: "Year", series: ["Publications"] } }],
  };
}

function benchmark(u: User | null): ExtReport {
  const ids = scopeIds(u);
  const depts = db.orgUnits.filter((x) => x.type === "department");
  const raw = depts.map((d) => {
    const t = computeRollup(d.id).totals;
    const faculty = db.researchers.filter((r) => r.kind !== "scholar" && r.status !== "left" && departmentsOn(r.id, today()).includes(d.id)).length;
    return { d, faculty, pubs: t.publications, per: faculty ? t.publications / faculty : 0 };
  }).filter((x) => !ids || x.faculty > 0);
  const med = median(raw.map((x) => x.per));
  return {
    slug: "benchmark", title: "Department benchmark", asOf: today(), notice: "Verified publications per faculty member, against the median department. Departments are compared as groups; disciplines publish at different rates, so read the gap with care.",
    sections: [{ heading: "Publications per faculty member", table: { columns: ["Department", "Faculty", "Publications", "Per faculty", "Median department", "Gap to median"], rows: raw.map((x) => [x.d.name, x.faculty, x.pubs, round1(x.per), round1(med), round1(x.per - med)]) }, chart: { kind: "bar", x: "Department", series: ["Per faculty", "Median department"] } }],
  };
}

function oaCompliance(u: User | null): ExtReport {
  const pubs = db.publications.filter((p) => !p.mergedInto && p.oaStatus && (!scopeIds(u) || p.authorIds.some((a) => scopeIds(u)!.has(a))));
  const count = (key: "oaStatus" | "funderMandate") => { const m = new Map<string, number>(); pubs.forEach((p) => { const v = p[key] ?? "unknown"; m.set(v, (m.get(v) ?? 0) + 1); }); return [...m].sort((a, b) => b[1] - a[1]).map(([k, n]) => [k.replace("-", " "), n] as (string | number)[]); };
  const bad = pubs.filter((p) => p.funderMandate === "non-compliant");
  const sections: ReportSection[] = [
    { heading: "By open-access status", table: { columns: ["Status", "Publications"], rows: count("oaStatus") } },
    { heading: "Funder mandate", table: { columns: ["Compliance", "Publications"], rows: count("funderMandate") } },
  ];
  if (isReviewer(u)) sections.push({ heading: "Needs action: mandate not met", table: { columns: ["Publication", "Year", "Authors"], rows: bad.map((p) => [p.title, p.year, p.authorIds.map(nameOf).join(", ")]) }, note: "Named, because a reviewer has to act on them." });
  return { slug: "oa-compliance", title: "Open-access and funder-mandate compliance", asOf: today(), sections };
}

/* ------------------------------------------------------------- exports */

const jobs = new Map<string, { startedAt: number; slug: string; format: "csv" | "pdf"; fileName: string }>();
const JOB_MS = 1800;

/* --------------------------------------------------------------- projects */

function isMember(u: User | null, p: Project) {
  if (!u?.researcherId) return false;
  const id = u.researcherId;
  return p.leadId === id || p.awardIds.some((a) => db.awards.find((x) => x.id === a)?.researcherId === id)
    || p.grantIds.some((g) => db.grants.find((x) => x.id === g)?.investigators.some((i) => i.researcherId === id));
}
function projectView(u: User | null, p: Project): ProjectView {
  const full = u?.role === "RESEARCH_ADMIN" || isMember(u, p) || p.sensitivity !== "confidential";
  if (!full) return { id: p.id, title: "Restricted project", leadId: 0, status: p.status, awardIds: [], grantIds: [], publicationIds: [], sensitivity: p.sensitivity, restricted: true };
  const awards = db.awards.filter((a) => p.awardIds.includes(a.id));
  const grants = db.grants.filter((g) => p.grantIds.includes(g.id));
  return {
    ...p, leadName: nameOf(p.leadId), awards, grants,
    publications: db.publications.filter((x) => p.publicationIds.includes(x.id) && !x.mergedInto).map((x) => ({ id: x.id, title: x.title, year: x.year, venue: x.venue })),
    funding: sum(awards.map((a) => a.amount)) + sum(grants.map((g) => g.sanctionedAmount ?? 0)),
    canEdit: u?.role === "RESEARCH_ADMIN" || u?.researcherId === p.leadId,
  };
}
function projectVisible(u: User | null, p: Project) {
  if (!u) return false;
  if (!["RESEARCH_ADMIN", "EXECUTIVE", "VIEWER", "DEAN", "HOD", "SUPERVISOR", "RESEARCHER"].includes(u.role)) return false;
  if (p.sensitivity === "confidential") return true; // outsiders see the restricted placeholder
  const ids = scopeIds(u);
  return !ids || ids.has(p.leadId) || isMember(u, p);
}
const canEditProject = (u: User | null, p?: Project) => u?.role === "RESEARCH_ADMIN" || (!!p && !!u?.researcherId && p.leadId === u.researcherId);

/* ------------------------------------------------------------------- mock */

export const mock = {
  periods: (): Promise<Period[]> => {
    requireRole(mockUser(), [...overviewRoles]);
    db.periods.forEach(ensureSnapshots);
    return wait([...db.periods]);
  },
  closePeriod: (id: number): Promise<Period> => {
    const u = requireRole(mockUser(), ["RESEARCH_ADMIN"]);
    const p = db.periods.find((x) => x.id === id);
    if (!p) throw new HttpError(404);
    if (p.closedAt) throw new HttpError(409);
    const takenAt = today();
    for (const unit of db.orgUnits) db.snapshots.push({ periodId: id, takenAt, rollup: computeRollup(unit.id, { from: p.startsOn, to: p.endsOn }) });
    p.closedAt = takenAt; p.closedBy = u.name;
    audit("Closed period", "period", id, `${p.label}: snapshot of ${db.orgUnits.length} units frozen`);
    return wait(p);
  },
  unitRollup: (unitId: number, periodId?: number): Promise<RollupX> => {
    const u = mockUser();
    unitAllowed(u, unitId);
    if (!unitById(unitId)) throw new HttpError(404);
    if (periodId === undefined) return wait(computeRollup(unitId));
    const period = db.periods.find((x) => x.id === periodId);
    if (!period) throw new HttpError(404);
    if (period.closedAt) {
      ensureSnapshots(period);
      const snap: UnitSnapshot | undefined = db.snapshots.find((s) => s.periodId === periodId && s.rollup.unit.id === unitId);
      if (!snap) throw new HttpError(404);
      return wait({ ...snap.rollup, asOf: snap.takenAt, closed: true, periodLabel: period.label, takenAt: snap.takenAt });
    }
    return wait({ ...computeRollup(unitId, { from: period.startsOn, to: period.endsOn }), closed: false, periodLabel: period.label });
  },

  extReport: (slug: ExtReportSlug, p: ReportParams = {}): Promise<ExtReport> => {
    const u = mockUser();
    if (!u) throw new HttpError(401);
    if (slug === "annual-faculty") { if (!(["RESEARCH_ADMIN", "DEAN", "HOD", "SUPERVISOR", "RESEARCHER", "EXECUTIVE", "VIEWER"] as string[]).includes(u.role)) throw new HttpError(403); return wait(annualFaculty(u, p)); }
    if (!(overviewRoles as readonly string[]).includes(u.role)) throw new HttpError(403);
    switch (slug) {
      case "accreditation-summary": return wait(accreditationSummary(u, p));
      case "collab-network": return wait(collabNetwork(u, p));
      case "trends": return wait(trends(u));
      case "benchmark": return wait(benchmark(u));
      case "oa-compliance": return wait(oaCompliance(u));
      default: throw new HttpError(404);
    }
  },

  savedReports: (): Promise<SavedReport[]> => {
    const u = mockUser();
    if (!u) throw new HttpError(401);
    return wait(db.savedReports.filter((r) => r.ownerId === u.id || r.ownerId === 0));
  },
  saveReport: (r: { name: string; slug: string; params: ReportParams }): Promise<SavedReport> => {
    const u = mockUser();
    if (!u) throw new HttpError(401);
    if (!r.name.trim() || r.name.length > 80 || !r.slug) throw new HttpError(400);
    const n: SavedReport = { id: db.nextId.saved++, name: r.name.trim(), slug: r.slug, params: r.params, ownerId: u.id, createdOn: today() };
    db.savedReports.unshift(n);
    audit("Saved report definition", "report-definition", n.id, n.name);
    return wait(n);
  },
  deleteSavedReport: (id: number): Promise<void> => {
    const u = mockUser();
    const r = db.savedReports.find((x) => x.id === id);
    if (!r) throw new HttpError(404);
    if (!u || r.ownerId !== u.id) throw new HttpError(403); // the shared sample (owner 0) cannot be deleted
    db.savedReports = db.savedReports.filter((x) => x.id !== id);
    return wait(undefined);
  },

  startExport: (e: { slug: string; params: ReportParams; format: "csv" | "pdf" }): Promise<{ jobId: string }> => {
    const u = mockUser();
    if (!u) throw new HttpError(401);
    const jobId = `exp-${Date.now().toString(36)}-${jobs.size}`;
    jobs.set(jobId, { startedAt: Date.now(), slug: e.slug, format: e.format, fileName: `${e.slug}.${e.format === "csv" ? "csv" : "pdf"}` });
    audit("Exported report", "report", e.slug, `${e.format.toUpperCase()} export started`);
    logAccess({ action: "export", note: `${e.slug} (${e.format.toUpperCase()})` });
    return wait({ jobId }, 120);
  },
  exportJob: (jobId: string): Promise<ExportJob> => {
    const j = jobs.get(jobId);
    if (!j) throw new HttpError(404);
    const t = Date.now() - j.startedAt;
    const progress = Math.min(100, Math.round((t / JOB_MS) * 100));
    return wait({ status: t < 250 ? "queued" : t < JOB_MS ? "running" : "done", progress, fileName: t >= JOB_MS ? j.fileName : undefined, format: j.format, slug: j.slug } as ExportJob, 60);
  },

  projects: (): Promise<ProjectView[]> => {
    const u = mockUser();
    if (!u) throw new HttpError(401);
    return wait(db.projects.filter((p) => projectVisible(u, p)).map((p) => projectView(u, p)));
  },
  project: (id: number): Promise<ProjectView> => {
    const u = mockUser();
    const p = db.projects.find((x) => x.id === id);
    if (!p || !projectVisible(u, p)) throw new HttpError(404);
    return wait(projectView(u, p));
  },
  saveProject: (v: { id?: number; title: string; leadId: number; status: Project["status"]; summary?: string; sensitivity: Project["sensitivity"] }): Promise<ProjectView> => {
    const u = mockUser();
    const existing = v.id ? db.projects.find((x) => x.id === v.id) : undefined;
    if (v.id && !existing) throw new HttpError(404);
    if (!canEditProject(u, existing) && !(u?.role === "RESEARCH_ADMIN")) { if (v.id || !u?.researcherId) throw new HttpError(403); }
    if (!v.title.trim() || v.title.length > 160 || !db.researchers.some((r) => r.id === v.leadId)) throw new HttpError(400);
    let p: Project;
    if (existing) { Object.assign(existing, { title: v.title.trim(), leadId: v.leadId, status: v.status, summary: v.summary, sensitivity: v.sensitivity }); p = existing; }
    else { p = { id: db.nextId.project++, title: v.title.trim(), leadId: v.leadId, status: v.status, awardIds: [], grantIds: [], publicationIds: [], summary: v.summary, sensitivity: v.sensitivity }; db.projects.push(p); }
    audit(existing ? "Updated project" : "Created project", "project", p.id, p.title);
    return wait(projectView(u, p));
  },
  linkToProject: (v: { id: number; kind: "award" | "grant" | "publication"; itemId: number }): Promise<ProjectView> => {
    const u = mockUser();
    const p = db.projects.find((x) => x.id === v.id);
    if (!p) throw new HttpError(404);
    if (!canEditProject(u, p)) throw new HttpError(403);
    const list = v.kind === "award" ? p.awardIds : v.kind === "grant" ? p.grantIds : p.publicationIds;
    const exists = v.kind === "award" ? db.awards.some((x) => x.id === v.itemId) : v.kind === "grant" ? db.grants.some((x) => x.id === v.itemId) : db.publications.some((x) => x.id === v.itemId);
    if (!exists) throw new HttpError(404);
    if (!list.includes(v.itemId)) list.push(v.itemId);
    audit("Linked to project", "project", p.id, `${v.kind} #${v.itemId}`);
    return wait(projectView(u, p));
  },
  unlinkFromProject: (v: { id: number; kind: "award" | "grant" | "publication"; itemId: number }): Promise<ProjectView> => {
    const u = mockUser();
    const p = db.projects.find((x) => x.id === v.id);
    if (!p) throw new HttpError(404);
    if (!canEditProject(u, p)) throw new HttpError(403);
    const key = v.kind === "award" ? "awardIds" : v.kind === "grant" ? "grantIds" : "publicationIds";
    p[key] = p[key].filter((x) => x !== v.itemId);
    audit("Unlinked from project", "project", p.id, `${v.kind} #${v.itemId}`);
    return wait(projectView(u, p));
  },
};

/* ------------------------------------------------------------------- real */

export const real: typeof mock = {
  periods: () => http("/periods"),
  closePeriod: (id) => http(`/periods/${id}/close`, { method: "POST" }),
  unitRollup: (unitId, periodId) => http(`/reports/units/${unitId}${qs({ periodId })}`),
  extReport: (slug, p) => http(`/reports/${slug}${qs({ ...p })}`),
  savedReports: () => http("/report-definitions"),
  saveReport: (r) => http("/report-definitions", { method: "POST", body: JSON.stringify(r) }),
  deleteSavedReport: (id) => http(`/report-definitions/${id}`, { method: "DELETE" }),
  startExport: (e) => http(`/reports/${e.slug}/export`, { method: "POST", body: JSON.stringify({ params: e.params, format: e.format }) }),
  exportJob: (jobId) => http(`/exports/${jobId}`),
  projects: () => http("/projects"),
  project: (id) => http(`/projects/${id}`),
  saveProject: (v) => (v.id ? http(`/projects/${v.id}`, { method: "PUT", body: JSON.stringify(v) }) : http("/projects", { method: "POST", body: JSON.stringify(v) })),
  linkToProject: (v) => http(`/projects/${v.id}/links`, { method: "POST", body: JSON.stringify({ kind: v.kind, itemId: v.itemId }) }),
  unlinkFromProject: (v) => http(`/projects/${v.id}/links/${v.kind}/${v.itemId}`, { method: "DELETE" }),
};
