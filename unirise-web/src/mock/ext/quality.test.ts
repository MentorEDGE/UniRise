import { describe, expect, it } from "vitest";
import { api } from "@/lib/api";
import { db } from "@/mock/store";
import { subtree } from "@/mock/helpers";
import type { Publication } from "@/lib/types";
import { call, signInAs } from "@/test/session";

const add = (over: Partial<Publication>): Publication => {
  const p: Publication = { id: db.nextId.publication++, title: "Sample paper", venue: "Sample Journal", type: "journal-article", year: 2024, authorIds: [1], state: "verified", source: "manual", ...over };
  db.publications.push(p);
  return p;
};
const SEED_PAIRS = ["5-49", "10-50"]; // duplicates present in the sample data
const list = async () => (await api.publications({ page: 0, size: 500 })).items;

describe("duplicates and merge", () => {
  it("only reviewers may list duplicates", async () => {
    signInAs("researcher");
    await expect(call(() => api.duplicates())).rejects.toMatchObject({ status: 403 });
    signInAs("scholar");
    await expect(call(() => api.duplicates())).rejects.toMatchObject({ status: 403 });
    signInAs("admin");
    expect((await api.duplicates()).map((p) => p.id)).toEqual(SEED_PAIRS);
  });

  it("finds same-DOI and same-title pairs and skips dismissed ones", async () => {
    const a = add({ doi: "10.5555/Dup.1" }), b = add({ doi: "https://doi.org/10.5555/dup.1", authorIds: [2] });
    const c = add({ title: "A Shared  Title!", year: 2023, authorIds: [1, 3] }), d = add({ title: "a shared title", year: 2024, authorIds: [3] });
    add({ title: "a shared title", year: 2020, authorIds: [3] }); // too far apart in time
    signInAs("admin");
    const pairs = await api.duplicates();
    expect(pairs.map((p) => p.id).sort()).toEqual([...SEED_PAIRS, `${a.id}-${b.id}`, `${c.id}-${d.id}`].sort());
    await api.dismissDuplicate(`${a.id}-${b.id}`);
    expect((await api.duplicates()).map((p) => p.id).sort()).toEqual([...SEED_PAIRS, `${c.id}-${d.id}`].sort());
  });

  it("a HoD only sees pairs with an author in their unit", async () => {
    const inUnit = subtree(3);
    const mine = db.researchers.find((r) => inUnit.has(r.departmentId))!.id;
    const other = db.researchers.find((r) => !inUnit.has(r.departmentId))!.id;
    const a = add({ doi: "10.5555/in.1", authorIds: [mine] }), b = add({ doi: "10.5555/in.1", authorIds: [mine] });
    add({ doi: "10.5555/out.1", authorIds: [other] }); add({ doi: "10.5555/out.1", authorIds: [other] });
    signInAs("hod");
    const ids = (await api.duplicates()).map((p) => p.id);
    expect(ids).toContain(`${a.id}-${b.id}`);
    expect(ids.some((id) => id.startsWith(`${other}-`))).toBe(false);
    expect(ids.length).toBeLessThan(SEED_PAIRS.length + 3); // the out-of-unit pair is not included
  });

  it("merge unions the authors, keeps the survivor and hides the removed record", async () => {
    const a = add({ doi: "10.5555/m.1", authorIds: [1], title: "Original title" });
    const b = add({ doi: "10.5555/m.1", authorIds: [2, 1], title: "Better title", oaStatus: "gold" });
    signInAs("admin");
    const before = (await api.summary()).publications;
    const merged = await api.mergePublications({ survivorId: a.id, removedId: b.id, take: { title: b.title } });
    expect(merged).toMatchObject({ id: a.id, title: "Better title", oaStatus: "gold", version: 2 });
    expect([...merged.authorIds].sort()).toEqual([1, 2]);
    expect(db.publications.find((p) => p.id === b.id)).toMatchObject({ mergedInto: a.id, authorIds: [] });
    expect((await list()).map((p) => p.id)).not.toContain(b.id);
    expect((await api.summary()).publications).toBe(before - 1);
    expect((await api.duplicates()).map((p) => p.id)).toEqual(SEED_PAIRS);
    await expect(call(() => api.mergePublications({ survivorId: a.id, removedId: b.id }))).rejects.toMatchObject({ status: 409 });
    await expect(call(() => api.mergePublications({ survivorId: a.id, removedId: add({}).id, take: { title: "Invented" } }))).rejects.toMatchObject({ status: 400 });
  });
});

describe("version conflicts", () => {
  const base = (p: Publication) => ({ title: p.title, venue: p.venue, type: p.type, year: p.year, authorIds: p.authorIds });
  it("a stale save is rejected as a version conflict, a current one bumps the version", async () => {
    signInAs("admin");
    const p = await api.publication(1);
    expect(p.version).toBe(1);
    await expect(api.savePublication({ ...base(p), id: 1, title: "Edited once", expectedVersion: 1 })).resolves.toMatchObject({ title: "Edited once", version: 2 });
    const err = await call(() => api.savePublication({ ...base(p), id: 1, title: "Edited stale", expectedVersion: 1 })).catch((e) => e);
    expect(err).toMatchObject({ status: 409, reason: "version" });
    expect((await api.publication(1)).title).toBe("Edited once");
  });

  it("a duplicate DOI is a 409 with a different reason", async () => {
    signInAs("admin");
    const other = db.publications.find((p) => p.doi && p.id !== 1)!;
    const p = await api.publication(1);
    const err = await call(() => api.savePublication({ ...base(p), id: 1, doi: other.doi!.toUpperCase(), expectedVersion: 1 })).catch((e) => e);
    expect(err).toMatchObject({ status: 409, reason: "doi" });
  });
});

describe("disputes", () => {
  it("only an author may raise one, with a reason of 10 to 1,000 characters", async () => {
    signInAs("researcher"); // researcher 1 is an author of publication 1, not of 2
    await expect(call(() => api.raiseDispute({ publicationId: 2, reason: "I did not write this paper." }))).rejects.toMatchObject({ status: 403 });
    await expect(call(() => api.raiseDispute({ publicationId: 1, reason: "too short" }))).rejects.toMatchObject({ status: 400 });
    await expect(call(() => api.raiseDispute({ publicationId: 1, reason: "x".repeat(1001) }))).rejects.toMatchObject({ status: 400 });
    const d = await api.raiseDispute({ publicationId: 1, reason: "I did not contribute to this paper." });
    expect(d).toMatchObject({ status: "open", researcherId: 1, publicationId: 1 });
    await expect(call(() => api.raiseDispute({ publicationId: 1, reason: "I did not contribute to this paper." }))).rejects.toMatchObject({ status: 409 });
  });

  it("people see their own disputes, reviewers resolve, others cannot", async () => {
    signInAs("researcher");
    const d = await api.raiseDispute({ publicationId: 1, reason: "I did not contribute to this paper." });
    expect((await api.disputes()).map((x) => x.id)).toEqual([d.id]);
    await expect(call(() => api.resolveDispute({ id: d.id, outcome: "upheld", resolution: "ok" }))).rejects.toMatchObject({ status: 403 });
    signInAs("admin");
    expect((await api.disputes()).length).toBeGreaterThanOrEqual(2);
    await expect(call(() => api.resolveDispute({ id: d.id, outcome: "upheld", resolution: "  " }))).rejects.toMatchObject({ status: 400 });
    await expect(api.resolveDispute({ id: d.id, outcome: "dismissed", resolution: "Records show a contribution." })).resolves.toMatchObject({ status: "dismissed", resolvedBy: "Research Office Admin" });
    expect(db.publications.find((p) => p.id === 1)!.authorIds).toContain(1);
    await expect(call(() => api.resolveDispute({ id: d.id, outcome: "upheld", resolution: "again" }))).rejects.toMatchObject({ status: 409 });
  });

  it("upholding removes the author and sets the paper back to unverified when nobody is left", async () => {
    const p = add({ authorIds: [1], state: "verified" });
    const q = add({ authorIds: [1, 2], state: "verified" });
    signInAs("researcher");
    const d1 = await api.raiseDispute({ publicationId: p.id, reason: "This is a namesake, not me." });
    const d2 = await api.raiseDispute({ publicationId: q.id, reason: "This is a namesake, not me." });
    signInAs("admin");
    await api.resolveDispute({ id: d1.id, outcome: "upheld", resolution: "Confirmed with the journal." });
    await api.resolveDispute({ id: d2.id, outcome: "upheld", resolution: "Confirmed with the journal." });
    expect(db.publications.find((x) => x.id === p.id)).toMatchObject({ authorIds: [], state: "unverified" });
    expect(db.publications.find((x) => x.id === q.id)).toMatchObject({ authorIds: [2], state: "verified" });
    expect(db.auditLog.some((a) => a.action === "Upheld authorship dispute")).toBe(true);
  });
});

describe("open access filter", () => {
  it("filters by oaStatus", async () => {
    signInAs("admin");
    const expected = db.publications.filter((p) => p.oaStatus === "gold" && p.mergedInto === undefined).map((p) => p.id).sort((x, y) => x - y);
    const gold = await api.publications({ page: 0, size: 200, oa: "gold" });
    expect(expected.length).toBeGreaterThan(0);
    expect(gold.items.map((p) => p.id).sort((x, y) => x - y)).toEqual(expected);
    expect(gold.items.every((p) => p.oaStatus === "gold")).toBe(true);
  });
});

describe("review queue", () => {
  it("undo restores the suggestion and reverts a confirm", async () => {
    signInAs("admin");
    const s = db.suggestions[0];
    const pub = db.publications.find((p) => p.id === s.publication.id)!;
    const before = { state: pub.state, authorIds: [...pub.authorIds] };
    const count = db.suggestions.length;
    await api.decide(s.id, "confirm");
    expect(db.suggestions).toHaveLength(count - 1);
    expect(pub.state).toBe("verified");
    await api.undoDecision(s.id);
    expect(db.suggestions).toHaveLength(count);
    expect(db.suggestions[0].id).toBe(s.id);
    expect({ state: pub.state, authorIds: pub.authorIds }).toEqual(before);
    await expect(call(() => api.undoDecision(s.id))).rejects.toMatchObject({ status: 404 });
  });

  it("only the owner of a suggestion or the admin decides it; only the admin reassigns", async () => {
    const s = db.suggestions.find((x) => x.researcherId !== 1)!;
    signInAs("researcher");
    await expect(call(() => api.decide(s.id, "confirm"))).rejects.toMatchObject({ status: 403 });
    await expect(call(() => api.overrideSuggestion({ id: s.id, researcherId: 1 }))).rejects.toMatchObject({ status: 403 });
    signInAs("admin");
    await expect(api.overrideSuggestion({ id: s.id, researcherId: 1 })).resolves.toMatchObject({ researcherId: 1 });
  });
});

describe("harvest", () => {
  it("is admin only and suggests existing unverified publications", async () => {
    signInAs("itadmin");
    await expect(call(() => api.runHarvest())).rejects.toMatchObject({ status: 403 });
    await expect(call(() => api.harvestRuns())).rejects.toMatchObject({ status: 403 });
    signInAs("admin");
    const unverified = new Set(db.publications.filter((p) => p.state === "unverified").map((p) => p.id));
    const sugBefore = db.suggestions.length;
    const runs = await api.runHarvest();
    expect(runs.map((r) => r.source)).toEqual(["ORCID", "OpenAlex"]);
    const created = db.suggestions.slice(sugBefore);
    expect(created.length).toBeGreaterThanOrEqual(1);
    expect(created.length).toBeLessThanOrEqual(3);
    for (const s of created) expect(unverified.has(s.publication.id)).toBe(true);
    expect(runs.reduce((n, r) => n + r.newSuggestions, 0)).toBe(created.length);
    expect((await api.harvestRuns())[0].source).toMatch(/ORCID|OpenAlex/);
  });
});
