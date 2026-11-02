import type { Award, MeetingLog, Milestone, OrgUnit, Publication, Relationship, Researcher, Suggestion } from "@/lib/types";

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
