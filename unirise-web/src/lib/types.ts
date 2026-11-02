// shortcut: one role per user; the spec allows several role grants, switch to roles[] when /me returns grants.
export type Role = "RESEARCH_ADMIN" | "EXECUTIVE" | "DEAN" | "HOD" | "SUPERVISOR" | "RESEARCHER" | "VIEWER";

export interface User {
  id: number;
  name: string;
  email: string;
  role: Role;
  /** Org unit whose subtree the user may see (Dean: school, HoD: department, Executive: institution). */
  scopeUnitId?: number;
  researcherId?: number;
  isScholar?: boolean;
  institution: string;
}

export type OrgUnitType = "institution" | "school" | "department" | "group";
export interface OrgUnit { id: number; parentId?: number; type: OrgUnitType; name: string }

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  size: number;
}

export interface Department { id: number; name: string }

export interface Researcher {
  id: number;
  name: string;
  email: string;
  title: string;
  orcid?: string;
  departmentId: number;
  kind?: "faculty" | "scholar";
  publicationCount?: number;
}

export type RelationshipType = "primary" | "co" | "backup";
export interface Relationship { id: number; mentorId: number; menteeId: number; type: RelationshipType }

export interface Milestone { id: number; scholarId: number; stage: string; dueDate: string; completedAt?: string }
export type MilestoneStatus = "done" | "upcoming" | "overdue";
export type MilestoneView = Milestone & { status: MilestoneStatus };

/** Confidential: visible only to the scholar and the supervisors named on the record. */
export interface MeetingLog { id: number; scholarId: number; mentorId: number; heldOn: string; notes: string }

export interface MenteeRow {
  researcher: Researcher; relationship: RelationshipType; current?: MilestoneView; overdue: number; lastMeeting?: string;
}
export interface MenteeDetail { researcher: Researcher; milestones: MilestoneView[]; meetings: MeetingLog[] }

export interface UnitRow {
  unitId: number; name: string; type: OrgUnitType; researchers: number; scholars: number;
  publications: number; awards: number; funding: number; overdue: number;
}
export interface UnitRollup { unit: OrgUnit; asOf: string; totals: UnitRow; children: UnitRow[]; byStage: { stage: string; count: number }[] }

export type VerificationState = "verified" | "suggested" | "unverified";
export type PublicationType = "journal-article" | "conference-paper" | "book-chapter" | "book" | "preprint" | "patent";
export type PublicationSource = "crossref" | "orcid" | "openalex" | "manual";

export interface Publication {
  id: number;
  title: string;
  doi?: string;
  venue: string;
  type: PublicationType;
  year: number;
  authorIds: number[];
  state: VerificationState;
  source: PublicationSource;
}

export interface Award {
  id: number;
  title: string;
  funder: string;
  amount: number;
  startYear: number;
  endYear: number;
  researcherId: number;
}

export interface Suggestion {
  id: number;
  publication: Publication;
  researcherId: number;
  score: number;
  reason: string;
}

export interface Summary { departments: number; researchers: number; publications: number; awards: number; pendingReview: number }
export interface YearCount { year: number; count: number }
export interface TopResearcher { researcherId: number; name: string; publications: number }
export interface DepartmentRow { departmentId: number; name: string; publications: number; awards: number; funding: number }

export interface PublicationFilters {
  q?: string; year?: number; type?: PublicationType | ""; state?: VerificationState | ""; departmentId?: number;
  page: number; size: number; sort?: string;
}
