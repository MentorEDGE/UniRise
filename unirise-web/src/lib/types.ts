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
  employeeId?: string;
  rollNo?: string;
  scopusId?: string;
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
export type PublicationType = "journal-article" | "conference-paper" | "book-chapter" | "book" | "technical-report" | "preprint" | "patent";
export type PublicationSource = "crossref" | "orcid" | "openalex" | "manual";

/** Approval workflow of an entry; harvested records have none and count as approved. */
export type EntryStatus = "draft" | "submitted" | "approved" | "rework" | "revision_required" | "rejected";
export type ReviewAction = "approve" | "rework" | "revision_required" | "reject";

export type AuthorKind = "internal-faculty" | "internal-student" | "external" | "ex-faculty" | "ex-student";
export interface PubAuthor {
  kind: AuthorKind;
  researcherId?: number;
  name: string;
  institution: string;
  department?: string;
  email?: string;
  /** Termination or course-completion date for ex-faculty and ex-student authors (ISO date). */
  endDate?: string;
  continent?: string;
}

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
  entryStatus?: EntryStatus;
  reviewComment?: string;
  category?: string;
  month?: number;
  issn?: string;
  projectRef?: boolean;
  projectDetails?: string;
  studentPublication?: boolean;
  pdfName?: string;
  authors?: PubAuthor[];
}

export interface Enclosure { name: string }
export type GrantStatus = "draft" | "submitted" | "sanctioned" | "rework" | "rejected";
export interface GrantInvestigator {
  researcherId?: number; name: string; role: "PI" | "Co-PI" | "Collaborator"; isLead: boolean;
  institution: string; department?: string; sharePct: number;
}
export interface Grant {
  id: number;
  unit: string;
  status: GrantStatus;
  type: string;
  utn?: string;
  title: string;
  description?: string;
  callTitle?: string;
  source: string;
  agency: string;
  agencyComment?: string;
  appliedOn: string;
  enteredOn: string;
  sanctionedOn?: string;
  appliedAmount: number;
  sanctionedAmount?: number;
  durationMonths?: number;
  matchingGrant: boolean;
  contact?: string;
  investigators: GrantInvestigator[];
  enclosures: Enclosure[];
  remarks?: string;
  ownerId: number;
  reviewComment?: string;
}

export interface SeedWindow { label: string; opensOn: string; closesOn: string }
export interface SeedInvestigator { researcherId?: number; name: string; investigatorType: string; isLeadPI: boolean; institution: string; department?: string }
export interface SeedProposal {
  id: number;
  appliedOn: string;
  category: string;
  title: string;
  abstract: string;
  windowLabel: string;
  status: EntryStatus;
  investigators: SeedInvestigator[];
  ownerId: number;
  reviewComment?: string;
}

export interface ReportTable { columns: string[]; rows: (string | number)[][] }
export interface ReportParams { from?: string; to?: string; basis?: "applied" | "entered" | "sanctioned" }
export interface LookupResult { researcher: Researcher; institute: string; department: string; publications: Publication[]; grants: number }

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
  q?: string; year?: number; type?: PublicationType | ""; state?: VerificationState | ""; status?: EntryStatus | ""; departmentId?: number;
  page: number; size: number; sort?: string;
}
