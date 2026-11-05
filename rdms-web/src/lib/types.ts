/** Institution-level roles plus the platform-level Office of Research. */
export type Role = 'it_admin' | 'management' | 'faculty';
export type InstitutionRole = Exclude<Role, 'it_admin'>;
export type AccountStatus = 'pending' | 'active' | 'rejected' | 'suspended' | 'deactivated';

/** Approval workflow shared by every entry type, as in the reference RMS. */
export type Status = 'Draft' | 'Submitted' | 'Approved' | 'Rework' | 'Rejected';
export const STATUSES: Status[] = ['Draft', 'Submitted', 'Approved', 'Rework', 'Rejected'];

export interface HistoryItem {
  at: string; // ISO timestamp
  by: string; // display name
  action: string; // Created, Submitted, Approved, Sent for rework, ...
  remark?: string;
}

/** A platform account as the client sees it (no password hash, ever). */
export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  status: AccountStatus;
  institutionId: string | null; // null only for Office of Research
  facultyId?: string; // set for faculty accounts: the employee code inside the institution's database
  designation?: string;
}

export interface Institution {
  id: string;
  slug: string;
  name: string;
  tagline: string;
  emailDomain: string;
  status: 'active' | 'suspended';
  createdAt: string;
}

export interface Faculty {
  id: string; // employee code, e.g. EMP1001
  title: string; // Dr, Prof, Mr, Ms
  name: string;
  designation: string;
  department: string;
  email: string;
  phone: string;
  joiningDate: string; // yyyy-mm-dd
  orcid: string;
  scopusId: string;
  active: boolean;
}

export interface Qualification { degree: string; specialization: string; institution: string; year: string }
export interface Experience { organisation: string; designation: string; from: string; to: string }
export interface Award { title: string; by: string; year: string }
export interface Membership { body: string; type: string; since: string }

export interface Biodata {
  facultyId: string;
  dob: string;
  gender: string;
  address: string;
  summary: string;
  researchInterests: string;
  googleScholar: string;
  phdGuided: number;
  phdOngoing: number;
  qualifications: Qualification[];
  experience: Experience[];
  awards: Award[];
  memberships: Membership[];
  updatedAt: string;
}

/** Fields every workflow record has. */
export interface Base {
  id: string;
  facultyId: string; // owner (the faculty member who entered it)
  status: Status;
  createdAt: string;
  updatedAt: string;
  history: HistoryItem[];
}

export type AuthorKind = 'Faculty' | 'Student' | 'External' | 'Ex-Faculty' | 'Ex-Student';
export const AUTHOR_KINDS: AuthorKind[] = ['Faculty', 'Student', 'External', 'Ex-Faculty', 'Ex-Student'];

export interface Author {
  kind: AuthorKind;
  code: string; // employee code / roll number, blank for external
  name: string;
  institution: string;
  department: string;
  email: string;
}

export const PUB_TYPES = ['Journal Article', 'Book', 'Book Chapter', 'Conference Paper', 'Technical Report'] as const;
export type PubType = (typeof PUB_TYPES)[number];
export const PUB_CATEGORIES = ['Research Article', 'Review Article', 'Short Communication', 'Case Study', 'Editorial'];
export const INDEXING = ['Scopus', 'Web of Science', 'Scopus + WoS', 'UGC CARE', 'Not Indexed'];
export const QUARTILES = ['Q1', 'Q2', 'Q3', 'Q4', 'NA'];
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export interface Publication extends Base {
  entryType: PubType;
  category: string;
  title: string;
  doi: string;
  month: string;
  year: number;
  issn: string;
  venue: string; // journal / book / proceedings / publisher
  indexing: string;
  quartile: string;
  impactFactor: number;
  erfRelated: boolean;
  projectReference: string;
  openAccess: boolean;
  authors: Author[];
  pdfName: string;
}

export const GRANT_UNITS = ['Indian Grant', 'International Grant', 'Consultancy'];
export const GRANT_TYPES = ['Research Project', 'Consultancy', 'Infrastructure', 'Fellowship', 'Industry Sponsored'];
export const GRANT_SOURCES = ['Central Government', 'State Government', 'Industry', 'International Agency', 'Private Foundation'];
export const GRANT_OUTCOMES = ['Applied', 'Sanctioned', 'Not Sanctioned', 'Completed'] as const;
export type GrantOutcome = (typeof GRANT_OUTCOMES)[number];

export interface Investigator {
  kind: AuthorKind;
  code: string;
  name: string;
  role: 'PI' | 'Co-PI' | 'Co-I';
  institution: string;
  department: string;
  sharePct: number;
}

export interface Grant extends Base {
  unit: string;
  grantType: string;
  utn: string;
  title: string;
  description: string;
  callTitle: string;
  callSource: string;
  source: string;
  agency: string;
  agencyComment: string;
  appliedDate: string;
  appliedAmount: number;
  durationMonths: number;
  erfRelated: boolean;
  matchingGrant: boolean;
  contactNumber: string;
  outcome: GrantOutcome;
  sanctionDate: string;
  sanctionedAmount: number;
  receivedAmount: number;
  investigators: Investigator[];
  enclosures: string[];
  otherRemarks: string;
}

export interface SeedMoney extends Base {
  appliedDate: string;
  category: string; // Faculty / Student
  title: string;
  abstract: string;
  requestedAmount: number;
  sanctionedAmount: number;
  investigators: Investigator[];
}

export const FDP_ROLES = ['Attended', 'Organised', 'Resource Person'];
export const FDP_TYPES = ['FDP', 'Workshop', 'STTP', 'Refresher Course', 'Orientation Programme', 'Online Course (MOOC)'];
export const MODES = ['Offline', 'Online', 'Hybrid'];
export const LEVELS = ['Institutional', 'State', 'National', 'International'];

export interface Fdp extends Base {
  role: string;
  programmeType: string;
  title: string;
  organiser: string;
  sponsoredBy: string;
  mode: string;
  level: string;
  fromDate: string;
  toDate: string;
  hours: number;
  outcome: string; // what was learned / applied
  certificateName: string;
}

export const CONF_PARTICIPATION = ['Paper Presented', 'Poster Presented', 'Invited Talk / Keynote', 'Session Chair', 'Attended', 'Organised'];
export const FUNDING = ['Institution', 'Self', 'External Agency'];

export interface Conference extends Base {
  participation: string;
  conferenceName: string;
  paperTitle: string;
  organiser: string;
  venue: string;
  country: string;
  level: string;
  mode: string;
  fromDate: string;
  toDate: string;
  proceedingsIndexed: string; // Scopus / WoS / Not indexed / NA
  funding: string;
  registrationFee: number;
  amountClaimed: number;
  award: string;
  certificateName: string;
}

export const AWARD_CATEGORIES = ['Award', 'Honour / Distinction', 'Fellowship of a Learned Society', 'Best Paper / Presentation', 'Academic or Editorial Recognition', 'Scholarship / Travel Grant'];

/** An honour or award received by a faculty member. */
export interface Honour extends Base {
  category: string;
  title: string; // name of the honour or award
  awardedBy: string; // conferring body
  level: string; // LEVELS
  awardDate: string; // yyyy-mm-dd
  citation: string; // what it recognises
  prizeAmount: number; // ₹, 0 if none
  certificateName: string;
}

export type EntityKind = 'publications' | 'grants' | 'seedMoney' | 'fdps' | 'conferences' | 'awards';
export const ENTITY_LABEL: Record<EntityKind, string> = {
  publications: 'Publication',
  grants: 'Grant',
  seedMoney: 'Seed Money',
  fdps: 'FDP',
  conferences: 'Conference',
  awards: 'Honour / Award',
};

export interface Weights {
  q1: number; q2: number; q3: number; q4: number; otherJournal: number;
  book: number; chapter: number; confPaper: number; techReport: number;
  grantSanctioned: number; grantPerLakh: number; seedMoney: number;
  fdpAttended: number; fdpOrganised: number; fdpResource: number;
  confPresented: number; confInvited: number; confChair: number; confAttended: number; confOrganised: number;
  awardInternational: number; awardNational: number; awardOther: number;
}

/** Score weights for honours and awards; also fills them in for institutions created before the feature existed. */
export const AWARD_WEIGHT_DEFAULTS = { awardInternational: 6, awardNational: 4, awardOther: 2 };

export interface Targets {
  publicationsPerFaculty: number; // per academic year
  fdpHoursPerFaculty: number;
  conferencesPerFaculty: number;
  grantAppliedPerFaculty: number; // count of proposals
}

export interface Settings {
  institutionName: string;
  institutionTagline: string;
  departments: string[];
  academicYearStartMonth: number; // 1-12; 6 = June
  seedMoneyWindowOpen: boolean;
  targets: Targets;
  weights: Weights;
}

export interface Notice {
  id: string;
  at: string;
  title: string;
  body: string;
}

/** One institution's data. Each institution has its own database; nothing in here refers to another institution. */
export interface DB {
  version: number;
  settings: Settings;
  faculty: Faculty[];
  biodata: Biodata[];
  publications: Publication[];
  grants: Grant[];
  seedMoney: SeedMoney[];
  fdps: Fdp[];
  conferences: Conference[];
  awards: Honour[];
  notices: Notice[];
  seq: number;
}

export type AnyRecord = Publication | Grant | SeedMoney | Fdp | Conference | Honour;
