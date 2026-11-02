// shortcut: one role per user; the spec allows several role grants, switch to roles[] when /me returns grants.
export type Role = "RESEARCH_ADMIN" | "EXECUTIVE" | "DEAN" | "HOD" | "SUPERVISOR" | "RESEARCHER" | "VIEWER" | "IT_ADMIN" | "GUEST" | "PLATFORM_ADMIN";

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
  /** Guest only: access ends on this date and covers only the item named in guestItem. */
  expiresOn?: string;
  guestItem?: { kind: "report" | "publication"; ref: string; label: string };
  /** Set when the user holds an acting or delegated grant on top of their own role. */
  actingAs?: { role: Role; scopeUnitId: number; until?: string };
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
  /** R8: people who leave keep their past outputs; access ends on leftOn. */
  status?: "active" | "left";
  leftOn?: string;
  /** The iD was verified by signing in with ORCID once. */
  orcidVerified?: boolean;
  /** Consent to appear on the public profile site (R22). */
  publicProfile?: boolean;
}

/** Names are part of the public scholarly record; used by pickers and author lists. */
export type DirectoryEntry = Pick<Researcher, "id" | "name" | "title" | "departmentId" | "kind" | "employeeId" | "rollNo">;

/** Effective-dated appointment; joint appointments are several rows valid at the same time (R29). */
export interface Appointment { id: number; researcherId: number; unitId: number; designation: string; fte: number; validFrom: string; validTo?: string }

export type RelationshipType = "primary" | "co" | "backup";
export interface Relationship { id: number; mentorId: number; menteeId: number; type: RelationshipType; validFrom?: string; validTo?: string }

export interface Milestone { id: number; scholarId: number; stage: string; dueDate: string; completedAt?: string; approvedBy?: string; approvedOn?: string; feedback?: string }
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
  /** R14: open-access status and funder-mandate compliance. */
  oaStatus?: "gold" | "green" | "hybrid" | "closed";
  funderMandate?: "compliant" | "non-compliant" | "not-applicable";
  repositoryUrl?: string;
  /** Optimistic locking: the server rejects a save made against an older version. */
  version?: number;
  /** Set when this record was merged into another (kept for the audit trail). */
  mergedInto?: number;
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
export interface ReportParams { from?: string; to?: string; basis?: "applied" | "entered" | "sanctioned"; researcherId?: number; unitId?: number }
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
  oa?: Publication["oaStatus"] | "";
}


/* ===================== Added for the remaining RMS-doc features ===================== */

/** Server-side effect of a role grant (ACCESS_AND_VISIBILITY_MODEL §5). */
export interface RoleGrant {
  id: number;
  researcherId?: number;
  holder: string;
  role: Role;
  scopeUnitId?: number;
  validFrom: string;
  validTo?: string;
  grantedBy: string;
  kind: "direct" | "acting" | "delegated";
  note?: string;
}

export interface AuditEntry { id: number; at: string; actor: string; action: string; entity: string; entityId?: number | string; detail?: string }
/** Named drill-downs and platform support access (PRD R5). */
export interface AccessLogEntry { id: number; at: string; actor: string; role: Role; action: "drill-down" | "support-access" | "export" | "guest-view"; targetName?: string; targetId?: number; note?: string }

export interface DuplicatePair { id: string; a: Publication; b: Publication; reason: string; score: number }
export type DisputeStatus = "open" | "upheld" | "dismissed";
export interface Dispute { id: number; publicationId: number; publicationTitle: string; researcherId: number; researcherName: string; reason: string; raisedOn: string; status: DisputeStatus; resolution?: string; resolvedBy?: string; resolvedOn?: string }

export interface Reminder {
  id: string;
  milestoneId: number;
  scholarId: number;
  scholarName: string;
  stage: string;
  dueDate: string;
  /** soon: due within 14 days. overdue: past due. escalated: overdue by more than 30 days, also sent to the HoD. */
  level: "soon" | "overdue" | "escalated";
  daysOverdue: number;
  /** Who gets it, so the reason for a message is always visible. */
  recipients: string[];
  reason: string;
}

export interface Period { id: number; label: string; startsOn: string; endsOn: string; closedAt?: string; closedBy?: string }
export interface UnitSnapshot { periodId: number; takenAt: string; rollup: UnitRollup }

export interface ClassificationTerm { code: string; label: string; validFrom: string; validTo?: string }
export interface ClassificationScheme { id: number; code: string; name: string; terms: ClassificationTerm[] }

export interface TenantSettings {
  name: string;
  logoText: string;
  /** Hex colour (#rrggbb). Applied as the primary colour only if it has enough contrast. */
  accent: string;
  currency: "INR" | "USD" | "EUR" | "GBP";
  fiscalYearStartMonth: number;
  locale: string;
  publicProfilesEnabled: boolean;
  /** HoD validation is optional per tenant (ACCESS decision 6). */
  hodValidation: boolean;
  /** Days after which an overdue milestone reminder also goes to the HoD. */
  escalationDays: number;
  sso: { provider: "google" | "microsoft" | "none"; clientId: string; domain: string; status: "not-configured" | "configured" | "verified" };
}

export interface ApiKeyRow { id: number; name: string; prefix: string; createdOn: string; lastUsed?: string; revokedOn?: string }
export interface Webhook { id: number; url: string; events: string[]; active: boolean }
export const WEBHOOK_EVENTS = ["publication.approved", "grant.sanctioned", "milestone.overdue", "period.closed", "claim.confirmed"] as const;

export interface HarvestRun { id: number; at: string; source: "ORCID" | "OpenAlex" | "Crossref"; researchers: number; found: number; newSuggestions: number; status: "ok" | "partial" | "failed"; note?: string }

export type TenantStatus = "sandbox" | "pilot" | "active" | "suspended" | "closed";
export interface Tenant { id: number; name: string; status: TenantStatus; plan: string; createdOn: string; activeResearchers: { month: string; count: number }[] }

export interface Project { id: number; title: string; leadId: number; status: "active" | "completed" | "proposed"; awardIds: number[]; grantIds: number[]; publicationIds: number[]; summary?: string; sensitivity: "internal" | "confidential" }
export interface SavedReport { id: number; name: string; slug: string; params: ReportParams; ownerId: number; createdOn: string }

export interface ImportRow { line: number; values: Record<string, string>; errors: string[]; action?: "create" | "update" | "skip" }
export interface ImportPreview { kind: "people" | "org-units"; rows: ImportRow[]; ok: number; failed: number; creates: number; updates: number }
export interface ImportResult { created: number; updated: number; skipped: number }

export interface PublicProfile { researcher: Pick<Researcher, "id" | "name" | "title" | "orcid">; department: string; institution: string; publications: Pick<Publication, "id" | "title" | "venue" | "year" | "doi" | "type">[] }

export interface SupervisionView {
  researcherId: number;
  supervisors: { relationship: Relationship; mentor: DirectoryEntry; mentorLeft: boolean }[];
  mentees: { relationship: Relationship; mentee: DirectoryEntry }[];
  /** Scholars whose only active supervisor has left and who have no backup: the reassignment prompt. */
  needsReassignment: boolean;
}
export interface ReassignmentItem { scholar: DirectoryEntry; relationship: Relationship; leftSupervisor: DirectoryEntry; leftOn?: string; hasBackup: boolean }

export interface Claim { id: number; publication: Publication; state: VerificationState; source: PublicationSource }
