import { describe, expect, it } from "vitest";
import { sampleAnalytics } from "@/mock/analytics";
import { byAgency, byDepartment, kpis, periodYears, previousYears, scholarsByStage, topResearchers, trend, type Filters } from "./aggregate";

const ds = sampleAnalytics();
const all: Filters = { period: "all", school: "", dept: "", year: null };

describe("analytics sample data", () => {
  it("is the same on every call", () => {
    expect(sampleAnalytics()).toBe(ds);
    expect(ds.rows).toHaveLength(ds.departments.length * ds.years.length);
  });

  it("splits publications into types and articles into quartiles without losing any", () => {
    for (const r of ds.rows) {
      const articles = r.byType["Journal article"];
      expect(Object.values(r.byQuartile).reduce((s, x) => s + x, 0)).toBe(articles);
      expect(Object.values(r.byAgency).reduce((s, x) => s + x, 0)).toBe(r.sanctionedAmount);
      expect(r.grantsSanctioned).toBeLessThanOrEqual(r.grantsApplied);
    }
  });
});

describe("aggregation", () => {
  it("trend totals match the headline figure for the whole period", () => {
    const t = trend(ds, all);
    expect(t.map((r) => r.year)).toEqual(ds.years);
    expect(t.reduce((s, r) => s + r.publications, 0)).toBe(kpis(ds, all).now.publications);
  });

  it("department rows add up to the institution", () => {
    const rows = byDepartment(ds, all);
    expect(rows.reduce((s, r) => s + r.publications, 0)).toBe(kpis(ds, all).now.publications);
    expect(rows.reduce((s, r) => s + r.funding, 0)).toBe(byAgency(ds, all).reduce((s, r) => s + r.amount, 0));
  });

  it("a school filter narrows every view to its departments", () => {
    const f: Filters = { ...all, school: "School of Sciences" };
    const ids = ds.departments.filter((d) => d.school === f.school).map((d) => d.name);
    expect(byDepartment(ds, f).map((r) => r.name).sort()).toEqual(ids.sort());
    expect(topResearchers(ds, f).every((r) => ids.includes(r.department))).toBe(true);
    expect(kpis(ds, f).now.publications).toBeLessThan(kpis(ds, all).now.publications);
  });

  it("the department filter keeps the comparison but narrows the headline figures", () => {
    const f: Filters = { ...all, dept: "cse" };
    expect(byDepartment(ds, f)).toHaveLength(ds.departments.length);
    expect(kpis(ds, f).now.publications).toBe(byDepartment(ds, all).find((d) => d.id === "cse")!.publications);
    expect(scholarsByStage(ds, f).reduce((s, r) => s + r.count, 0)).toBe(ds.scholars.filter((s) => s.dept === "cse").reduce((n, s) => n + s.count, 0));
  });

  it("compares with the same number of years just before, when there is data", () => {
    expect(periodYears(ds, "3y")).toEqual([2023, 2024, 2025]);
    expect(previousYears(ds, [2023, 2024, 2025])).toEqual([2020, 2021, 2022]);
    expect(previousYears(ds, periodYears(ds, "5y"))).toEqual([2016, 2017, 2018, 2019, 2020]);
    expect(previousYears(ds, periodYears(ds, "all"))).toBeNull();
    expect(kpis(ds, { ...all, year: 2016 }).before).toBeNull();
    expect(kpis(ds, { ...all, year: 2024 }).before).not.toBeNull();
  });
});
