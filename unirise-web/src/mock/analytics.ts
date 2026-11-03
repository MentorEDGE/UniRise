// Sample data for the analytics dashboard. Generated from a fixed seed so every visit shows the same figures.
// Nothing here is real: names, departments and amounts are made up to show what the dashboard looks like once filled.

export const ANALYTICS_YEARS = [2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025] as const;
export const PUB_TYPES = ["Journal article", "Conference paper", "Book chapter", "Patent"] as const;
export const QUARTILES = ["Q1", "Q2", "Q3", "Q4"] as const;
export const AGENCIES = ["SERB", "DST", "DBT", "ICMR", "CSIR", "Industry", "International"] as const;
export const SCHOLAR_STAGES = ["Coursework", "Synopsis approved", "Data collection", "Thesis writing", "Thesis submitted", "Degree awarded"] as const;

export type PubType = (typeof PUB_TYPES)[number];
export type Quartile = (typeof QUARTILES)[number];
export type Agency = (typeof AGENCIES)[number];

export interface AnalyticsDepartment { id: string; name: string; school: string; faculty: number }

/** One department in one year. */
export interface DeptYear {
  dept: string;
  year: number;
  byType: Record<PubType, number>;
  /** Journal articles only, by the journal's quartile. */
  byQuartile: Record<Quartile, number>;
  citations: number;
  openAccess: number;
  grantsApplied: number;
  grantsSanctioned: number;
  sanctionedAmount: number;
  byAgency: Record<Agency, number>;
}

export interface AnalyticsResearcher {
  id: number; name: string; dept: string; designation: string;
  /** Publications per year, aligned with ANALYTICS_YEARS. */
  publications: number[];
  citations: number[];
  hIndex: number;
}

export interface AnalyticsDataset {
  sample: true;
  asOf: string;
  years: number[];
  departments: AnalyticsDepartment[];
  rows: DeptYear[];
  researchers: AnalyticsResearcher[];
  /** Current PhD scholars by stage, per department. */
  scholars: { dept: string; stage: string; count: number }[];
}

/** Small deterministic PRNG (mulberry32). */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DEPARTMENTS: (AnalyticsDepartment & { rate: number; growth: number; mix: [number, number, number, number]; q1: number; grantSize: number })[] = [
  { id: "cse", name: "Computer Science", school: "School of Engineering", faculty: 42, rate: 2.6, growth: 1.11, mix: [0.48, 0.44, 0.05, 0.03], q1: 0.34, grantSize: 3_200_000 },
  { id: "ece", name: "Electronics and Communication", school: "School of Engineering", faculty: 34, rate: 2.1, growth: 1.08, mix: [0.52, 0.38, 0.04, 0.06], q1: 0.28, grantSize: 2_800_000 },
  { id: "mech", name: "Mechanical Engineering", school: "School of Engineering", faculty: 31, rate: 1.6, growth: 1.06, mix: [0.62, 0.26, 0.05, 0.07], q1: 0.22, grantSize: 2_400_000 },
  { id: "phy", name: "Physics", school: "School of Sciences", faculty: 24, rate: 2.3, growth: 1.05, mix: [0.86, 0.1, 0.04, 0], q1: 0.41, grantSize: 3_600_000 },
  { id: "chem", name: "Chemistry", school: "School of Sciences", faculty: 27, rate: 2.5, growth: 1.07, mix: [0.84, 0.06, 0.04, 0.06], q1: 0.38, grantSize: 3_100_000 },
  { id: "math", name: "Mathematics", school: "School of Sciences", faculty: 19, rate: 1.4, growth: 1.04, mix: [0.9, 0.06, 0.04, 0], q1: 0.26, grantSize: 1_200_000 },
  { id: "bio", name: "Biotechnology", school: "School of Life Sciences", faculty: 26, rate: 2.2, growth: 1.12, mix: [0.8, 0.08, 0.06, 0.06], q1: 0.36, grantSize: 4_200_000 },
  { id: "pharm", name: "Pharmaceutical Sciences", school: "School of Life Sciences", faculty: 22, rate: 1.9, growth: 1.09, mix: [0.78, 0.07, 0.07, 0.08], q1: 0.3, grantSize: 3_800_000 },
];

// Which agencies each school tends to win from (weights, same order as AGENCIES).
const AGENCY_WEIGHTS: Record<string, number[]> = {
  "School of Engineering": [0.24, 0.22, 0.02, 0.01, 0.08, 0.33, 0.1],
  "School of Sciences": [0.34, 0.3, 0.06, 0.02, 0.18, 0.04, 0.06],
  "School of Life Sciences": [0.16, 0.12, 0.3, 0.22, 0.08, 0.07, 0.05],
};

const FIRST = ["Aarav", "Ananya", "Vikram", "Meera", "Rohan", "Kavya", "Arjun", "Ishita", "Siddharth", "Nandini", "Karthik", "Priya", "Aditya", "Shreya", "Rahul", "Divya", "Nikhil", "Pooja", "Varun", "Lakshmi", "Manish", "Sneha", "Harish", "Tanvi"];
const LAST = ["Iyer", "Menon", "Rao", "Kulkarni", "Nair", "Banerjee", "Deshpande", "Pillai", "Chatterjee", "Reddy", "Joshi", "Mehta", "Bhat", "Krishnan", "Saxena", "Varma"];
const DESIGNATIONS = ["Professor", "Associate Professor", "Assistant Professor"];

/** Split `total` into whole numbers following `weights`; the remainder goes to the largest shares. */
function split(total: number, weights: number[]): number[] {
  const sum = weights.reduce((s, w) => s + w, 0) || 1;
  const raw = weights.map((w) => (total * w) / sum);
  const out = raw.map(Math.floor);
  let left = total - out.reduce((s, x) => s + x, 0);
  const order = raw.map((r, i) => [r - Math.floor(r), i] as const).sort((a, b) => b[0] - a[0]);
  for (let k = 0; left > 0; k = (k + 1) % order.length, left--) out[order[k][1]]++;
  return out;
}
const zip = <K extends string>(keys: readonly K[], vals: number[]) => Object.fromEntries(keys.map((k, i) => [k, vals[i]])) as Record<K, number>;

let cached: AnalyticsDataset | null = null;

export function sampleAnalytics(): AnalyticsDataset {
  if (cached) return cached;
  const r = rng(20261103);
  const jitter = (spread: number) => 1 + (r() * 2 - 1) * spread;
  const years = [...ANALYTICS_YEARS];
  const rows: DeptYear[] = [];

  for (const d of DEPARTMENTS) {
    for (const [i, year] of years.entries()) {
      const covidDip = year === 2020 ? 0.86 : year === 2021 ? 0.94 : 1;
      const total = Math.round(d.faculty * d.rate * 0.7 * d.growth ** (i * 0.8) * covidDip * jitter(0.12));
      const types = split(total, d.mix.map((m) => m * jitter(0.15)));
      const articles = types[0];
      const q1 = Math.min(0.6, d.q1 - 0.05 + i * 0.015) * jitter(0.1);
      const quart = split(articles, [q1, 0.34, 0.22, Math.max(0.05, 0.44 - q1 - 0.1)]);
      const age = 2025 - year; // older papers have had longer to collect citations
      const citations = Math.round(total * (9 + age * 1.1) * (0.7 + q1) * jitter(0.18));
      const oaShare = Math.min(0.8, 0.24 + i * 0.05) * jitter(0.08);
      const applied = Math.max(2, Math.round(d.faculty * 0.5 * (1 + i * 0.04) * jitter(0.2)));
      const successRate = Math.min(0.55, (0.22 + i * 0.016) * jitter(0.25));
      const sanctioned = Math.max(1, Math.round(applied * successRate));
      const amount = Math.round((sanctioned * d.grantSize * (1 + i * 0.05) * jitter(0.3)) / 10_000) * 10_000;
      const agencyAmounts = split(Math.round(amount / 10_000), AGENCY_WEIGHTS[d.school].map((w) => w * jitter(0.35))).map((x) => x * 10_000);
      rows.push({
        dept: d.id, year,
        byType: zip(PUB_TYPES, types),
        byQuartile: zip(QUARTILES, quart),
        citations,
        openAccess: Math.round(total * oaShare),
        grantsApplied: applied,
        grantsSanctioned: sanctioned,
        sanctionedAmount: amount,
        byAgency: zip(AGENCIES, agencyAmounts),
      });
    }
  }

  const researchers: AnalyticsResearcher[] = [];
  let id = 1;
  const used = new Set<string>();
  for (const d of DEPARTMENTS) {
    for (let k = 0; k < 6; k++) {
      let name = "";
      do name = `Dr. ${FIRST[Math.floor(r() * FIRST.length)]} ${LAST[Math.floor(r() * LAST.length)]}`; while (used.has(name));
      used.add(name);
      const strength = (1.6 - k * 0.2) * jitter(0.25);
      const publications = years.map((_, i) => Math.max(0, Math.round(d.rate * 1.6 * strength * d.growth ** (i * 0.8) * jitter(0.35))));
      const citations = publications.map((p, i) => Math.round(p * (3 + (years.length - 1 - i) * 3.6) * jitter(0.3)));
      const totalCites = citations.reduce((s, c) => s + c, 0);
      researchers.push({
        id: id++, name, dept: d.id, designation: DESIGNATIONS[Math.min(2, Math.floor(k / 2))],
        publications, citations, hIndex: Math.max(4, Math.round(Math.sqrt(totalCites) * 0.55 * jitter(0.15))),
      });
    }
  }

  const scholars = DEPARTMENTS.flatMap((d) => {
    const total = Math.round(d.faculty * 1.4 * jitter(0.15));
    const counts = split(total, [0.22, 0.2, 0.24, 0.16, 0.08, 0.1].map((w) => w * jitter(0.2)));
    return SCHOLAR_STAGES.map((stage, i) => ({ dept: d.id, stage, count: counts[i] }));
  });

  cached = {
    sample: true,
    asOf: "2026-11-03",
    years,
    departments: DEPARTMENTS.map(({ id, name, school, faculty }) => ({ id, name, school, faculty })),
    rows,
    researchers,
    scholars,
  };
  return cached;
}
