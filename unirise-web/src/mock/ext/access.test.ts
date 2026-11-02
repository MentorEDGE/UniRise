import { describe, expect, it } from "vitest";
import { api } from "@/lib/api";
import { db } from "@/mock/store";
import { grantIsActive, today } from "@/mock/helpers";
import { call, signInAs } from "@/test/session";
import { daysFromNow } from "@/mock/seed";

const acting = (over: Record<string, unknown> = {}) => ({
  holder: "Dr. Meera Iyer", researcherId: 3, role: "HOD" as const, scopeUnitId: 3, validFrom: today(), validTo: daysFromNow(5), kind: "acting" as const, ...over,
});

describe("role grants", () => {
  it("a HoD can grant an acting HoD role inside their own department, ending no later than their own grant", async () => {
    signInAs("hod"); // own grant ends in 10 days
    const g = await call(() => api.grantRole(acting()));
    expect(g).toMatchObject({ kind: "acting", role: "HOD", scopeUnitId: 3, grantedBy: "Dr. Priya Desai" });
    expect(db.auditLog[0]).toMatchObject({ entity: "role-grant", entityId: g.id });
    await expect(call(() => api.grantRole(acting({ validTo: daysFromNow(30) })))).rejects.toMatchObject({ status: 403 });
    await expect(call(() => api.grantRole(acting({ validTo: undefined })))).rejects.toMatchObject({ status: 400 });
  });

  it("a HoD cannot grant another role, another unit, or a direct grant", async () => {
    signInAs("hod");
    await expect(call(() => api.grantRole(acting({ scopeUnitId: 1 })))).rejects.toMatchObject({ status: 403 });
    await expect(call(() => api.grantRole(acting({ role: "DEAN", scopeUnitId: 12 })))).rejects.toMatchObject({ status: 403 });
    await expect(call(() => api.grantRole(acting({ role: "RESEARCH_ADMIN", scopeUnitId: undefined })))).rejects.toMatchObject({ status: 403 });
    await expect(call(() => api.grantRole(acting({ kind: "direct" })))).rejects.toMatchObject({ status: 403 });
    // someone who is only acting cannot hand the role on again
    signInAs("acting");
    await expect(call(() => api.grantRole(acting({ validTo: daysFromNow(3) })))).rejects.toMatchObject({ status: 403 });
    expect(db.roleGrants.some((g) => g.holder === "Dr. Meera Iyer")).toBe(false);
  });

  it("an expired grant is inactive and shows up in the access review; confirming it clears it", async () => {
    const viewer = db.roleGrants.find((g) => g.id === 8)!;
    expect(grantIsActive(viewer)).toBe(false);
    signInAs("admin");
    const review = await call(() => api.accessReview());
    expect(review.find((i) => i.grant.id === 8)).toMatchObject({ reason: "expired", suggested: "confirm-ended" });
    expect(review.find((i) => i.grant.id === 4)).toMatchObject({ reason: "ends-soon" }); // the HoD grant ends in 10 days
    expect(review.find((i) => i.grant.id === 3)).toMatchObject({ reason: "no-end-date" }); // the Dean grant has no end date and is old
    await call(() => api.endGrant(8));
    expect((await call(() => api.accessReview())).some((i) => i.grant.id === 8)).toBe(false);
    await expect(call(() => api.endGrant(8))).rejects.toMatchObject({ status: 409 });
  });

  it("renewing extends a grant, ending makes it inactive at once, and the last research administrator cannot be ended", async () => {
    signInAs("admin");
    const renewed = await call(() => api.renewGrant({ id: 4, validTo: daysFromNow(200) }));
    expect(renewed.validTo).toBe(daysFromNow(200));
    await expect(call(() => api.renewGrant({ id: 4, validTo: daysFromNow(100) }))).rejects.toMatchObject({ status: 400 });
    const ended = await call(() => api.endGrant(4));
    expect(grantIsActive(ended)).toBe(false);
    await expect(call(() => api.endGrant(1))).rejects.toMatchObject({ status: 409 });
    expect(db.auditLog.map((e) => e.action)).toEqual(expect.arrayContaining(["Renewed role grant", "Ended role grant"]));
  });

  it("only administrators see the access review; a researcher cannot read grants", async () => {
    signInAs("researcher");
    await expect(call(() => api.roleGrants())).rejects.toMatchObject({ status: 403 });
    await expect(call(() => api.accessReview())).rejects.toMatchObject({ status: 403 });
    signInAs("hod");
    const own = await call(() => api.roleGrants());
    expect(own.length).toBeGreaterThan(0);
    expect(own.every((g) => g.scopeUnitId === 3)).toBe(true);
    await expect(call(() => api.accessReview())).rejects.toMatchObject({ status: 403 });
  });
});

describe("guest access", () => {
  it("a guest sees only the shared item and each view is logged", async () => {
    signInAs("guest");
    const before = db.accessLog.length;
    const v = await call(() => api.guestView());
    expect(v.item.ref).toBe("pub-university");
    expect(v.report?.columns).toEqual(["Year", "Publications"]);
    expect(db.accessLog.length).toBe(before + 1);
    expect(db.accessLog[0]).toMatchObject({ action: "guest-view", role: "GUEST" });
    await expect(call(() => api.roleGrants())).rejects.toMatchObject({ status: 403 });
    await expect(call(() => api.auditLog())).rejects.toMatchObject({ status: 403 });
    expect((await api.publications({ page: 0, size: 10 })).total).toBe(0);
  });

  it("after the guest's access ends the view is refused with 403, and the refusal is logged", async () => {
    signInAs("admin");
    await call(() => api.endGrant(7));
    signInAs("guest");
    const before = db.accessLog.length;
    await expect(call(() => api.guestView())).rejects.toMatchObject({ status: 403 });
    expect(db.accessLog.length).toBe(before + 1);
    expect(db.accessLog[0]).toMatchObject({ action: "guest-view", note: expect.stringContaining("Refused") });
    signInAs("researcher");
    await expect(call(() => api.guestView())).rejects.toMatchObject({ status: 403 });
  });
});

describe("IT administrator and the logs", () => {
  it("an IT admin reads users and logs but gets no research content and cannot grant research roles", async () => {
    signInAs("itadmin");
    await expect(call(() => api.roleGrants())).resolves.toBeTruthy();
    await expect(call(() => api.auditLog())).resolves.toBeTruthy();
    await expect(call(() => api.accessLog())).resolves.toBeTruthy();
    const users = await call(() => api.usersList());
    expect(users.find((u) => u.role === "PLATFORM_ADMIN")).toMatchObject({ account: "platform" });
    expect(users.find((u) => u.role === "GUEST")).toMatchObject({ account: "guest", source: "guest-share" });
    expect(users.find((u) => u.email === "viewer@university.example")).toMatchObject({ status: "expired" });
    expect((await api.publications({ page: 0, size: 10 })).total).toBe(0);
    await expect(call(() => api.grantRole(acting({ kind: "direct", validTo: undefined })))).rejects.toMatchObject({ status: 403 });
  });

  it("an executive or Dean cannot read the access log or the audit log", async () => {
    for (const who of ["executive", "dean", "hod", "viewer"]) {
      signInAs(who);
      await expect(call(() => api.accessLog())).rejects.toMatchObject({ status: 403 });
      await expect(call(() => api.auditLog())).rejects.toMatchObject({ status: 403 });
      await expect(call(() => api.usersList())).rejects.toMatchObject({ status: 403 });
    }
  });

  it("logs filter, and exporting writes an audit entry and an access-log export entry", async () => {
    signInAs("admin");
    const exportsOnly = await call(() => api.accessLog({ action: "export" }));
    expect(exportsOnly).toHaveLength(0);
    expect((await call(() => api.accessLog({ action: "drill-down" }))).every((e) => e.action === "drill-down")).toBe(true);
    expect((await call(() => api.auditLog({ q: "acting" }))).length).toBeGreaterThan(0);
    expect(await call(() => api.auditLog({ from: daysFromNow(1) }))).toHaveLength(0);
    await call(() => api.logExported({ log: "audit", rows: 4 }));
    expect(db.auditLog[0]).toMatchObject({ action: "Exported audit log", entity: "log-export" });
    expect((await call(() => api.accessLog({ action: "export" })))[0]).toMatchObject({ action: "export", role: "RESEARCH_ADMIN" });
  });
});
