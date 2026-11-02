import type {
  AccessLogEntry, Appointment, ApiKeyRow, Award, AuditEntry, ClassificationScheme, Dispute, Grant, HarvestRun, MeetingLog, Milestone, OrgUnit, Period, Project,
  PubAuthor, Publication, Relationship, Researcher, RoleGrant, SavedReport, SeedProposal, SeedWindow, Suggestion, Tenant, TenantSettings, Webhook,
} from "@/lib/types";

// Org tree: department ids 1-5 are kept so researcher.departmentId still points at them.
export const orgUnits: OrgUnit[] = [
  { id: 10, type: "institution", name: "Demo University" },
  { id: 11, parentId: 10, type: "school", name: "School of Sciences" },
  { id: 12, parentId: 10, type: "school", name: "School of Engineering" },
  { id: 13, parentId: 10, type: "school", name: "School of Management" },
  { id: 1, parentId: 12, type: "department", name: "Computer Science" },
  { id: 2, parentId: 11, type: "department", name: "Biotechnology" },
  { id: 3, parentId: 12, type: "department", name: "Mechanical Engineering" },
  { id: 4, parentId: 13, type: "department", name: "Management Studies" },
  { id: 5, parentId: 11, type: "department", name: "Physics" },
];

const DAY = 86_400_000;
export const daysFromNow = (n: number) => new Date(Date.now() + n * DAY).toISOString().slice(0, 10);

const names = [
  ["Dr. Ananya Rao", "Professor", 1], ["Dr. Vikram Shah", "Associate Professor", 1], ["Dr. Meera Iyer", "Assistant Professor", 1],
  ["Dr. Rohan Mehta", "Professor", 2], ["Dr. Kavya Nair", "Associate Professor", 2], ["Dr. Sanjay Kulkarni", "Assistant Professor", 2],
  ["Dr. Priya Desai", "Professor", 3], ["Dr. Arjun Menon", "Associate Professor", 3], ["Dr. Neha Gupta", "Assistant Professor", 4],
  ["Dr. Rahul Verma", "Professor", 4], ["Dr. Lakshmi Pillai", "Associate Professor", 5], ["Dr. Imran Qureshi", "Professor", 5],
] as const;

export const faculty: Researcher[] = names.map(([name, title, departmentId], i) => ({
  id: i + 1,
  name,
  title,
  departmentId,
  email: name.replace(/Dr\. /, "").toLowerCase().replace(/ /g, ".") + "@university.example",
  orcid: i % 4 === 3 ? undefined : `0000-000${(i % 3) + 1}-${String(1000 + i * 37).padStart(4, "0")}-${String(2000 + i * 11).padStart(3, "0").slice(0, 3)}${i % 5 === 0 ? "X" : "1"}`,
  employeeId: `EMP${1001 + i}`,
  scopusId: i % 3 === 2 ? undefined : String(57200000000 + i * 7919),
  status: i === 2 ? "left" : "active",
  leftOn: i === 2 ? daysFromNow(-30) : undefined,
  orcidVerified: i % 4 === 0,
  publicProfile: [0, 3, 6].includes(i),
}));

const venues = ["Nature Communications", "IEEE Access", "Journal of Cleaner Production", "PLOS ONE", "Physical Review B", "Expert Systems with Applications", "ACM Computing Surveys", "Scientific Reports"];
const topics = ["Federated learning for rural healthcare", "CRISPR-based diagnostics for tropical diseases", "Lightweight alloys for EV chassis", "Digital adoption among small enterprises", "Quantum transport in two-dimensional materials", "Graph neural networks for drug discovery", "Energy-efficient edge inference", "Microbial fuel cells from agricultural waste", "Additive manufacturing of titanium lattices", "Behavioural nudges in microfinance", "Topological phases in photonic crystals", "Explainable AI for credit scoring"];
const types: Publication["type"][] = ["journal-article", "journal-article", "conference-paper", "journal-article", "book-chapter", "preprint"];
const states: Publication["state"][] = ["verified", "verified", "verified", "suggested", "unverified"];
const sources: Publication["source"][] = ["crossref", "orcid", "openalex", "manual"];

export const publications: Publication[] = Array.from({ length: 48 }, (_, i) => {
  const a = (i % faculty.length) + 1;
  const b = ((i * 5 + 3) % faculty.length) + 1;
  return {
    id: i + 1,
    title: `${topics[i % topics.length]}${i >= topics.length ? `: study ${Math.floor(i / topics.length) + 1}` : ""}`,
    doi: i % 7 === 6 ? undefined : `10.${1000 + (i % 9) * 111}/rms.${2018 + (i % 8)}.${String(i + 100)}`,
    venue: venues[i % venues.length],
    type: types[i % types.length],
    year: 2018 + (i % 9),
    authorIds: a === b ? [a] : [a, b],
    state: states[i % states.length],
    source: sources[i % sources.length],
  };
});

export const awards: Award[] = [
  { id: 1, title: "AI for Public Health Surveillance", funder: "DST-SERB", amount: 4800000, startYear: 2023, endYear: 2026, researcherId: 1 },
  { id: 2, title: "Bio-sensor Platform for Water Quality", funder: "DBT", amount: 3200000, startYear: 2022, endYear: 2025, researcherId: 4 },
  { id: 3, title: "Lightweight Chassis Materials", funder: "Tata Motors (Industry)", amount: 2500000, startYear: 2024, endYear: 2026, researcherId: 7 },
  { id: 4, title: "Fintech Adoption in Tier-3 Cities", funder: "ICSSR", amount: 1200000, startYear: 2023, endYear: 2025, researcherId: 10 },
  { id: 5, title: "Photonic Quantum Devices", funder: "ANRF", amount: 6500000, startYear: 2024, endYear: 2028, researcherId: 12 },
  { id: 6, title: "Edge AI for Agriculture", funder: "Microsoft Research", amount: 1800000, startYear: 2025, endYear: 2027, researcherId: 2 },
];

export const suggestions: Suggestion[] = publications
  .filter((p) => p.state === "suggested")
  .slice(0, 6)
  .map((p, i) => ({
    id: i + 1,
    publication: p,
    researcherId: ((i * 2) % faculty.length) + 1,
    score: [0.97, 0.91, 0.86, 0.79, 0.72, 0.64][i],
    reason: ["ORCID iD match on author record", "Exact DOI found in ORCID works", "Surname + title keywords + year match", "Co-author overlap with verified papers", "Surname and affiliation match", "Title similarity only"][i],
  }));

// PhD scholars: [name, departmentId, milestones done, days until the next milestone is due (negative = overdue)]
const scholarSeed = [
  ["Aditi Kapoor", 1, 3, 20], ["Karthik Reddy", 1, 2, -18], ["Sneha Joshi", 2, 4, 60], ["Farhan Ali", 3, 1, -40], ["Ritu Sen", 1, 2, 9],
] as const;

export const scholars: Researcher[] = scholarSeed.map(([name, departmentId], i) => ({
  id: faculty.length + 1 + i,
  name,
  title: "PhD Scholar",
  kind: "scholar",
  rollNo: `RS24${101 + i}`,
  status: "active",
  departmentId,
  email: name.toLowerCase().replace(/ /g, ".") + "@university.example",
}));

export const researchers: Researcher[] = [...faculty, ...scholars];

export const stageNames = ["Registration", "Coursework", "Proposal defence", "Progress review 1", "Progress review 2", "Thesis submission", "Viva"];

export const milestones: Milestone[] = scholarSeed.flatMap(([, , done, nextDue], s) =>
  stageNames.map((stage, i): Milestone => {
    const offset = i < done ? -(done - i) * 90 : nextDue + (i - done) * 120;
    return { id: s * 10 + i + 1, scholarId: scholars[s].id, stage, dueDate: daysFromNow(offset), completedAt: i < done ? daysFromNow(offset + 3) : undefined };
  }));

// Supervisors: Vikram Shah (id 2), Rohan Mehta (4), Priya Desai (7).
export const relationships: Relationship[] = [
  { id: 1, mentorId: 2, menteeId: scholars[0].id, type: "primary" },
  { id: 2, mentorId: 2, menteeId: scholars[1].id, type: "primary" },
  { id: 3, mentorId: 4, menteeId: scholars[2].id, type: "primary" },
  { id: 4, mentorId: 7, menteeId: scholars[3].id, type: "primary" },
  { id: 5, mentorId: 3, menteeId: scholars[4].id, type: "primary", validFrom: daysFromNow(-420) }, // Dr. Meera Iyer has left and there is no backup
  { id: 6, mentorId: 5, menteeId: scholars[2].id, type: "backup" },
  { id: 7, mentorId: 6, menteeId: scholars[2].id, type: "co" },
];

export const meetings: MeetingLog[] = [
  { id: 1, scholarId: scholars[0].id, mentorId: 2, heldOn: daysFromNow(-12), notes: "Reviewed the literature map; agreed to draft chapter 2 by month end." },
  { id: 2, scholarId: scholars[0].id, mentorId: 2, heldOn: daysFromNow(-45), notes: "Discussed proposal feedback and the revised methodology." },
  { id: 3, scholarId: scholars[1].id, mentorId: 2, heldOn: daysFromNow(-70), notes: "Proposal defence date still to be fixed; draft not yet shared." },
  { id: 4, scholarId: scholars[2].id, mentorId: 4, heldOn: daysFromNow(-8), notes: "Lab results on track; second review scheduled." },
  { id: 5, scholarId: scholars[3].id, mentorId: 7, heldOn: daysFromNow(-95), notes: "Coursework exam still pending." },
  { id: 6, scholarId: scholars[4].id, mentorId: 3, heldOn: daysFromNow(-50), notes: "Agreed the progress review 1 timeline." },
];

/* ---- Richer publication records: categories, outside authors, student publications, a few entries awaiting review ---- */
const unitName = (id: number) => orgUnits.find((u) => u.id === id)?.name;
const asAuthor = (id: number): PubAuthor => {
  const r = researchers.find((x) => x.id === id)!;
  return { kind: r.kind === "scholar" ? "internal-student" : "internal-faculty", researcherId: id, name: r.name, institution: "Demo University", department: unitName(r.departmentId), email: r.email };
};
const outside: PubAuthor[] = [
  { kind: "external", name: "Dr. Li Wei", institution: "Tsinghua University", continent: "Asia" },
  { kind: "external", name: "Prof. Anna Keller", institution: "ETH Zurich", continent: "Europe" },
  { kind: "external", name: "Dr. Maria Santos", institution: "University of Sao Paulo", continent: "South America" },
  { kind: "ex-faculty", name: "Dr. Omar Haddad", institution: "Demo University", department: "Physics", endDate: "2024-06-30", continent: "Asia" },
];
const categories = ["Research Article", "Review Article", "Short Communication"];
publications.forEach((p, i) => {
  if (i % 6 === 0) p.authorIds = [...p.authorIds, scholars[i % scholars.length].id];
  p.authors = [...p.authorIds.map(asAuthor), ...(i % 4 === 1 ? [outside[Math.floor(i / 4) % outside.length]] : [])];
  p.studentPublication = p.authorIds.some((id) => researchers.find((r) => r.id === id)?.kind === "scholar");
  if (p.type === "journal-article") { p.category = categories[i % 3]; p.month = (i % 12) + 1; p.issn = String(20452300 + i); }
  p.projectRef = i % 5 === 0;
  if (i % 11 === 10) { p.entryStatus = "submitted"; p.state = "unverified"; p.source = "manual"; }
  if (i % 13 === 12) { p.entryStatus = "draft"; p.state = "unverified"; p.source = "manual"; }
});

publications.forEach((p, i) => {
  if (p.type === "journal-article" || p.type === "conference-paper") {
    p.oaStatus = (["gold", "green", "hybrid", "closed"] as const)[i % 4];
    p.funderMandate = p.projectRef ? (p.oaStatus === "closed" ? "non-compliant" : "compliant") : "not-applicable";
    if (p.oaStatus === "green") p.repositoryUrl = `https://repository.university.example/handle/123456789/${1000 + i}`;
  }
  p.version = 1;
});
// Probable duplicates for the merge screen: same DOI in different case, and a preprint of a published paper.
const base5 = publications[4];
publications.push(
  { ...structuredClone(base5), id: 49, doi: base5.doi?.toUpperCase(), source: "openalex", state: "suggested", entryStatus: undefined, version: 1 },
  { ...structuredClone(publications[9]), id: 50, type: "preprint", venue: "arXiv", doi: undefined, source: "openalex", state: "suggested", entryStatus: undefined, year: publications[9].year - 1, version: 1 },
);

/* ---- External grants ---- */
const inv = (id: number, role: "PI" | "Co-PI" | "Collaborator", isLead: boolean, sharePct: number) => {
  const r = researchers.find((x) => x.id === id)!;
  return { researcherId: id, name: r.name, role, isLead, institution: "Demo University", department: unitName(r.departmentId), sharePct };
};
export const grants: Grant[] = [
  { id: 1, unit: "Indian Grant", status: "sanctioned", type: "Research", utn: "UTN-2301", title: "AI for Public Health Surveillance", description: "Early-warning models for district health data.", callTitle: "National AI for Health 2023", source: "Central Government", agency: "DST-SERB", appliedOn: daysFromNow(-900), enteredOn: daysFromNow(-895), sanctionedOn: daysFromNow(-760), appliedAmount: 5200000, sanctionedAmount: 4800000, durationMonths: 36, matchingGrant: false, contact: "9800000001", investigators: [inv(1, "PI", true, 70), inv(2, "Co-PI", false, 30)], enclosures: [{ name: "proposal.pdf" }, { name: "budget.pdf" }], ownerId: 1 },
  { id: 2, unit: "Indian Grant", status: "sanctioned", type: "Research", utn: "UTN-2208", title: "Bio-sensor Platform for Water Quality", source: "Central Government", agency: "DBT", appliedOn: daysFromNow(-1200), enteredOn: daysFromNow(-1195), sanctionedOn: daysFromNow(-1050), appliedAmount: 3500000, sanctionedAmount: 3200000, durationMonths: 36, matchingGrant: true, investigators: [inv(4, "PI", true, 100)], enclosures: [{ name: "proposal.pdf" }], ownerId: 4 },
  { id: 3, unit: "Industry Grant", status: "sanctioned", type: "Consultancy", title: "Lightweight Chassis Materials", source: "Industry", agency: "Tata Motors", appliedOn: daysFromNow(-500), enteredOn: daysFromNow(-498), sanctionedOn: daysFromNow(-420), appliedAmount: 2500000, sanctionedAmount: 2500000, durationMonths: 24, matchingGrant: false, investigators: [inv(7, "PI", true, 60), inv(8, "Co-PI", false, 40)], enclosures: [], ownerId: 7 },
  { id: 4, unit: "International Grant", status: "submitted", type: "Research", title: "Photonic Quantum Devices", callTitle: "Quantum Futures Call", source: "International", agency: "European Research Council", appliedOn: daysFromNow(-60), enteredOn: daysFromNow(-58), appliedAmount: 8000000, durationMonths: 48, matchingGrant: false, investigators: [inv(12, "PI", true, 50), { name: "Prof. Anna Keller", role: "Collaborator", isLead: false, institution: "ETH Zurich", sharePct: 50 }], enclosures: [{ name: "proposal.pdf" }], ownerId: 12 },
  { id: 5, unit: "Indian Grant", status: "draft", type: "Research", title: "Edge AI for Agriculture", source: "State Government", agency: "Karnataka Science Council", appliedOn: daysFromNow(-5), enteredOn: daysFromNow(-5), appliedAmount: 1800000, matchingGrant: false, investigators: [inv(2, "PI", true, 100)], enclosures: [], ownerId: 2 },
  { id: 6, unit: "Indian Grant", status: "rework", type: "Research", title: "Fintech Adoption in Tier-3 Cities", source: "Central Government", agency: "ICSSR", appliedOn: daysFromNow(-120), enteredOn: daysFromNow(-118), appliedAmount: 1200000, durationMonths: 24, matchingGrant: false, investigators: [inv(10, "PI", true, 100)], enclosures: [{ name: "proposal.pdf" }], ownerId: 10, reviewComment: "Budget heads do not add up to the applied amount." },
];

/* ---- Seed money ---- */
export const seedWindow: SeedWindow = { label: "Q4 2026", opensOn: daysFromNow(-20), closesOn: daysFromNow(25) };
const seedInv = (id: number, isLeadPI: boolean) => { const r = researchers.find((x) => x.id === id)!; return { researcherId: id, name: r.name, investigatorType: isLeadPI ? "Principal Investigator" : "Co-Investigator", isLeadPI, institution: "Demo University", department: unitName(r.departmentId) }; };
export const seedProposals: SeedProposal[] = [
  { id: 1, appliedOn: daysFromNow(-200), category: "Faculty seed money", title: "Low-cost soil sensor for smallholder farms", abstract: "Prototype and field-test a sensor that costs under INR 500.", windowLabel: "Q2 2026", status: "approved", investigators: [seedInv(2, true), seedInv(3, false)], ownerId: 2 },
  { id: 2, appliedOn: daysFromNow(-110), category: "Faculty seed money", title: "Peptide screening workflow", abstract: "Pilot data for an external grant application.", windowLabel: "Q3 2026", status: "rework", investigators: [seedInv(4, true)], ownerId: 4, reviewComment: "Add a budget break-up." },
  { id: 3, appliedOn: daysFromNow(-12), category: "Student seed money", title: "Open dataset of regional crop disease images", abstract: "Collect and label 5,000 images for model training.", windowLabel: "Q4 2026", status: "submitted", investigators: [seedInv(13, true), seedInv(2, false)], ownerId: 13 },
  { id: 4, appliedOn: daysFromNow(-3), category: "Faculty seed money", title: "Corrosion study of coated alloys", abstract: "Preliminary tests ahead of an industry proposal.", windowLabel: "Q4 2026", status: "draft", investigators: [seedInv(7, true)], ownerId: 7 },
  { id: 5, appliedOn: daysFromNow(-150), category: "Faculty seed money", title: "Behavioural survey on UPI adoption", abstract: "Pilot survey of 300 small merchants.", windowLabel: "Q3 2026", status: "rejected", investigators: [seedInv(9, true)], ownerId: 9, reviewComment: "Overlaps with an existing funded project." },
];


/* ===================== Added for the remaining RMS-doc features ===================== */
const unit = (id: number) => orgUnits.find((u) => u.id === id)!;
void unit;

/** One primary appointment per person, plus a transfer and two joint appointments (PRD R29). */
export const appointments: Appointment[] = [
  ...researchers.map((r, i): Appointment => ({ id: i + 1, researcherId: r.id, unitId: r.departmentId, designation: r.title, fte: 1, validFrom: r.kind === "scholar" ? "2024-07-01" : "2015-07-01" })),
];
// Dr. Arjun Menon (8) moved from Computer Science to Mechanical Engineering on 2022-01-01.
appointments[7] = { ...appointments[7], unitId: 1, validTo: "2021-12-31" };
appointments.push({ id: 100, researcherId: 8, unitId: 3, designation: "Associate Professor", fte: 1, validFrom: "2022-01-01" });
// Dr. Vikram Shah (2) has a joint appointment in Physics; Dr. Imran Qureshi (12) in Computer Science.
appointments.push({ id: 101, researcherId: 2, unitId: 5, designation: "Adjunct", fte: 0.25, validFrom: "2022-01-01" });
appointments.push({ id: 102, researcherId: 12, unitId: 1, designation: "Visiting", fte: 0.25, validFrom: "2023-01-01" });

export const roleGrants: RoleGrant[] = [
  { id: 1, holder: "Research Office Admin", role: "RESEARCH_ADMIN", validFrom: "2024-01-01", grantedBy: "Platform operator", kind: "direct" },
  { id: 2, holder: "Pro-VC (Research)", role: "EXECUTIVE", scopeUnitId: 10, validFrom: "2024-06-01", grantedBy: "Research Office Admin", kind: "direct" },
  { id: 3, researcherId: 4, holder: "Dr. Rohan Mehta", role: "DEAN", scopeUnitId: 11, validFrom: "2024-08-01", grantedBy: "Research Office Admin", kind: "direct" },
  { id: 4, researcherId: 7, holder: "Dr. Priya Desai", role: "HOD", scopeUnitId: 3, validFrom: "2023-07-01", validTo: daysFromNow(10), grantedBy: "Research Office Admin", kind: "direct", note: "Ends soon: confirm or renew" },
  { id: 5, researcherId: 8, holder: "Dr. Arjun Menon", role: "HOD", scopeUnitId: 3, validFrom: daysFromNow(-5), validTo: daysFromNow(25), grantedBy: "Dr. Priya Desai", kind: "acting", note: "Acting HoD while Dr. Desai is on leave" },
  { id: 6, holder: "IT Administrator", role: "IT_ADMIN", validFrom: "2024-01-01", grantedBy: "Platform operator", kind: "direct" },
  { id: 7, holder: "External examiner (A. Fischer)", role: "GUEST", validFrom: daysFromNow(-3), validTo: daysFromNow(11), grantedBy: "Research Office Admin", kind: "direct", note: "University-wide publications report only" },
  { id: 8, holder: "Registrar (read-only)", role: "VIEWER", validFrom: "2023-01-01", validTo: daysFromNow(-20), grantedBy: "Research Office Admin", kind: "direct", note: "Expired, still listed for access review" },
];

export const auditLog: AuditEntry[] = [
  { id: 1, at: daysFromNow(-9) + "T10:12:00", actor: "ananya.rao@university.example", action: "Confirmed authorship", entity: "publication", entityId: 14 },
  { id: 2, at: daysFromNow(-6) + "T15:40:00", actor: "admin@university.example", action: "Approved publication", entity: "publication", entityId: 11 },
  { id: 3, at: daysFromNow(-4) + "T09:05:00", actor: "admin@university.example", action: "Exported report", entity: "report", entityId: "pub-university" },
  { id: 4, at: daysFromNow(-2) + "T17:30:00", actor: "admin@university.example", action: "Granted acting role", entity: "role-grant", entityId: 5, detail: "Dr. Arjun Menon as HoD, Mechanical Engineering" },
];
export const accessLog: AccessLogEntry[] = [
  { id: 1, at: daysFromNow(-7) + "T11:02:00", actor: "provc.research@university.example", role: "EXECUTIVE", action: "drill-down", targetName: "Dr. Rohan Mehta", targetId: 4, note: "Opened a named profile; confidential data excluded" },
  { id: 2, at: daysFromNow(-3) + "T14:20:00", actor: "Platform support (R. Kumar)", role: "PLATFORM_ADMIN", action: "support-access", note: "Break-glass: investigating a failed CSV import. Expires after 2 hours." },
];

export const disputes: Dispute[] = [
  { id: 1, publicationId: 14, publicationTitle: publications[13].title, researcherId: 2, researcherName: "Dr. Vikram Shah", reason: "This paper was written by a namesake in another institution. I was never an author.", raisedOn: daysFromNow(-6), status: "open" },
];

export const periods: Period[] = [
  { id: 1, label: "FY 2024-25", startsOn: "2024-04-01", endsOn: "2025-03-31", closedAt: "2025-04-12", closedBy: "Research Office Admin" },
  { id: 2, label: "FY 2025-26", startsOn: "2025-04-01", endsOn: "2026-03-31" },
  { id: 3, label: "FY 2026-27", startsOn: "2026-04-01", endsOn: "2027-03-31" },
];

export const tenantSettings: TenantSettings = {
  name: "Demo University", logoText: "DU", accent: "#6d28d9", currency: "INR", fiscalYearStartMonth: 4, locale: "en-IN",
  publicProfilesEnabled: true, hodValidation: false, escalationDays: 30,
  sso: { provider: "microsoft", clientId: "demo-university-rms", domain: "university.example", status: "configured" },
};

export const classificationSchemes: ClassificationScheme[] = [
  { id: 1, code: "journal-quality", name: "Journal quality lists", terms: [
    { code: "UGC-CARE-I", label: "UGC-CARE Group I", validFrom: "2019-01-01", validTo: "2024-06-30" },
    { code: "SCOPUS", label: "Scopus indexed", validFrom: "2015-01-01" },
    { code: "WOS", label: "Web of Science indexed", validFrom: "2015-01-01" },
  ] },
  { id: 2, code: "grant-types", name: "Grant types", terms: [
    { code: "RES", label: "Research", validFrom: "2015-01-01" },
    { code: "CONS", label: "Consultancy", validFrom: "2015-01-01" },
    { code: "ERF", label: "ERF related", validFrom: "2020-01-01" },
  ] },
];

export const apiKeys: ApiKeyRow[] = [
  { id: 1, name: "HR sync (nightly)", prefix: "rms_a41f", createdOn: daysFromNow(-120), lastUsed: daysFromNow(-1) },
  { id: 2, name: "Old finance export", prefix: "rms_9c07", createdOn: daysFromNow(-400), revokedOn: daysFromNow(-60) },
];
export const webhooks: Webhook[] = [{ id: 1, url: "https://erp.university.example/hooks/rms", events: ["publication.approved", "grant.sanctioned"], active: true }];

export const harvestRuns: HarvestRun[] = [
  { id: 1, at: daysFromNow(-1) + "T02:00:00", source: "ORCID", researchers: 8, found: 31, newSuggestions: 4, status: "ok" },
  { id: 2, at: daysFromNow(-1) + "T02:12:00", source: "OpenAlex", researchers: 12, found: 58, newSuggestions: 6, status: "ok" },
  { id: 3, at: daysFromNow(-2) + "T02:03:00", source: "Crossref", researchers: 12, found: 0, newSuggestions: 0, status: "failed", note: "Crossref returned HTTP 503; retried with backoff and gave up after 3 attempts" },
];

const months = (base: number) => Array.from({ length: 6 }, (_, i) => { const d = new Date(); d.setMonth(d.getMonth() - (5 - i)); return { month: d.toISOString().slice(0, 7), count: Math.round(base * (0.85 + i * 0.03)) }; });
export const tenants: Tenant[] = [
  { id: 1, name: "Demo University", status: "active", plan: "Standard", createdOn: "2025-02-01", activeResearchers: months(1180) },
  { id: 2, name: "Sandbox College", status: "sandbox", plan: "Sandbox", createdOn: daysFromNow(-20), activeResearchers: months(14) },
  { id: 3, name: "Pilot Institute of Technology", status: "pilot", plan: "Pilot", createdOn: daysFromNow(-70), activeResearchers: months(240) },
  { id: 4, name: "Former Customer University", status: "suspended", plan: "Standard", createdOn: "2024-03-10", activeResearchers: months(430) },
];

export const projects: Project[] = [
  { id: 1, title: "AI for public health", leadId: 1, status: "active", awardIds: [1, 6], grantIds: [1], publicationIds: [1, 7, 13], summary: "Surveillance models and edge deployment for district health data.", sensitivity: "internal" },
  { id: 2, title: "Water and soil sensing", leadId: 4, status: "active", awardIds: [2], grantIds: [2], publicationIds: [2, 8], summary: "Bio-sensors for water quality and low-cost soil probes.", sensitivity: "internal" },
  { id: 3, title: "Industry chassis programme", leadId: 7, status: "active", awardIds: [3], grantIds: [3], publicationIds: [3], summary: "Industry-funded work under NDA: budget and partner details are restricted.", sensitivity: "confidential" },
];

export const savedReports: SavedReport[] = [
  { id: 1, name: "Publications 2023-2025", slug: "pub-university", params: { from: "2023-01-01", to: "2025-12-31" }, ownerId: 0, createdOn: daysFromNow(-30) },
];
