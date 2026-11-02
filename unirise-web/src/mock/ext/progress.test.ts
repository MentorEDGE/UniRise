import { describe, expect, it } from "vitest";
import { api } from "@/lib/api";
import { db } from "@/mock/store";
import { today } from "@/mock/helpers";
import { call, signInAs } from "@/test/session";

// Sample data: Aditi Kapoor (13) is supervised by Dr. Vikram Shah (2); Sneha Joshi (15) by Dr. Rohan Mehta (4); Farhan Ali (16) by Dr. Priya Desai (7).
const ADITI = 13, SNEHA = 15, FARHAN = 16;
const openMilestone = (scholarId: number) => db.milestones.find((m) => m.scholarId === scholarId && !m.completedAt)!;
const doneMilestone = (scholarId: number) => db.milestones.find((m) => m.scholarId === scholarId && m.completedAt)!;

describe("milestones", () => {
  it("a scholar can complete their own milestone but cannot approve it", async () => {
    signInAs("scholar");
    const m = openMilestone(ADITI);
    await expect(call(() => api.completeMilestone(m.id))).resolves.toMatchObject({ completedAt: today() });
    await expect(call(() => api.approveMilestone({ id: m.id }))).rejects.toMatchObject({ status: 403 });
    await expect(call(() => api.updateMilestone({ id: m.id, dueDate: "2030-01-01" }))).rejects.toMatchObject({ status: 403 });
  });

  it("a scholar cannot complete someone else's milestone", async () => {
    signInAs("scholar");
    await expect(call(() => api.completeMilestone(openMilestone(SNEHA).id))).rejects.toMatchObject({ status: 403 });
  });

  it("the supervisor of another scholar gets 403, the scholar's own supervisor can approve and it is recorded", async () => {
    const done = doneMilestone(SNEHA);
    signInAs("supervisor"); // Dr. Vikram Shah does not supervise Sneha
    await expect(call(() => api.approveMilestone({ id: done.id }))).rejects.toMatchObject({ status: 403 });
    await expect(call(() => api.createMilestone({ scholarId: SNEHA, stage: "Extra review", dueDate: "2030-01-01" }))).rejects.toMatchObject({ status: 403 });

    const own = doneMilestone(ADITI);
    const approved = await call(() => api.approveMilestone({ id: own.id, feedback: "Good progress." }));
    expect(approved).toMatchObject({ approvedBy: "Dr. Vikram Shah", approvedOn: today(), feedback: "Good progress." });
    expect(db.auditLog[0].action).toBe("Approved milestone");
    await expect(call(() => api.approveMilestone({ id: own.id }))).rejects.toMatchObject({ status: 409 });
    await expect(call(() => api.approveMilestone({ id: openMilestone(ADITI).id }))).rejects.toMatchObject({ status: 409 }); // not done yet
  });

  it("a HoD and the research admin can add a milestone for a scholar in scope; a HoD outside the subtree cannot", async () => {
    signInAs("hod"); // department 3 holds Farhan
    await expect(call(() => api.createMilestone({ scholarId: FARHAN, stage: "Pre-submission seminar", dueDate: "2031-01-01" }))).resolves.toMatchObject({ scholarId: FARHAN });
    await expect(call(() => api.createMilestone({ scholarId: ADITI, stage: "Pre-submission seminar", dueDate: "2031-01-01" }))).rejects.toMatchObject({ status: 403 });
    signInAs("admin");
    await expect(call(() => api.createMilestone({ scholarId: ADITI, stage: "Pre-submission seminar", dueDate: "not-a-date" }))).rejects.toMatchObject({ status: 400 });
    await expect(call(() => api.createMilestone({ scholarId: ADITI, stage: "Pre-submission seminar", dueDate: "2031-01-01" }))).resolves.toMatchObject({ scholarId: ADITI });
  });
});

describe("meeting logs", () => {
  it("only the scholar's active supervisor can add one; admin, HoD and Dean cannot", async () => {
    const entry = { scholarId: ADITI, heldOn: today(), notes: "Agreed next steps." };
    for (const role of ["admin", "hod", "dean", "scholar", "researcher"]) {
      signInAs(role);
      await expect(call(() => api.addMeetingLog(entry))).rejects.toMatchObject({ status: 403 });
    }
    signInAs("supervisor");
    await expect(call(() => api.addMeetingLog({ ...entry, heldOn: "2999-01-01" }))).rejects.toMatchObject({ status: 400 });
    await expect(call(() => api.addMeetingLog({ ...entry, notes: "  " }))).rejects.toMatchObject({ status: 400 });
    await expect(call(() => api.addMeetingLog({ ...entry, notes: "x".repeat(2001) }))).rejects.toMatchObject({ status: 400 });
    await expect(call(() => api.addMeetingLog(entry))).resolves.toMatchObject({ mentorId: 2, scholarId: ADITI });
  });

  it("the admin and unit heads never read meeting logs; the scholar and the named supervisor do", async () => {
    signInAs("admin");
    expect((await api.menteeDetail(ADITI)).meetings).toHaveLength(0);
    signInAs("scholar");
    expect((await api.menteeDetail(ADITI)).meetings.length).toBeGreaterThan(0);
    signInAs("supervisor");
    const d = await api.menteeDetail(ADITI);
    expect(d.meetings.length).toBeGreaterThan(0);
    expect(d).toMatchObject({ canLogMeeting: true, canManage: true });
    await expect(call(() => api.menteeDetail(SNEHA))).rejects.toMatchObject({ status: 403 });
  });
});

describe("reminders", () => {
  it("sets the level from the due date and escalationDays, and names who gets it", async () => {
    signInAs("admin");
    const all = await api.reminders();
    const byName = (n: string) => all.find((r) => r.scholarName === n)!;
    expect(byName("Ritu Sen")).toMatchObject({ level: "soon" });
    expect(byName("Karthik Reddy")).toMatchObject({ level: "overdue", daysOverdue: 18 });
    const farhan = byName("Farhan Ali");
    expect(farhan.level).toBe("escalated");
    expect(farhan.recipients).toEqual(expect.arrayContaining(["Farhan Ali", "Dr. Priya Desai"]));
    expect(farhan.reason).toContain("days ago");
    expect(byName("Karthik Reddy").recipients).toEqual(["Karthik Reddy", "Dr. Vikram Shah"]);
    expect(byName("Karthik Reddy").reason).toContain("Sent to the scholar and Dr. Vikram Shah.");
    expect(all.find((r) => r.scholarName === "Aditi Kapoor")).toBeUndefined(); // next stage is more than 14 days away

    db.settings.escalationDays = 10;
    expect((await api.reminders()).find((r) => r.scholarName === "Karthik Reddy")!.level).toBe("escalated");
  });

  it("each role sees only its share", async () => {
    signInAs("scholar");
    expect((await api.reminders()).map((r) => r.scholarName)).toEqual([]);
    signInAs("supervisor");
    expect((await api.reminders()).map((r) => r.scholarName)).toEqual(["Karthik Reddy"]);
    signInAs("hod");
    expect((await api.reminders()).map((r) => [r.scholarName, r.level])).toEqual([["Farhan Ali", "escalated"]]);
    signInAs("executive");
    expect(await api.reminders()).toEqual([]);
    signInAs("viewer");
    expect(await api.reminders()).toEqual([]);
  });
});

describe("myRank", () => {
  it("returns own standing and context without any names", async () => {
    signInAs("researcher");
    const r = await api.myRank();
    expect(Object.keys(r).sort()).toEqual(["median", "publications", "rank", "total"]);
    expect(r.rank).toBeGreaterThanOrEqual(1);
    expect(r.total).toBe(db.researchers.filter((p) => p.status !== "left").length); // people who have left are not ranked
    const text = JSON.stringify(r);
    for (const p of db.researchers) expect(text).not.toContain(p.name);
  });

  it("is not offered to roles that keep the named list", async () => {
    signInAs("admin");
    await expect(call(() => api.myRank())).rejects.toMatchObject({ status: 403 });
    signInAs("dean");
    await expect(call(() => api.myRank())).rejects.toMatchObject({ status: 403 });
  });
});
