import { describe, expect, it } from "vitest";
import { api } from "@/lib/api";
import { db } from "@/mock/store";
import { parseCsv } from "@/features/people/csv";
import { call, signInAs } from "@/test/session";

const PEOPLE_HEADER = "name,email,title,department,orcid,employeeId,kind,rollNo\n";

describe("CSV parser", () => {
  it("handles BOM, CRLF, quotes and embedded newlines", () => {
    const p = parseCsv('﻿name,note\r\n"Rao, Ananya","said ""hi""\nthere"\r\n\r\nB,\r\n');
    expect(p.header).toEqual(["name", "note"]);
    expect(p.rows.map((r) => r.cells)).toEqual([["Rao, Ananya", 'said "hi"\nthere'], ["B", ""]]);
    expect(p.rows[0].line).toBe(2);
    expect(p.unterminated).toBe(false);
    expect(parseCsv('a\n"open').unterminated).toBe(true);
  });
});

describe("CSV import", () => {
  const csv = PEOPLE_HEADER
    + "New Person,new.person@university.example,Lecturer,Physics,0000-0002-1825-0097,EMP5001,faculty,\n"
    + "Bad Row,not-an-email,Lecturer,Atlantis,12345,EMP5002,wizard,\n"
    + "Twin,new.person@university.example,Lecturer,Physics,,EMP5001,faculty,\n"
    + "Dr. Ananya Rao,ananya.rao@university.example,Senior Professor,Computer Science,,EMP1001,faculty,\n";

  it("only the research admin may import, and the check is on the server side", async () => {
    signInAs("hod");
    await expect(call(() => api.importPreview("people", csv))).rejects.toMatchObject({ status: 403 });
    await expect(call(() => api.importCommit("people", csv, true))).rejects.toMatchObject({ status: 403 });
  });

  it("previews creates, updates and per-row errors; commit needs the errors fixed or skipped", async () => {
    signInAs("admin");
    const p = await api.importPreview("people", csv);
    expect(p).toMatchObject({ creates: 1, updates: 1, failed: 2, ok: 2 });
    expect(p.rows[1].errors.join(" ")).toMatch(/email/i);
    expect(p.rows[1].errors.join(" ")).toMatch(/department/i);
    expect(p.rows[1].errors.join(" ")).toMatch(/ORCID/);
    expect(p.rows[2].errors.join(" ")).toMatch(/line 2/);
    const before = db.researchers.length;
    await expect(call(() => api.importCommit("people", csv))).rejects.toMatchObject({ status: 400 });
    expect(db.researchers.length).toBe(before);

    const done = await api.importCommit("people", csv, true);
    expect(done).toMatchObject({ created: 1, updated: 1, skipped: 2 });
    expect(db.researchers.find((r) => r.employeeId === "EMP5001")?.name).toBe("New Person");
    expect(db.researchers.find((r) => r.id === 1)?.title).toBe("Senior Professor");
    expect(db.auditLog[0].action).toMatch(/Imported people/);
  });

  it("re-running an import updates instead of duplicating", async () => {
    signInAs("admin");
    const good = PEOPLE_HEADER + "Re Run,re.run@university.example,Lecturer,Physics,,EMP6001,faculty,\n";
    await api.importCommit("people", good);
    const count = db.researchers.length;
    const again = await api.importPreview("people", good);
    expect(again).toMatchObject({ creates: 0, updates: 1, failed: 0 });
    await api.importCommit("people", good);
    expect(db.researchers.length).toBe(count);
  });

  it("imports org units in order, rejects wrong parent types and enforces the size limit", async () => {
    signInAs("admin");
    const units = "name,type,parent\nSchool of Arts,school,Demo University\nDepartment of History,department,School of Arts\nBad,department,Demo University\nPhysics,department,School of Sciences\n";
    const p = await api.importPreview("org-units", units);
    expect(p).toMatchObject({ creates: 2, failed: 1 });
    expect(p.rows[2].errors.join(" ")).toMatch(/under a school/);
    await api.importCommit("org-units", units, true);
    const history = db.orgUnits.find((u) => u.name === "Department of History");
    expect(db.orgUnits.find((u) => u.id === history?.parentId)?.name).toBe("School of Arts");
    const huge = "name,type,parent\n" + "X,school,Demo University\n".repeat(5001);
    await expect(call(() => api.importPreview("org-units", huge))).rejects.toMatchObject({ status: 413 });
  });
});

describe("leavers", () => {
  it("marking someone as left ends appointments and role grants, keeps their outputs, and can be undone", async () => {
    signInAs("admin");
    const pubs = db.publications.filter((p) => p.authorIds.includes(7)).length;
    const res = await api.markLeft({ researcherId: 7, leftOn: "2026-03-31" });
    expect(res.researcher).toMatchObject({ status: "left", leftOn: "2026-03-31" });
    expect(res.endedAppointments).toBeGreaterThan(0);
    expect(res.endedRoleGrants).toBe(1);
    expect(db.appointments.filter((a) => a.researcherId === 7).every((a) => a.validTo && a.validTo <= "2026-03-31")).toBe(true);
    expect(db.publications.filter((p) => p.authorIds.includes(7)).length).toBe(pubs);
    await expect(call(() => api.markLeft({ researcherId: 7, leftOn: "2026-04-01" }))).rejects.toMatchObject({ status: 409 });
    expect((await api.researchers(undefined, undefined, "left")).map((r) => r.id)).toContain(7);
    await api.reinstate(7);
    expect(db.researchers.find((r) => r.id === 7)?.status).toBe("active");
  });
  it("others cannot mark people as left", async () => {
    signInAs("dean");
    await expect(call(() => api.markLeft({ researcherId: 5, leftOn: "2026-03-31" }))).rejects.toMatchObject({ status: 403 });
  });
});

describe("supervision", () => {
  it("lists scholars whose only supervisor left, scoped by role", async () => {
    signInAs("admin");
    expect((await api.reassignments()).map((x) => x.scholar.name)).toEqual(["Ritu Sen"]);
    signInAs("hod"); // Mechanical Engineering: Ritu Sen is in Computer Science
    expect(await api.reassignments()).toEqual([]);
    signInAs("researcher");
    await expect(call(() => api.reassignments())).rejects.toMatchObject({ status: 403 });
    signInAs("admin");
    const v = await api.supervision(17);
    expect(v).toMatchObject({ needsReassignment: true });
    expect(v.supervisors[0]).toMatchObject({ mentorLeft: true });
  });

  it("a new primary ends the previous one, and the reassignment prompt disappears", async () => {
    signInAs("admin");
    await api.assignSupervisor({ scholarId: 17, mentorId: 2, type: "primary" });
    expect(await api.reassignments()).toEqual([]);
    const v = await api.supervision(17);
    expect(v.supervisors.map((s) => s.mentor.id)).toEqual([2]);
    expect(db.relationships.find((r) => r.id === 5)?.validTo).toBeTruthy();
    await expect(call(() => api.assignSupervisor({ scholarId: 17, mentorId: 2, type: "backup" }))).rejects.toMatchObject({ status: 409 });
  });

  it("rejects a mentor who left, a scholar as mentor, and a dean acting outside their unit", async () => {
    signInAs("admin");
    await expect(call(() => api.assignSupervisor({ scholarId: 17, mentorId: 3, type: "primary" }))).rejects.toMatchObject({ status: 400 });
    await expect(call(() => api.assignSupervisor({ scholarId: 17, mentorId: 13, type: "primary" }))).rejects.toMatchObject({ status: 400 });
    signInAs("dean"); // School of Sciences; scholar 17 is in Computer Science (Engineering)
    await expect(call(() => api.assignSupervisor({ scholarId: 17, mentorId: 2, type: "primary" }))).rejects.toMatchObject({ status: 403 });
    await expect(call(() => api.endRelationship(5))).rejects.toMatchObject({ status: 403 });
    signInAs("scholar");
    await expect(call(() => api.supervision(14))).rejects.toMatchObject({ status: 403 });
  });
});

describe("organisation moves", () => {
  it("moves a department to another school and refuses wrong parent types and cycles", async () => {
    signInAs("admin");
    await api.moveOrgUnit({ id: 5, newParentId: 12 });
    expect(db.orgUnits.find((u) => u.id === 5)?.parentId).toBe(12);
    await expect(call(() => api.moveOrgUnit({ id: 5, newParentId: 10 }))).rejects.toMatchObject({ status: 400 });
    await expect(call(() => api.moveOrgUnit({ id: 11, newParentId: 1 }))).rejects.toMatchObject({ status: 400 });
    await expect(call(() => api.moveOrgUnit({ id: 10, newParentId: 11 }))).rejects.toMatchObject({ status: 400 });
    signInAs("hod");
    await expect(call(() => api.moveOrgUnit({ id: 5, newParentId: 11 }))).rejects.toMatchObject({ status: 403 });
  });
});

describe("profile data", () => {
  it("claims and appointments follow who can see the person; only the admin edits appointments", async () => {
    signInAs("researcher");
    await expect(call(() => api.claims(4))).rejects.toMatchObject({ status: 403 });
    await expect(call(() => api.appointments(4))).rejects.toMatchObject({ status: 403 });
    expect((await api.claims(1)).every((c) => c.state !== "verified")).toBe(true);
    await expect(call(() => api.saveAppointment({ researcherId: 1, unitId: 5, designation: "Adjunct", fte: 0.2, validFrom: "2026-01-01" }))).rejects.toMatchObject({ status: 403 });
    signInAs("admin");
    await expect(call(() => api.saveAppointment({ researcherId: 1, unitId: 5, designation: "Adjunct", fte: 1.5, validFrom: "2026-01-01" }))).rejects.toMatchObject({ status: 400 });
    const a = await api.saveAppointment({ researcherId: 1, unitId: 5, designation: "Adjunct", fte: 0.2, validFrom: "2026-01-01" });
    expect((await api.appointments(1)).some((x) => x.id === a.id && x.unitName === "Physics")).toBe(true);
    await api.endAppointment(a.id);
    expect(db.appointments.find((x) => x.id === a.id)?.validTo).toBeTruthy();
  });

  it("connecting ORCID needs an iD on the record; consent is only effective when public profiles are on", async () => {
    signInAs("scholar"); // Aditi Kapoor has no ORCID iD
    await expect(call(() => api.connectOrcid())).rejects.toMatchObject({ status: 400 });
    expect(await api.setPublicConsent(true)).toEqual({ publicProfile: true, effective: db.settings.publicProfilesEnabled });
    signInAs("researcher");
    expect(await api.connectOrcid()).toMatchObject({ id: 1, orcidVerified: true });
    db.settings.publicProfilesEnabled = false;
    expect(await api.setPublicConsent(true)).toMatchObject({ publicProfile: true, effective: false });
    signInAs("admin"); // no researcher record of their own
    await expect(call(() => api.setPublicConsent(true))).rejects.toMatchObject({ status: 403 });
  });
});
