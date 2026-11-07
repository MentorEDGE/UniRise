/** The three roles. Every account belongs to one institution, including that institution's Office of Research. */
export type Role = 'office' | 'management' | 'faculty';
export type InstitutionRole = Role;
export type AccountStatus = 'pending' | 'active' | 'rejected' | 'suspended' | 'deactivated';

/** Approval workflow shared by every entry type, as in the reference RMS. */
export type Status = 'Draft' | 'Submitted' | 'Approved' | 'Rework' | 'Rejected';
export const STATUSES: Status[] = ['Draft', 'Submitted', 'Approved', 'Rework', 'Rejected'];
/** How each state is named on screen. A submitted entry is pending approval by the Office of Research. */
export const STATUS_LABEL: Record<Status, string> = { Draft: 'Draft', Submitted: 'Submitted · Pending Approval', Approved: 'Approved', Rework: 'Returned for Correction', Rejected: 'Rejected' };

export interface HistoryItem {
  at: string; // ISO timestamp
  by: string; // display name
  action: string; // Created, Submitted, Approved, Returned for correction, ...
  remark?: string;
}

/** A platform account as the client sees it (no password hash, ever). */
export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  status: AccountStatus;
  institutionId: string | null;
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
  /** Researcher-profile fields (directory and public profile). */
  expertise: string; // areas of expertise, separated by semicolons
  keywords: string; // research keywords, separated by commas
  sdgs: number[]; // UN Sustainable Development Goals (1-17) the faculty member's work contributes to, as declared in the profile
  photo: string; // small JPEG data URL, '' if none
  scholar: ScholarMetrics;
  updatedAt: string;
}

/**
 * Google Scholar metrics as copied from the faculty member's own Scholar profile. Never estimated: a null value
 * shows as "Not available". Each change is stamped with who made it and when.
 */
export interface ScholarMetrics {
  citations: number | null;
  hIndex: number | null;
  i10Index: number | null;
  updatedAt: string; // '' until first entered
  updatedBy: string;
}
export const EMPTY_SCHOLAR: ScholarMetrics = { citations: null, hIndex: null, i10Index: null, updatedAt: '', updatedBy: '' };

/** The 17 UN Sustainable Development Goals, with their official colours. */
export const SDGS: { n: number; title: string; color: string }[] = [
  { n: 1, title: 'No Poverty', color: '#E5243B' },
  { n: 2, title: 'Zero Hunger', color: '#DDA63A' },
  { n: 3, title: 'Good Health and Well-being', color: '#4C9F38' },
  { n: 4, title: 'Quality Education', color: '#C5192D' },
  { n: 5, title: 'Gender Equality', color: '#FF3A21' },
  { n: 6, title: 'Clean Water and Sanitation', color: '#26BDE2' },
  { n: 7, title: 'Affordable and Clean Energy', color: '#FCC30B' },
  { n: 8, title: 'Decent Work and Economic Growth', color: '#A21942' },
  { n: 9, title: 'Industry, Innovation and Infrastructure', color: '#FD6925' },
  { n: 10, title: 'Reduced Inequalities', color: '#DD1367' },
  { n: 11, title: 'Sustainable Cities and Communities', color: '#FD9D24' },
  { n: 12, title: 'Responsible Consumption and Production', color: '#BF8B2E' },
  { n: 13, title: 'Climate Action', color: '#3F7E44' },
  { n: 14, title: 'Life Below Water', color: '#0A97D9' },
  { n: 15, title: 'Life on Land', color: '#56C02B' },
  { n: 16, title: 'Peace, Justice and Strong Institutions', color: '#00689D' },
  { n: 17, title: 'Partnerships for the Goals', color: '#19486A' },
];

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
  country?: string; // for external co-authors: country of their institution (collaboration map)
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
  country?: string; // for external investigators
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

/** Intellectual property, as on the institution's IP submission form. */
export const IP_TYPES = ['Patent', 'Design', 'Copyright', 'Trademark', 'Other'];
export const IP_STATUSES = ['Filed', 'Published', 'Granted / Registered'];
export const IP_OWNERS = ['University', 'Individual(s)', 'Joint', 'Other'];
export const ipIsGranted = (stage: string) => stage === 'Granted / Registered';
export const IP_DESCRIPTION_WORDS = 50;
export const wordCount = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

/** A patent, design, copyright, trademark or other IP held by a faculty member. */
export interface IntellectualProperty extends Base {
  ipType: string; // IP_TYPES
  ipTypeOther: string; // when ipType is 'Other'
  title: string;
  description: string; // brief, at most IP_DESCRIPTION_WORDS words
  stage: string; // IP_STATUSES
  applicationNumber: string; // application / registration number
  filingDate: string; // yyyy-mm-dd
  grantDate: string; // grant / registration date, yyyy-mm-dd, '' if not yet
  office: string; // office / country, e.g. Indian Patent Office, USPTO, PCT
  owner: string; // IP_OWNERS
  ownerOther: string; // when owner is 'Other'
  funding: string; // funding source / sponsor, if any
  licensed: boolean; // licensed or commercialised
  licensee: string; // partner name, if licensed
  coOwners: string; // co-inventors / co-creators (name, affiliation)
  documentName: string; // filing receipt or registration certificate
  agreementName: string; // funding or ownership agreement, if applicable
  declared: boolean; // information accurate and all co-inventors listed
}
/** The type as shown: the text entered for 'Other'. */
export const ipTypeLabel = (x: { ipType: string; ipTypeOther?: string }) => (x.ipType === 'Other' ? x.ipTypeOther?.trim() || 'Other' : x.ipType);

export type EntityKind = 'publications' | 'grants' | 'seedMoney' | 'fdps' | 'conferences' | 'awards' | 'ipr';
export const ENTITY_LABEL: Record<EntityKind, string> = {
  publications: 'Publication',
  grants: 'Grant',
  seedMoney: 'Seed Money',
  fdps: 'FDP',
  conferences: 'Conference',
  awards: 'Honour / Award',
  ipr: 'Intellectual Property',
};

export interface Weights {
  q1: number; q2: number; q3: number; q4: number; otherJournal: number;
  book: number; chapter: number; confPaper: number; techReport: number;
  grantSanctioned: number; grantPerLakh: number; seedMoney: number;
  fdpAttended: number; fdpOrganised: number; fdpResource: number;
  confPresented: number; confInvited: number; confChair: number; confAttended: number; confOrganised: number;
  awardInternational: number; awardNational: number; awardOther: number;
  patentGranted: number; patentFiled: number; design: number; copyright: number; trademark: number; ipOther: number;
}

/** Score weights for honours and awards; also fills them in for institutions created before the feature existed. */
export const AWARD_WEIGHT_DEFAULTS = { awardInternational: 6, awardNational: 4, awardOther: 2 };
/** Score weights for intellectual property; also fills them in for institutions created before the feature existed. */
export const IP_WEIGHT_DEFAULTS = { patentGranted: 10, patentFiled: 4, design: 3, copyright: 3, trademark: 2, ipOther: 2 };

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

/** Faculty-editable profile fields. Changes to them wait for the Office of Research before replacing the live profile. */
export const PROFILE_FIELDS = ['dob', 'gender', 'address', 'summary', 'researchInterests', 'googleScholar', 'phdGuided', 'phdOngoing', 'qualifications', 'experience', 'memberships', 'expertise', 'keywords', 'sdgs', 'photo', 'scholar'] as const;
export const CONTACT_FIELDS = ['email', 'phone', 'orcid', 'scopusId'] as const;

/** A faculty member's proposed profile update: one open request per person, reviewed like any other entry. */
export interface ProfileChange {
  id: string;
  facultyId: string;
  status: Status;
  createdAt: string;
  updatedAt: string;
  history: HistoryItem[];
  biodata: Biodata; // the full proposed profile
  contact: Pick<Faculty, (typeof CONTACT_FIELDS)[number]>;
  changed: string[]; // labels of what differs from the approved profile, for the reviewer
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
  ipr: IntellectualProperty[];
  profileChanges: ProfileChange[];
  notices: Notice[];
  seq: number;
}

export type AnyRecord = Publication | Grant | SeedMoney | Fdp | Conference | Honour | IntellectualProperty;
