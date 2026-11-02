import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import { db } from "@/mock/store";
import { call, signInAs } from "@/test/session";
import { SESSION_KEY } from "@/mock/helpers";

afterEach(() => vi.restoreAllMocks());

describe("tenant settings", () => {
  it("rejects an accent colour that white text cannot be read on", async () => {
    signInAs("admin");
    await expect(call(() => api.saveSettings({ accent: "#ffff00" }))).rejects.toMatchObject({ status: 400, message: "contrast" });
    await expect(call(() => api.saveSettings({ accent: "yellow" }))).rejects.toMatchObject({ status: 400 });
    await expect(call(() => api.saveSettings({ accent: "#0f766e", escalationDays: 45 }))).resolves.toMatchObject({ accent: "#0f766e", escalationDays: 45 });
    expect(db.settings.accent).toBe("#0f766e");
  });
  it("checks the ranges and lets only the research admin save", async () => {
    signInAs("admin");
    await expect(call(() => api.saveSettings({ escalationDays: 3 }))).rejects.toMatchObject({ status: 400 });
    await expect(call(() => api.saveSettings({ fiscalYearStartMonth: 13 }))).rejects.toMatchObject({ status: 400 });
    await expect(call(() => api.saveSettings({ currency: "JPY" as never }))).rejects.toMatchObject({ status: 400 });
    signInAs("itadmin");
    await expect(call(() => api.saveSettings({ currency: "USD" }))).rejects.toMatchObject({ status: 403 });
    await expect(call(() => api.settings())).resolves.toMatchObject({ currency: "INR" });
  });
});

describe("integrations", () => {
  it("shows an API key once and never stores the plaintext", async () => {
    signInAs("admin");
    const { key, row } = await api.createApiKey("Finance export");
    expect(key.startsWith(row.prefix)).toBe(true);
    expect(key.length).toBeGreaterThan(row.prefix.length + 16);
    expect(JSON.stringify({ keys: db.apiKeys, audit: db.auditLog, access: db.accessLog })).not.toContain(key);
    const rotated = await api.rotateApiKey(row.id);
    expect(rotated.key).not.toBe(key);
    const rows = await api.apiKeys();
    expect(rows.find((k) => k.id === row.id)?.revokedOn).toBeTruthy();
    await expect(call(() => api.rotateApiKey(row.id))).rejects.toMatchObject({ status: 409 });
  });
  it("allows only admins and IT admins, and only https webhooks", async () => {
    signInAs("hod");
    await expect(call(() => api.apiKeys())).rejects.toMatchObject({ status: 403 });
    signInAs("itadmin");
    await expect(call(() => api.saveWebhook({ url: "http://erp.example/hook", events: ["period.closed"], active: true }))).rejects.toMatchObject({ status: 400 });
    await expect(call(() => api.saveWebhook({ url: "https://localhost/hook", events: ["period.closed"], active: true }))).rejects.toMatchObject({ status: 400 });
    await expect(call(() => api.saveWebhook({ url: "https://erp.example/hook", events: ["nope"], active: true }))).rejects.toMatchObject({ status: 400 });
    const w = await api.saveWebhook({ url: "https://erp.example/hook", events: ["period.closed"], active: true });
    expect(w.id).toBeGreaterThan(1);
    expect(db.auditLog[0].action).toBe("webhook.create");
  });
});

describe("classification lists", () => {
  it("ends a term instead of deleting it and refuses duplicates", async () => {
    signInAs("admin");
    const before = db.classification[1].terms.length;
    const s = await api.addTerm({ schemeId: 2, code: "TRN", label: "Training", validFrom: "2026-01-01" });
    await expect(call(() => api.addTerm({ schemeId: 2, code: "trn", label: "Again", validFrom: "2026-01-01" }))).rejects.toMatchObject({ status: 409 });
    await expect(call(() => api.endTerm({ schemeId: 2, code: "TRN", validTo: "2025-12-31" }))).rejects.toMatchObject({ status: 400 });
    const ended = await api.endTerm({ schemeId: 2, code: "TRN", validTo: "2026-06-30" });
    expect(s.terms).toHaveLength(before + 1);
    expect(ended.terms.find((t) => t.code === "TRN")?.validTo).toBe("2026-06-30");
  });
});

describe("platform console", () => {
  it("is closed to every role except the platform operator", async () => {
    for (const role of ["admin", "executive", "itadmin", "guest", "researcher"]) {
      signInAs(role);
      await expect(call(() => api.tenants())).rejects.toMatchObject({ status: 403 });
      await expect(call(() => api.deleteTenant({ id: 2, confirmName: "Sandbox College" }))).rejects.toMatchObject({ status: 403 });
    }
    signInAs("platform");
    await expect(api.tenants()).resolves.toHaveLength(4);
  });
  it("deletes a tenant only when the exact name is typed, and writes a record", async () => {
    signInAs("platform");
    await expect(call(() => api.deleteTenant({ id: 2, confirmName: "sandbox college" }))).rejects.toMatchObject({ status: 400 });
    expect(db.tenants.some((t) => t.id === 2)).toBe(true);
    const rec = await api.deleteTenant({ id: 2, confirmName: "Sandbox College" });
    expect(rec).toMatchObject({ tenantName: "Sandbox College", deletedBy: "operator@rms-platform.example" });
    expect(db.tenants.some((t) => t.id === 2)).toBe(false);
    await expect(call(() => api.deleteTenant({ id: 1, confirmName: "Demo University" }))).rejects.toMatchObject({ status: 409 });
  });
  it("converts a pilot to active, rejects impossible moves, and shows a new tenant's key once", async () => {
    signInAs("platform");
    const { tenant, apiKey } = await api.createTenant({ name: "Trial Institute", status: "pilot" });
    expect(JSON.stringify(db)).not.toContain(apiKey);
    const active = await api.setTenantStatus({ id: tenant.id, status: "active" });
    expect(active.status).toBe("active");
    await expect(call(() => api.setTenantStatus({ id: tenant.id, status: "pilot" }))).rejects.toMatchObject({ status: 409 });
    await expect(call(() => api.createTenant({ name: "trial institute", status: "sandbox" }))).rejects.toMatchObject({ status: 409 });
  });
  it("needs a reason of 10+ characters for support access and logs it", async () => {
    signInAs("platform");
    await expect(call(() => api.supportAccess({ id: 1, minutes: 60, reason: "short" }))).rejects.toMatchObject({ status: 400 });
    const g = await api.supportAccess({ id: 1, minutes: 60, reason: "Investigating a failed CSV import" });
    expect(g.expiresAt > g.grantedAt).toBe(true);
    expect(db.accessLog[0]).toMatchObject({ action: "support-access", targetId: 1 });
  });
});

describe("public profiles", () => {
  it("lists only consenting, active people, without email or unverified work", async () => {
    sessionStorage.removeItem(SESSION_KEY);
    const list = await api.publicProfiles();
    const consenting = db.researchers.filter((r) => r.publicProfile && r.status !== "left").map((r) => r.id).sort();
    expect(list.map((p) => p.researcher.id).sort()).toEqual(consenting);
    const text = JSON.stringify(list);
    expect(text).not.toContain("@university.example");
    expect(text).not.toContain("employeeId");
    const unverified = db.publications.filter((p) => p.state !== "verified").map((p) => p.title);
    for (const t of unverified) expect(text).not.toContain(JSON.stringify(t));
    const nonConsenting = db.researchers.find((r) => !r.publicProfile)!;
    await expect(call(() => api.publicProfile(nonConsenting.id))).rejects.toMatchObject({ status: 404 });
  });
  it("is hidden entirely when the tenant switches it off", async () => {
    db.settings.publicProfilesEnabled = false;
    await expect(call(() => api.publicProfiles())).rejects.toMatchObject({ status: 404 });
    await expect(call(() => api.publicProfile(1))).rejects.toMatchObject({ status: 404 });
  });
});

describe("sign-in link", () => {
  it("works once, then is refused", async () => {
    const { link, expiresInMinutes } = await api.requestSignInLink("admin@university.example");
    expect(expiresInMinutes).toBe(15);
    const token = new URL(link).searchParams.get("token")!;
    await expect(api.signInWithLink(token)).resolves.toMatchObject({ role: "RESEARCH_ADMIN" });
    expect(sessionStorage.getItem(SESSION_KEY)).toBe("admin");
    await expect(call(() => api.signInWithLink(token))).rejects.toMatchObject({ status: 410 });
  });
  it("expires after 15 minutes and only knows demo users", async () => {
    await expect(call(() => api.requestSignInLink("nobody@example.org"))).rejects.toMatchObject({ status: 404 });
    const { link } = await api.requestSignInLink("viewer@university.example");
    const token = new URL(link).searchParams.get("token")!;
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + 16 * 60_000);
    await expect(call(() => api.signInWithLink(token))).rejects.toMatchObject({ status: 410 });
  });
});
