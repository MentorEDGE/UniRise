import { AGENCIES, PUB_TYPES, QUARTILES, SCHOLAR_STAGES, type Agency, type AnalyticsDataset, type DeptYear, type PubType, type Quartile } from "@/mock/analytics";

export type Period = "3y" | "5y" | "all";
export const periodLabel: Record<Period, string> = { "3y": "Last 3 years", "5y": "Last 5 years", all: "All years" };

export interface Filters { period: Period; school: string; dept: string; year: number | null }

export interface Totals {
  publications: number;
  byType: Record<PubType, number>;
  byQuartile: Record<Quartile, number>;
  citations: number;
  openAccess: number;
  grantsApplied: number;
  grantsSanctioned: number;
  sanctionedAmount: number;
  byAgency: Record<Agency, number>;
}

const zero = <K extends string>(keys: readonly K[]) => Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>;
const sumValues = (o: Record<string, number>) => Object.values(o).reduce((s, x) => s + x, 0);
export const pct = (part: number, whole: number) => (whole ? (part / whole) * 100 : 0);

export function total(rows: DeptYear[]): Totals {
  const t: Totals = {
    publications: 0, byType: zero(PUB_TYPES), byQuartile: zero(QUARTILES), citations: 0, openAccess: 0,
    grantsApplied: 0, grantsSanctioned: 0, sanctionedAmount: 0, byAgency: zero(AGENCIES),
  };
  for (const r of rows) {
    t.publications += sumValues(r.byType);
    for (const k of PUB_TYPES) t.byType[k] += r.byType[k];
    for (const k of QUARTILES) t.byQuartile[k] += r.byQuartile[k];
    for (const k of AGENCIES) t.byAgency[k] += r.byAgency[k];
    t.citations += r.citations;
    t.openAccess += r.openAccess;
    t.grantsApplied += r.grantsApplied;
    t.grantsSanctioned += r.grantsSanctioned;
    t.sanctionedAmount += r.sanctionedAmount;
  }
  return t;
}

/** Years covered by the period, oldest first. */
export const periodYears = (ds: AnalyticsDataset, p: Period) => (p === "all" ? ds.years : ds.years.slice(p === "3y" ? -3 : -5));

/** Departments in the school/department filter. */
export function scopeDepts(ds: AnalyticsDataset, f: Pick<Filters, "school" | "dept">) {
  if (f.dept) return ds.departments.filter((d) => d.id === f.dept);
  return f.school ? ds.departments.filter((d) => d.school === f.school) : ds.departments;
}

const rowsFor = (ds: AnalyticsDataset, depts: Set<string>, years: number[]) => ds.rows.filter((r) => depts.has(r.dept) && years.includes(r.year));

/** The years the headline figures and breakdowns cover: one picked year, or the whole period. */
export const selectedYears = (ds: AnalyticsDataset, f: Filters) => (f.year ? [f.year] : periodYears(ds, f.period));

/** The same number of years just before `years`, or null when the data doesn't reach back that far. */
export function previousYears(ds: AnalyticsDataset, years: number[]) {
  const prev = years.map((y) => y - years.length);
  return prev.every((y) => ds.years.includes(y)) ? prev : null;
}

export interface Kpis { now: Totals; before: Totals | null; faculty: number }

export function kpis(ds: AnalyticsDataset, f: Filters): Kpis {
  const depts = scopeDepts(ds, f);
  const ids = new Set(depts.map((d) => d.id));
  const years = selectedYears(ds, f);
  const prev = previousYears(ds, years);
  return {
    now: total(rowsFor(ds, ids, years)),
    before: prev ? total(rowsFor(ds, ids, prev)) : null,
    faculty: depts.reduce((s, d) => s + d.faculty, 0),
  };
}

/** Per-year figures across the period, for the trend charts and tile sparklines. */
export function trend(ds: AnalyticsDataset, f: Filters) {
  const ids = new Set(scopeDepts(ds, f).map((d) => d.id));
  return periodYears(ds, f.period).map((year) => {
    const t = total(rowsFor(ds, ids, [year]));
    return {
      year, ...t.byType, ...t.byQuartile,
      publications: t.publications,
      citations: t.citations,
      funding: t.sanctionedAmount,
      successRate: Math.round(pct(t.grantsSanctioned, t.grantsApplied) * 10) / 10,
      openAccessShare: Math.round(pct(t.openAccess, t.publications) * 10) / 10,
      q1Share: Math.round(pct(t.byQuartile.Q1, t.byType["Journal article"]) * 10) / 10,
    };
  });
}
export type TrendRow = ReturnType<typeof trend>[number];

/** One row per department in the school filter (the department filter only highlights, so the comparison stays). */
export function byDepartment(ds: AnalyticsDataset, f: Filters) {
  const years = selectedYears(ds, f);
  return scopeDepts(ds, { school: f.school, dept: "" }).map((d) => {
    const t = total(rowsFor(ds, new Set([d.id]), years));
    return {
      id: d.id, name: d.name, school: d.school, faculty: d.faculty,
      publications: t.publications,
      perFaculty: Math.round((t.publications / d.faculty / years.length) * 100) / 100,
      citations: t.citations,
      q1Share: Math.round(pct(t.byQuartile.Q1, t.byType["Journal article"]) * 10) / 10,
      openAccessShare: Math.round(pct(t.openAccess, t.publications) * 10) / 10,
      funding: t.sanctionedAmount,
      successRate: Math.round(pct(t.grantsSanctioned, t.grantsApplied) * 10) / 10,
    };
  });
}
export type DeptRow = ReturnType<typeof byDepartment>[number];

export function byAgency(ds: AnalyticsDataset, f: Filters) {
  const ids = new Set(scopeDepts(ds, f).map((d) => d.id));
  const t = total(rowsFor(ds, ids, selectedYears(ds, f)));
  return AGENCIES.map((agency) => ({ agency, amount: t.byAgency[agency] })).sort((a, b) => b.amount - a.amount);
}

export function scholarsByStage(ds: AnalyticsDataset, f: Filters) {
  const ids = new Set(scopeDepts(ds, f).map((d) => d.id));
  return SCHOLAR_STAGES.map((stage) => ({
    stage,
    count: ds.scholars.filter((s) => s.stage === stage && ids.has(s.dept)).reduce((n, s) => n + s.count, 0),
  }));
}

export function topResearchers(ds: AnalyticsDataset, f: Filters) {
  const ids = new Set(scopeDepts(ds, f).map((d) => d.id));
  const idx = selectedYears(ds, f).map((y) => ds.years.indexOf(y));
  const deptName = new Map(ds.departments.map((d) => [d.id, d.name]));
  return ds.researchers.filter((r) => ids.has(r.dept)).map((r) => ({
    id: r.id, name: r.name, designation: r.designation, department: deptName.get(r.dept) ?? r.dept,
    publications: idx.reduce((s, i) => s + r.publications[i], 0),
    citations: idx.reduce((s, i) => s + r.citations[i], 0),
    hIndex: r.hIndex,
    spark: r.publications,
  }));
}
export type ResearcherRow = ReturnType<typeof topResearchers>[number];
