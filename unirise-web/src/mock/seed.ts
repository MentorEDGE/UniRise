import type { Award, Grant, MeetingLog, Milestone, OrgUnit, PubAuthor, Publication, Relationship, Researcher, SeedProposal, SeedWindow, Suggestion } from "@/lib/types";

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
  ["Aditi Kapoor", 1, 3, 20], ["Karthik Reddy", 1, 2, -18], ["Sneha Joshi", 2, 4, 60], ["Farhan Ali", 3, 1, -40],
] as const;

export const scholars: Researcher[] = scholarSeed.map(([name, departmentId], i) => ({
  id: faculty.length + 1 + i,
  name,
  title: "PhD Scholar",
  kind: "scholar",
  rollNo: `RS24${101 + i}`,
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
];

export const meetings: MeetingLog[] = [
  { id: 1, scholarId: scholars[0].id, mentorId: 2, heldOn: daysFromNow(-12), notes: "Reviewed the literature map; agreed to draft chapter 2 by month end." },
  { id: 2, scholarId: scholars[0].id, mentorId: 2, heldOn: daysFromNow(-45), notes: "Discussed proposal feedback and the revised methodology." },
  { id: 3, scholarId: scholars[1].id, mentorId: 2, heldOn: daysFromNow(-70), notes: "Proposal defence date still to be fixed; draft not yet shared." },
  { id: 4, scholarId: scholars[2].id, mentorId: 4, heldOn: daysFromNow(-8), notes: "Lab results on track; second review scheduled." },
  { id: 5, scholarId: scholars[3].id, mentorId: 7, heldOn: daysFromNow(-95), notes: "Coursework exam still pending." },
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
