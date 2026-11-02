import { describe, expect, it } from "vitest";
import { api } from "@/lib/api";
import { db } from "@/mock/store";
import { call, signInAs } from "@/test/session";

const verified = (id: number, authorIds: number[], year: number) => db.publications.push({ id, title: `Test paper ${id}`, venue: "Test", type: "journal-article", year, authorIds, state: "verified", source: "manual", version: 1 });

describe("period close", () => {
  it("freezes the figures: a paper added later does not change the snapshot", async () => {
    signInAs("admin");
    await call(() => api.closePeriod(2));
    const before = (await call(() => api.unitRollup(10, 2))).totals.publications;
    verified(901, [1], 2025);
    expect((await call(() => api.unitRollup(10, 2))).totals.publications).toBe(before);
    const snap = await call(() => api.unitRollup(10, 2));
    expect(snap.closed).toBe(true);
  });
  it("cannot be closed twice, and only the research admin can close", async () => {
    signInAs("dean");
    await expect(call(() => api.closePeriod(2))).rejects.toMatchObject({ status: 403 });
    signInAs("admin");
    await call(() => api.closePeriod(2));
    await expect(call(() => api.closePeriod(2))).rejects.toMatchObject({ status: 409 });
  });
  it("the seeded closed period has a snapshot", async () => {
    signInAs("admin");
    const r = await call(() => api.unitRollup(10, 1));
    expect(r.closed).toBe(true);
  });
});

describe("counting by appointment", () => {
  it("a paper by someone with two appointments counts for both departments but once in the institution", async () => {
    signInAs("admin");
    const base = async (u: number) => (await call(() => api.unitRollup(u))).totals.publications;
    const [cs, phys, all] = [await base(1), await base(5), await base(10)];
    verified(902, [2], 2023); // Dr. Vikram Shah: Computer Science, and Physics from 2022
    expect(await base(1)).toBe(cs + 1);
    expect(await base(5)).toBe(phys + 1);
    expect(await base(10)).toBe(all + 1);
  });
  it("credit follows the appointment on the publication date, not today's department", async () => {
    signInAs("admin");
    const mech = async () => (await call(() => api.unitRollup(3))).totals.publications;
    const before = await mech();
    verified(903, [8], 2019); // Dr. Arjun Menon was in Computer Science until 2021
    expect(await mech()).toBe(before);
    verified(904, [8], 2024); // and in Mechanical Engineering from 2022
    expect(await mech()).toBe(before + 1);
  });
});

describe("projects", () => {
  it("a confidential project is shown as restricted to people outside it", async () => {
    signInAs("researcher");
    const p = await call(() => api.project(3));
    expect(p.restricted).toBe(true);
    expect(p.awards).toBeUndefined();
    expect(p.title).toBe("Restricted project");
    signInAs("hod"); // Dr. Priya Desai leads it
    expect((await call(() => api.project(3))).awards?.length).toBeGreaterThan(0);
    signInAs("admin");
    expect((await call(() => api.project(3))).restricted).toBeUndefined();
  });
  it("only the lead or the research admin can link items", async () => {
    signInAs("researcher");
    await expect(call(() => api.linkToProject({ id: 2, kind: "award", itemId: 3 }))).rejects.toMatchObject({ status: 403 });
    signInAs("admin");
    expect((await call(() => api.linkToProject({ id: 2, kind: "award", itemId: 3 }))).awardIds).toContain(3);
  });
});

describe("saved reports and templates", () => {
  it("saved reports belong to their owner; the shared sample cannot be deleted", async () => {
    signInAs("admin");
    const s = await call(() => api.saveReport({ name: "Mine", slug: "pub-university", params: {} }));
    signInAs("dean");
    const list = await call(() => api.savedReports());
    expect(list.some((r) => r.id === s.id)).toBe(false);
    await expect(call(() => api.deleteSavedReport(s.id))).rejects.toMatchObject({ status: 403 });
    await expect(call(() => api.deleteSavedReport(1))).rejects.toMatchObject({ status: 403 });
  });
  it("an annual faculty report is limited to people the viewer can see", async () => {
    signInAs("researcher");
    await expect(call(() => api.extReport("annual-faculty", { researcherId: 4 }))).rejects.toMatchObject({ status: 403 });
    expect((await call(() => api.extReport("annual-faculty", { researcherId: 1 }))).title).toContain("Dr. Ananya Rao");
  });
  it("analytics reports are for overview roles only", async () => {
    signInAs("researcher");
    await expect(call(() => api.extReport("benchmark"))).rejects.toMatchObject({ status: 403 });
    signInAs("viewer");
    expect((await call(() => api.extReport("benchmark"))).sections[0].table.rows.length).toBeGreaterThan(0);
  });
  it("an export runs as a job and is audited", async () => {
    signInAs("admin");
    const n = db.auditLog.length;
    const { jobId } = await call(() => api.startExport({ slug: "pub-university", params: {}, format: "csv" }));
    expect(db.auditLog.length).toBe(n + 1);
    expect((await call(() => api.exportJob(jobId))).status).not.toBe("done");
  });
});
