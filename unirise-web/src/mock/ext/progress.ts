// Feature slice "progress": sample-data (mock) and server (real) versions of its API calls. Keys must match between the two.
import { HttpError, http } from "@/lib/http";
import { db } from "@/mock/store";
import { audit, grantIsActive, mockUser, subtree, today, wait } from "@/mock/helpers";
import { formatDate } from "@/lib/utils";
import type { MeetingLog, MenteeDetail, MenteeRow, Milestone, MilestoneView, Reminder, User } from "@/lib/types";

/** What the supervisor view of one scholar adds to the base shape: what the signed-in person may do, decided by the server. */
export type MenteeDetailExt = MenteeDetail & {
  canManage: boolean;
  canLogMeeting: boolean;
  canComplete: boolean;
  /** Names of the scholar's active supervisors. */
  supervisors: string[];
};
/** Standing among verified publication counts in the tenant. Carries no names. */
export interface MyRank { rank: number; total: number; publications: number; median: number }

export const MAX_NOTES = 2000;
export const MAX_FEEDBACK = 1000;
const MAX_STAGE = 80;
const SOON_DAYS = 14;

/* ------------------------------- helpers ------------------------------- */
const actor = (): User => {
  const u = mockUser();
  if (!u) throw new HttpError(401);
  return u;
};
const isDate = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
const dayNumber = (iso: string) => Math.floor(Date.parse(iso.slice(0, 10)) / 86_400_000);
const withStatus = (m: Milestone): MilestoneView => ({ ...m, status: m.completedAt ? "done" : m.dueDate < today() ? "overdue" : "upcoming" });
const milestonesOf = (scholarId: number) => db.milestones.filter((m) => m.scholarId === scholarId).sort((a, b) => a.id - b.id).map(withStatus);
const currentOf = (ms: MilestoneView[]) => ms.find((m) => m.status !== "done");
const personName = (id: number) => db.researchers.find((r) => r.id === id)?.name ?? "Unknown";

/** Supervisors with a relationship that has not ended (any type: primary, co, backup). */
const activeMentorIds = (scholarId: number) => db.relationships.filter((r) => r.menteeId === scholarId && !r.validTo).map((r) => r.mentorId);
const isSupervisorOf = (u: User, scholarId: number) => u.researcherId !== undefined && activeMentorIds(scholarId).includes(u.researcherId);
const isUnitHeadOf = (u: User, scholarId: number) => {
  const s = db.researchers.find((r) => r.id === scholarId);
  return !!s && (u.role === "HOD" || u.role === "DEAN") && u.scopeUnitId !== undefined && subtree(u.scopeUnitId).has(s.departmentId);
};
/** Who may create, edit and approve a scholar's milestones. Nobody manages their own. */
const canManage = (u: User, scholarId: number) => u.researcherId !== scholarId && (u.role === "RESEARCH_ADMIN" || isSupervisorOf(u, scholarId) || isUnitHeadOf(u, scholarId));
const canComplete = (u: User, scholarId: number) => u.researcherId === scholarId || canManage(u, scholarId);

function findMilestone(id: number) {
  const m = db.milestones.find((x) => x.id === id);
  if (!m) throw new HttpError(404);
  return m;
}
function checkStage(stage: string | undefined) {
  const s = stage?.trim() ?? "";
  if (!s || s.length > MAX_STAGE) throw new HttpError(400);
  return s;
}
function checkFeedback(feedback: string | undefined) {
  const f = feedback?.trim();
  if (f && f.length > MAX_FEEDBACK) throw new HttpError(400);
  return f || undefined;
}

/* ------------------------------ reminders ------------------------------ */
/** Active HoD grants for the department or any unit above it; the names of the people who hold them. */
function headsOfDepartment(departmentId: number): string[] {
  const chain = new Set<number>();
  for (let id: number | undefined = departmentId; id !== undefined && !chain.has(id); id = db.orgUnits.find((x) => x.id === id)?.parentId) chain.add(id);
  const names = db.roleGrants.filter((g) => g.role === "HOD" && g.scopeUnitId !== undefined && chain.has(g.scopeUnitId) && grantIsActive(g)).map((g) => g.holder);
  return [...new Set(names)];
}

const joinNames = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

function buildReminders(): Reminder[] {
  const now = dayNumber(today());
  const out: Reminder[] = [];
  for (const m of db.milestones) {
    if (m.completedAt) continue;
    const scholar = db.researchers.find((r) => r.id === m.scholarId);
    if (!scholar) continue;
    const daysUntil = dayNumber(m.dueDate) - now;
    if (daysUntil > SOON_DAYS) continue;
    const daysOverdue = Math.max(0, -daysUntil);
    const level: Reminder["level"] = daysUntil >= 0 ? "soon" : daysOverdue > db.settings.escalationDays ? "escalated" : "overdue";
    const supervisors = [...new Set(activeMentorIds(m.scholarId))].map((id) => db.researchers.find((r) => r.id === id)).filter((r) => r && r.status !== "left").map((r) => r!.name);
    const heads = level === "escalated" ? headsOfDepartment(scholar.departmentId) : [];
    const recipients = [scholar.name, ...supervisors, ...(level === "escalated" ? (heads.length ? heads : ["Head of department"]) : [])];
    const to = [`the scholar`, ...supervisors, ...(level === "escalated" ? (heads.length ? heads.map((h) => `${h} (head of department)`) : ["the head of department"]) : [])];
    const when = level === "soon"
      ? daysUntil === 0 ? `${m.stage} is due today (${formatDate(m.dueDate)}).` : `${m.stage} is due on ${formatDate(m.dueDate)}, in ${daysUntil} day${daysUntil === 1 ? "" : "s"}.`
      : `${m.stage} was due on ${formatDate(m.dueDate)}, ${daysOverdue} day${daysOverdue === 1 ? "" : "s"} ago.`;
    const why = level === "escalated" ? ` It is more than ${db.settings.escalationDays} days late, so it also goes to the head of department.` : "";
    const nobody = supervisors.length === 0 ? " The supervisor on record is not available to receive it." : "";
    out.push({
      id: `m-${m.id}-${level}`, milestoneId: m.id, scholarId: m.scholarId, scholarName: scholar.name, stage: m.stage, dueDate: m.dueDate,
      level, daysOverdue, recipients, reason: `${when}${why} Sent to ${joinNames(to)}.${nobody}`,
    });
  }
  const rank = { escalated: 0, overdue: 1, soon: 2 };
  return out.sort((a, b) => rank[a.level] - rank[b.level] || b.daysOverdue - a.daysOverdue || a.dueDate.localeCompare(b.dueDate) || a.scholarName.localeCompare(b.scholarName));
}

/** Aggregates go up, detail stays down: unit heads see only what has been escalated to them. */
function visibleReminders(u: User | null): Reminder[] {
  if (!u) return [];
  const all = buildReminders();
  if (u.role === "RESEARCH_ADMIN") return all;
  if (u.role === "SUPERVISOR") return all.filter((r) => isSupervisorOf(u, r.scholarId));
  if (u.role === "HOD" || u.role === "DEAN") return all.filter((r) => r.level === "escalated" && isUnitHeadOf(u, r.scholarId));
  if (u.role === "RESEARCHER") return all.filter((r) => u.researcherId !== undefined && r.scholarId === u.researcherId);
  return [];
}

/* ------------------------------ mock calls ----------------------------- */
export const mock = {
  createMilestone: (input: { scholarId: number; stage: string; dueDate: string }): Promise<Milestone> => {
    const u = actor();
    if (!db.researchers.some((r) => r.id === input.scholarId)) throw new HttpError(404);
    if (!canManage(u, input.scholarId)) throw new HttpError(403);
    const stage = checkStage(input.stage);
    if (!isDate(input.dueDate)) throw new HttpError(400);
    if (db.milestones.some((m) => m.scholarId === input.scholarId && m.stage.toLowerCase() === stage.toLowerCase())) throw new HttpError(409);
    const m: Milestone = { id: db.nextId.milestone++, scholarId: input.scholarId, stage, dueDate: input.dueDate };
    db.milestones.push(m);
    audit("Added milestone", "milestone", m.id, `${stage} for ${personName(m.scholarId)}, due ${m.dueDate}`);
    return wait({ ...m });
  },

  updateMilestone: (input: { id: number; stage?: string; dueDate?: string; feedback?: string }): Promise<Milestone> => {
    const u = actor();
    const m = findMilestone(input.id);
    if (!canManage(u, m.scholarId)) throw new HttpError(403);
    const changes: string[] = [];
    const stage = input.stage !== undefined ? checkStage(input.stage) : undefined;
    if (input.dueDate !== undefined && !isDate(input.dueDate)) throw new HttpError(400);
    const feedback = input.feedback !== undefined ? checkFeedback(input.feedback) : undefined;
    // Once a stage is approved its record is fixed; only feedback can still be added.
    if (m.approvedOn && (stage !== undefined || input.dueDate !== undefined)) throw new HttpError(409);
    if (stage !== undefined && stage !== m.stage) {
      if (db.milestones.some((x) => x.id !== m.id && x.scholarId === m.scholarId && x.stage.toLowerCase() === stage.toLowerCase())) throw new HttpError(409);
      changes.push(`stage "${m.stage}" to "${stage}"`);
      m.stage = stage;
    }
    if (input.dueDate !== undefined && input.dueDate !== m.dueDate) { changes.push(`due date ${m.dueDate} to ${input.dueDate}`); m.dueDate = input.dueDate; }
    if (input.feedback !== undefined && feedback !== m.feedback) { changes.push("feedback"); m.feedback = feedback; }
    if (changes.length) audit("Updated milestone", "milestone", m.id, `${personName(m.scholarId)}: ${changes.join("; ")}`);
    return wait({ ...m });
  },

  completeMilestone: (id: number): Promise<Milestone> => {
    const u = actor();
    const m = findMilestone(id);
    if (!canComplete(u, m.scholarId)) throw new HttpError(403);
    if (m.completedAt) throw new HttpError(409);
    m.completedAt = today();
    audit("Marked milestone done", "milestone", m.id, `${m.stage} for ${personName(m.scholarId)}`);
    return wait({ ...m });
  },

  approveMilestone: (input: { id: number; feedback?: string }): Promise<Milestone> => {
    const u = actor();
    const m = findMilestone(input.id);
    if (!canManage(u, m.scholarId)) throw new HttpError(403);
    if (!m.completedAt || m.approvedOn) throw new HttpError(409);
    const feedback = checkFeedback(input.feedback);
    m.approvedBy = u.name;
    m.approvedOn = today();
    if (feedback) m.feedback = feedback;
    audit("Approved milestone", "milestone", m.id, `${m.stage} for ${personName(m.scholarId)}${feedback ? " with feedback" : ""}`);
    return wait({ ...m });
  },

  /** Meeting logs are confidential: only the scholar's active supervisor may write one (not admin, HoD or Dean). */
  addMeetingLog: (input: { scholarId: number; heldOn: string; notes: string }): Promise<MeetingLog> => {
    const u = actor();
    if (!db.researchers.some((r) => r.id === input.scholarId)) throw new HttpError(404);
    if (!isSupervisorOf(u, input.scholarId) || u.researcherId === input.scholarId) throw new HttpError(403);
    const notes = input.notes?.trim() ?? "";
    if (!isDate(input.heldOn) || input.heldOn > today() || !notes || notes.length > MAX_NOTES) throw new HttpError(400);
    const log: MeetingLog = { id: db.nextId.meeting++, scholarId: input.scholarId, mentorId: u.researcherId!, heldOn: input.heldOn, notes };
    db.meetings.push(log);
    audit("Logged a meeting", "meeting", log.id, `With ${personName(input.scholarId)} on ${input.heldOn}`); // never the notes
    return wait({ ...log });
  },

  reminders: (): Promise<Reminder[]> => wait(visibleReminders(mockUser())),

  mentees: (): Promise<MenteeRow[]> => {
    const u = mockUser();
    return wait(db.relationships.filter((x) => x.mentorId === u?.researcherId && !x.validTo).map((rel): MenteeRow => {
      const ms = milestonesOf(rel.menteeId);
      return {
        researcher: db.researchers.find((r) => r.id === rel.menteeId)!,
        relationship: rel.type,
        current: currentOf(ms),
        overdue: ms.filter((m) => m.status === "overdue").length,
        lastMeeting: db.meetings.filter((m) => m.scholarId === rel.menteeId && m.mentorId === u?.researcherId).map((m) => m.heldOn).sort().pop(),
      };
    }));
  },

  menteeDetail: (id: number): Promise<MenteeDetailExt> => {
    const u = mockUser();
    if (!u || !(u.role === "RESEARCH_ADMIN" || u.researcherId === id || isSupervisorOf(u, id) || isUnitHeadOf(u, id))) throw new HttpError(403);
    const researcher = db.researchers.find((r) => r.id === id);
    if (!researcher) throw new HttpError(404);
    // Meeting logs: only the scholar and the supervisor named on the record. Admin, HoD and Dean get none.
    const meetings = db.meetings.filter((m) => m.scholarId === id && (u.researcherId === id || u.researcherId === m.mentorId)).sort((a, b) => b.heldOn.localeCompare(a.heldOn));
    return wait({
      researcher, milestones: milestonesOf(id), meetings,
      canManage: canManage(u, id), canLogMeeting: isSupervisorOf(u, id) && u.researcherId !== id, canComplete: canComplete(u, id),
      supervisors: [...new Set(activeMentorIds(id))].map(personName),
    });
  },

  /** Own standing only. Never returns another person's name or count. */
  myRank: (): Promise<MyRank> => {
    const u = actor();
    if ((u.role !== "RESEARCHER" && u.role !== "SUPERVISOR") || u.researcherId === undefined) throw new HttpError(403);
    const counts = db.researchers.filter((r) => r.status !== "left" || r.id === u.researcherId)
      .map((r) => ({ id: r.id, n: db.publications.filter((p) => p.state === "verified" && p.authorIds.includes(r.id)).length }));
    const mine = counts.find((c) => c.id === u.researcherId);
    if (!mine) throw new HttpError(404);
    const sorted = counts.map((c) => c.n).sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    return wait({ rank: 1 + counts.filter((c) => c.n > mine.n).length, total: counts.length, publications: mine.n, median });
  },
};

/* ----------------------------- server calls ---------------------------- */
const json = (body: unknown) => JSON.stringify(body);
// Planned endpoints (TRD §5): milestones, supervision, reminders and the own-rank report.
export const real: typeof mock = {
  createMilestone: (input) => http("/milestones", { method: "POST", body: json(input) }),
  updateMilestone: ({ id, ...rest }) => http(`/milestones/${id}`, { method: "PATCH", body: json(rest) }),
  completeMilestone: (id) => http(`/milestones/${id}/complete`, { method: "POST" }),
  approveMilestone: ({ id, ...rest }) => http(`/milestones/${id}/approve`, { method: "POST", body: json(rest) }),
  addMeetingLog: ({ scholarId, ...rest }) => http(`/relationships/mentees/${scholarId}/meetings`, { method: "POST", body: json(rest) }),
  reminders: () => http("/reminders"),
  mentees: () => http("/relationships/mentees"),
  menteeDetail: (id) => http(`/relationships/mentees/${id}`),
  myRank: () => http("/reports/my-rank"),
};
