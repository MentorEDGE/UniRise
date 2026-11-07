/**
 * Business and access rules for ONE institution's data. Pure functions: they take the institution's DB and the
 * signed-in actor, check permissions, and mutate the DB (or throw). The server is the only caller; it loads the
 * actor's own institution database, so nothing here can reach another institution.
 */
import type {
  AnyRecord, Author, Biodata, DB, EntityKind, Faculty, Grant, Investigator, Notice, ProfileChange, Publication, Settings, Status,
} from './types';
import { AUTHOR_KINDS, AWARD_CATEGORIES, EMPTY_SCHOLAR, IP_DESCRIPTION_WORDS, IP_OWNERS, IP_STATUSES, IP_TYPES, LEVELS, PUB_TYPES, wordCount } from './types';
import type { IntellectualProperty } from './types';

/** 'office' is the Office of Research acting on one institution's database (record approvals only). */
export interface Actor { userId: string; name: string; role: 'management' | 'faculty' | 'office'; facultyId?: string }

/** Error with an HTTP status; the server turns it into the response. */
export class RuleError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
const forbid = (m: string) => new RuleError(403, m);
const notFound = (what = 'Entry') => new RuleError(404, `${what} not found.`);
const invalid = (m: string) => new RuleError(400, m);

const now = () => new Date().toISOString();

// ---------- credit and visibility ----------

/** Faculty who get credit for a record: the owner plus internal faculty co-authors / co-investigators. */
export function creditedFaculty(kind: EntityKind, r: AnyRecord): string[] {
  const ids = new Set([r.facultyId]);
  if (kind === 'publications') (r as Publication).authors.forEach((a) => a.kind === 'Faculty' && a.code && ids.add(a.code));
  if (kind === 'grants' || kind === 'seedMoney') (r as Grant).investigators.forEach((a) => a.kind === 'Faculty' && a.code && ids.add(a.code));
  return [...ids];
}

export const isEditable = (r: { status: Status }) => r.status === 'Draft' || r.status === 'Rework';

/**
 * Faculty see only records they are credited on (any state): nothing of other faculty's profiles or records.
 * Management sees APPROVED records of its own institution only: drafts, submissions waiting for review, rework and
 * rejections belong to the Office of Research approval workflow and are not shown to management.
 */
export function canView(actor: Actor, kind: EntityKind, r: AnyRecord) {
  if (actor.role === 'office') return true;
  if (actor.role === 'management') return r.status === 'Approved';
  return creditedFaculty(kind, r).includes(actor.facultyId!);
}

const KINDS: EntityKind[] = ['publications', 'grants', 'seedMoney', 'fdps', 'conferences', 'awards', 'ipr'];

/** The slice of the institution's data this actor may receive. */
export function scopeFor(db: DB, actor: Actor): DB {
  if (actor.role === 'office') return db;
  if (actor.role === 'management') {
    const out: DB = { ...db };
    // Approved records only, and without the review history: approval remarks stay with the Office of Research.
    for (const k of KINDS) (out[k] as AnyRecord[]) = (db[k] as AnyRecord[]).filter((r) => r.status === 'Approved').map((r) => ({ ...r, history: r.history.filter((h) => h.action === 'Created' || h.action === 'Approved' || h.action.startsWith('Outcome')) }));
    out.profileChanges = []; // pending profile edits are not institutional information until approved
    out.faculty = db.faculty.filter((f) => f.active);
    return out;
  }
  const me = actor.facultyId!;
  const out: DB = {
    ...db,
    // Colleagues: only name, title, department and employee code, so co-authors can be picked in entry forms.
    faculty: db.faculty.filter((f) => f.id === me || f.active).map((f) => (f.id === me ? f : { id: f.id, title: f.title, name: f.name, department: f.department, designation: '', email: '', phone: '', joiningDate: '', orcid: '', scopusId: '', active: true })),
    biodata: db.biodata.filter((b) => b.facultyId === me),
    profileChanges: (db.profileChanges ?? []).filter((c) => c.facultyId === me),
    publications: [], grants: [], seedMoney: [], fdps: [], conferences: [], awards: [], ipr: [],
  };
  for (const k of KINDS) (out[k] as AnyRecord[]) = (db[k] as AnyRecord[]).filter((r) => canView(actor, k, r));
  return out;
}

// ---------- input sanitising ----------

type Spec = Record<string, 'string' | 'number' | 'boolean' | 'strings' | 'authors' | 'investigators'>;
const SPECS: Record<EntityKind, Spec> = {
  publications: { entryType: 'string', category: 'string', title: 'string', doi: 'string', month: 'string', year: 'number', issn: 'string', venue: 'string', indexing: 'string', quartile: 'string', impactFactor: 'number', erfRelated: 'boolean', projectReference: 'string', openAccess: 'boolean', authors: 'authors', pdfName: 'string' },
  grants: { unit: 'string', grantType: 'string', utn: 'string', title: 'string', description: 'string', callTitle: 'string', callSource: 'string', source: 'string', agency: 'string', agencyComment: 'string', appliedDate: 'string', appliedAmount: 'number', durationMonths: 'number', erfRelated: 'boolean', matchingGrant: 'boolean', contactNumber: 'string', investigators: 'investigators', enclosures: 'strings', otherRemarks: 'string' },
  seedMoney: { appliedDate: 'string', category: 'string', title: 'string', abstract: 'string', requestedAmount: 'number', investigators: 'investigators' },
  fdps: { role: 'string', programmeType: 'string', title: 'string', organiser: 'string', sponsoredBy: 'string', mode: 'string', level: 'string', fromDate: 'string', toDate: 'string', hours: 'number', outcome: 'string', certificateName: 'string' },
  conferences: { participation: 'string', conferenceName: 'string', paperTitle: 'string', organiser: 'string', venue: 'string', country: 'string', level: 'string', mode: 'string', fromDate: 'string', toDate: 'string', proceedingsIndexed: 'string', funding: 'string', registrationFee: 'number', amountClaimed: 'number', award: 'string', certificateName: 'string' },
  awards: { category: 'string', title: 'string', awardedBy: 'string', level: 'string', awardDate: 'string', citation: 'string', prizeAmount: 'number', certificateName: 'string' },
  ipr: { ipType: 'string', ipTypeOther: 'string', title: 'string', description: 'string', stage: 'string', applicationNumber: 'string', filingDate: 'string', grantDate: 'string', office: 'string', owner: 'string', ownerOther: 'string', funding: 'string', licensed: 'boolean', licensee: 'string', coOwners: 'string', documentName: 'string', agreementName: 'string', declared: 'boolean' },
};
const str = (v: unknown, max = 2000) => (typeof v === 'string' ? v.slice(0, max) : '');
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const kindOf = (v: unknown) => (AUTHOR_KINDS.includes(v as never) ? (v as Author['kind']) : 'External');
const list = <T,>(v: unknown, max: number, fn: (x: Record<string, unknown>) => T): T[] => (Array.isArray(v) ? v.slice(0, max).map((x) => fn((x ?? {}) as Record<string, unknown>)) : []);

/** Keeps only the known fields of a record, with the right types. Workflow fields are never taken from input. */
function sanitize(kind: EntityKind, input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, t] of Object.entries(SPECS[kind])) {
    const v = input[k];
    if (t === 'string') out[k] = str(v);
    else if (t === 'number') out[k] = num(v);
    else if (t === 'boolean') out[k] = v === true;
    else if (t === 'strings') out[k] = list(v as unknown, 50, (x) => x as unknown).map((x) => str(x, 300)).filter(Boolean);
    else if (t === 'authors') out[k] = list(v, 100, (a): Author => ({ kind: kindOf(a.kind), code: str(a.code, 40), name: str(a.name, 200), institution: str(a.institution, 300), department: str(a.department, 300), email: str(a.email, 200), country: str(a.country, 80) }));
    else out[k] = list(v, 30, (a): Investigator => ({ kind: kindOf(a.kind), code: str(a.code, 40), name: str(a.name, 200), role: (['PI', 'Co-PI', 'Co-I'].includes(a.role as string) ? a.role : 'Co-I') as Investigator['role'], institution: str(a.institution, 300), department: str(a.department, 300), sharePct: num(a.sharePct), country: str(a.country, 80) }));
  }
  return out;
}

/** Core checks repeated on the server; the forms do the same and more for a friendlier message. */
function validate(db: DB, kind: EntityKind, r: AnyRecord, submit: boolean) {
  const need = (v: unknown, label: string) => { if (typeof v === 'string' ? !v.trim() : !v) throw invalid(`${label} is required.`); };
  const today = new Date().toISOString().slice(0, 10);
  if (kind === 'publications') {
    const p = r as Publication;
    if (!PUB_TYPES.includes(p.entryType)) throw invalid('Choose an entry type.');
    need(p.title, 'Title'); need(p.venue, 'Venue');
    if (p.year > new Date().getFullYear() || p.year < 1950) throw invalid('Enter a valid publication year.');
    if (!p.authors.some((a) => a.code === r.facultyId)) throw invalid('You must be listed as one of the authors.');
    const doi = p.doi.trim().toLowerCase();
    if (doi) {
      const dup = db.publications.find((x) => x.id !== r.id && x.doi.trim().toLowerCase() === doi);
      if (dup) throw invalid(`This DOI is already entered as ${dup.id}. Ask the owner to add you as an author instead.`);
    }
    if (submit && p.entryType !== 'Book' && !p.pdfName) throw invalid('Upload the PDF before submitting (optional for books).');
  }
  if (kind === 'grants' || kind === 'seedMoney') {
    const g = r as Grant;
    need(g.title, 'Title');
    if (kind === 'grants') { need(g.agency, 'Grant agency'); if (g.appliedAmount <= 0) throw invalid('Enter the applied amount.'); }
    if (kind === 'seedMoney' && ((r as unknown as { requestedAmount: number }).requestedAmount <= 0 || (r as unknown as { requestedAmount: number }).requestedAmount > 500000)) throw invalid('Requested amount must be between ₹1 and ₹5,00,000.');
    const inv = g.investigators;
    if (!inv.some((i) => i.code === r.facultyId)) throw invalid('You must be one of the investigators.');
    if (inv.reduce((a, x) => a + x.sharePct, 0) !== 100) throw invalid('Investigator shares must add up to 100%.');
    if (inv.filter((i) => i.role === 'PI').length !== 1) throw invalid('There must be exactly one PI.');
  }
  if (kind === 'fdps' || kind === 'conferences') {
    const x = r as unknown as { fromDate: string; toDate: string; title?: string; conferenceName?: string };
    need(kind === 'fdps' ? x.title : x.conferenceName, kind === 'fdps' ? 'Programme title' : 'Conference name');
    need(x.fromDate, 'From date'); need(x.toDate, 'To date');
    if (x.toDate < x.fromDate) throw invalid('To date must be on or after the from date.');
    if (x.toDate > today) throw invalid('Enter it after it has taken place.');
  }
  if (kind === 'awards') {
    const a = r as unknown as { category: string; title: string; awardedBy: string; level: string; awardDate: string; prizeAmount: number };
    if (!AWARD_CATEGORIES.includes(a.category)) throw invalid('Choose a category.');
    need(a.title, 'Name of the honour or award'); need(a.awardedBy, 'Conferred by'); need(a.awardDate, 'Date received');
    if (!LEVELS.includes(a.level)) throw invalid('Choose a level.');
    if (a.awardDate > today) throw invalid('Enter an honour after it has been received.');
    if (a.prizeAmount < 0) throw invalid('Prize amount cannot be negative.');
  }
  if (kind === 'ipr') {
    const x = r as unknown as IntellectualProperty;
    if (!IP_TYPES.includes(x.ipType)) throw invalid('Choose the type of IP.');
    if (x.ipType === 'Other') need(x.ipTypeOther, 'The type of IP (other)');
    need(x.title, 'Title'); need(x.description, 'Brief description');
    if (wordCount(x.description) > IP_DESCRIPTION_WORDS) throw invalid(`Keep the brief description to ${IP_DESCRIPTION_WORDS} words.`);
    if (!IP_STATUSES.includes(x.stage)) throw invalid('Choose the status.');
    need(x.applicationNumber, 'Application / registration number'); need(x.filingDate, 'Filing date'); need(x.office, 'Office / country');
    if (x.filingDate > today) throw invalid('Enter it after it has been filed.');
    if (x.grantDate && x.grantDate < x.filingDate) throw invalid('The grant / registration date cannot be before the filing date.');
    if (x.grantDate > today) throw invalid('The grant / registration date cannot be in the future.');
    if (!IP_OWNERS.includes(x.owner)) throw invalid('Choose the registered owner / applicant.');
    if (x.owner === 'Other') need(x.ownerOther, 'The registered owner / applicant (other)');
    if (x.licensed) need(x.licensee, 'Partner name');
    const dup = db.ipr.find((y) => y.id !== r.id && y.applicationNumber.trim().toLowerCase() === x.applicationNumber.trim().toLowerCase());
    if (dup) throw invalid(`This application / registration number is already entered as ${dup.id}.`);
    if (submit && !x.documentName) throw invalid('Attach the filing receipt or registration certificate before submitting.');
    if (submit && !x.declared) throw invalid('Confirm the declaration before submitting.');
  }
}

// ---------- workflow records ----------

const PREFIX: Record<EntityKind, string> = { publications: 'PUB', grants: 'GRT', seedMoney: 'SM', fdps: 'FDP', conferences: 'CNF', awards: 'AWD', ipr: 'IPR' };

function requireFaculty(actor: Actor, db: DB) {
  if (actor.role !== 'faculty' || !actor.facultyId) throw forbid('Entries are made by faculty members.');
  if (!db.faculty.find((f) => f.id === actor.facultyId)?.active) throw forbid('Your faculty profile is inactive.');
}
function requireOffice(actor: Actor) {
  if (actor.role !== 'office') throw forbid('Only the Office of Research can approve entries.');
}

/** Faculty create or edit their own entry; `submit` sends it for approval. Returns the saved id. */
export function saveRecord(db: DB, actor: Actor, kind: EntityKind, input: Record<string, unknown>, submit: boolean): string {
  if (!SPECS[kind]) throw notFound('Entry type');
  requireFaculty(actor, db);
  const list = db[kind] as AnyRecord[];
  const id = typeof input.id === 'string' && input.id ? input.id : '';
  const existing = id ? list.find((r) => r.id === id) : undefined;
  if (id && (!existing || !canView(actor, kind, existing))) throw notFound();
  if (existing && existing.facultyId !== actor.facultyId) throw forbid('You can only edit entries you created.');
  if (existing && !isEditable(existing)) throw forbid(`This entry is ${existing.status.toLowerCase()} and can no longer be edited.`);
  if (kind === 'seedMoney' && !existing && !db.settings.seedMoneyWindowOpen) throw forbid('The seed money window is closed for this quarter.');

  const at = now();
  const history = [...(existing?.history ?? [])];
  history.push({ at, by: actor.name, action: existing ? 'Edited' : 'Created' });
  if (submit) history.push({ at, by: actor.name, action: existing?.status === 'Rework' ? 'Resubmitted' : 'Submitted' });
  let newId = id;
  if (!newId) { db.seq += 1; newId = `${PREFIX[kind]}${db.seq}`; }
  // Funding outcome fields belong to management; keep what is stored.
  const keep = kind === 'grants'
    ? { outcome: (existing as Grant | undefined)?.outcome ?? 'Applied', sanctionDate: (existing as Grant | undefined)?.sanctionDate ?? '', sanctionedAmount: (existing as Grant | undefined)?.sanctionedAmount ?? 0, receivedAmount: (existing as Grant | undefined)?.receivedAmount ?? 0 }
    : kind === 'seedMoney' ? { sanctionedAmount: (existing as unknown as { sanctionedAmount?: number })?.sanctionedAmount ?? 0 } : {};
  const saved = {
    ...sanitize(kind, input), ...keep, id: newId, facultyId: actor.facultyId!, status: submit ? 'Submitted' : existing?.status ?? 'Draft',
    createdAt: existing?.createdAt ?? at, updatedAt: at, history,
  } as unknown as AnyRecord;
  validate(db, kind, saved, submit);
  const i = list.findIndex((r) => r.id === newId);
  if (i >= 0) list[i] = saved; else list.unshift(saved);
  return newId;
}

export function deleteRecord(db: DB, actor: Actor, kind: EntityKind, id: string) {
  requireFaculty(actor, db);
  const list = db[kind] as AnyRecord[];
  const i = list.findIndex((x) => x.id === id);
  if (i < 0 || !canView(actor, kind, list[i])) throw notFound();
  if (list[i].facultyId !== actor.facultyId) throw forbid('You can only delete your own entries.');
  if (list[i].status !== 'Draft') throw forbid('Only drafts can be deleted.');
  list.splice(i, 1);
}

export type Decision = 'Approved' | 'Rework' | 'Rejected';

/** Approve, send for rework or reject a submitted entry. Office of Research only. */
export function review(db: DB, actor: Actor, kind: EntityKind, id: string, decision: Decision, remark: string, sanctionedAmount?: number) {
  requireOffice(actor);
  if (!['Approved', 'Rework', 'Rejected'].includes(decision)) throw invalid('Unknown decision.');
  const list = db[kind] as AnyRecord[];
  const i = list.findIndex((x) => x.id === id);
  if (i < 0) throw notFound();
  if (list[i].status !== 'Submitted') throw invalid('Only submitted entries can be reviewed.');
  const note = str(remark, 1000).trim();
  if (decision !== 'Approved' && !note) throw invalid('Give a remark so the faculty member knows what to change.');
  const at = now();
  const action = decision === 'Approved' ? 'Approved' : decision === 'Rework' ? 'Returned for correction' : 'Rejected';
  const updated = { ...list[i], status: decision, updatedAt: at, history: [...list[i].history, { at, by: actor.name, action, remark: note || undefined }] } as AnyRecord;
  if (kind === 'seedMoney' && decision === 'Approved' && sanctionedAmount != null) {
    if (num(sanctionedAmount) < 0) throw invalid('Sanctioned amount cannot be negative.');
    (updated as unknown as { sanctionedAmount: number }).sanctionedAmount = num(sanctionedAmount);
  }
  list[i] = updated;
}

/** Records the funding outcome of an approved grant. Office of Research only: management has read-only access. */
export function updateGrantOutcome(db: DB, actor: Actor, id: string, patch: Pick<Grant, 'outcome' | 'sanctionDate' | 'sanctionedAmount' | 'receivedAmount'>) {
  requireOffice(actor);
  const i = db.grants.findIndex((g) => g.id === id);
  if (i < 0) throw notFound('Grant');
  if (db.grants[i].status !== 'Approved') throw invalid('Record the outcome after the grant entry is approved.');
  if (!['Applied', 'Sanctioned', 'Not Sanctioned', 'Completed'].includes(patch.outcome)) throw invalid('Unknown outcome.');
  const clean = { outcome: patch.outcome, sanctionDate: str(patch.sanctionDate, 10), sanctionedAmount: num(patch.sanctionedAmount), receivedAmount: num(patch.receivedAmount) };
  if (clean.receivedAmount > clean.sanctionedAmount) throw invalid('Received amount cannot exceed the sanctioned amount.');
  const at = now();
  db.grants[i] = { ...db.grants[i], ...clean, updatedAt: at, history: [...db.grants[i].history, { at, by: actor.name, action: `Outcome set to ${clean.outcome}` }] };
}

// ---------- people ----------

const metric = (v: unknown) => (v === null || v === undefined || v === '' ? null : typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : NaN);
const PHOTO = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;

/** Checks and cleans a proposed profile. Google Scholar metrics keep their old stamp unless the numbers changed. */
function cleanBiodata(b: Biodata, prev: Biodata | undefined, by: string): Biodata {
  const inS = (b.scholar ?? {}) as Partial<Biodata['scholar']>;
  const m = { citations: metric(inS.citations), hIndex: metric(inS.hIndex), i10Index: metric(inS.i10Index) };
  if (Object.values(m).some((v) => Number.isNaN(v))) throw invalid('Google Scholar metrics must be whole numbers of 0 or more, or left blank.');
  // Two facts that always hold on Google Scholar; they catch values typed into the wrong box.
  if (m.hIndex != null && m.citations != null && m.hIndex * m.hIndex > m.citations) throw invalid('The h-index cannot be that high for this citation count. Copy the values exactly from the Google Scholar profile.');
  if (m.hIndex != null && m.i10Index != null && m.hIndex >= 10 && m.i10Index < m.hIndex) throw invalid('With an h-index of 10 or more, the i10-index is at least the h-index. Check the values on the Google Scholar profile.');
  const old = prev?.scholar ?? EMPTY_SCHOLAR;
  const changed = m.citations !== old.citations || m.hIndex !== old.hIndex || m.i10Index !== old.i10Index;
  const scholar = changed ? { ...m, updatedAt: now(), updatedBy: by } : old;
  const photo = str(b.photo, 400_000);
  if (photo && !PHOTO.test(photo)) throw invalid('The photograph must be a JPEG, PNG or WebP image.');
  const sdgs = [...new Set(Array.isArray(b.sdgs) ? b.sdgs.filter((n) => Number.isInteger(n) && n >= 1 && n <= 17) : [])].sort((x, y) => x - y);
  const scholarUrl = str(b.googleScholar, 300).trim();
  if (scholarUrl && !/^https:\/\/scholar\.google\.[a-z.]+\//.test(scholarUrl)) throw invalid('The Google Scholar link must start with https://scholar.google.');
  if (b.dob && str(b.dob, 10) > now().slice(0, 10)) throw invalid('Date of birth cannot be in the future.');
  const rows = <T,>(v: unknown, keys: (keyof T)[]) => list(v, 50, (x) => Object.fromEntries(keys.map((k) => [k, str(x[k as string], 300)])) as T);
  return {
    facultyId: b.facultyId, dob: str(b.dob, 10), gender: str(b.gender, 40), address: str(b.address, 500), summary: str(b.summary, 3000),
    researchInterests: str(b.researchInterests, 1000), googleScholar: scholarUrl, phdGuided: num(b.phdGuided), phdOngoing: num(b.phdOngoing),
    qualifications: rows(b.qualifications, ['degree', 'specialization', 'institution', 'year']),
    experience: rows(b.experience, ['organisation', 'designation', 'from', 'to']),
    awards: prev?.awards ?? [],
    memberships: rows(b.memberships, ['body', 'type', 'since']),
    expertise: str(b.expertise, 1000), keywords: str(b.keywords, 500), sdgs, photo, scholar,
    updatedAt: prev?.updatedAt ?? now(),
  };
}

const FIELD_LABEL: Record<string, string> = {
  dob: 'Date of birth', gender: 'Gender', address: 'Address', summary: 'Biography', researchInterests: 'Research interests', googleScholar: 'Google Scholar link',
  phdGuided: 'Ph.D. guided', phdOngoing: 'Ph.D. ongoing', qualifications: 'Qualifications', experience: 'Experience', memberships: 'Memberships',
  expertise: 'Areas of expertise', keywords: 'Keywords', sdgs: 'SDGs', photo: 'Photograph', scholar: 'Google Scholar metrics',
  email: 'Email', phone: 'Phone', orcid: 'ORCID', scopusId: 'Scopus ID',
};
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * A faculty member proposes changes to their own profile. Nothing on the live profile changes: the proposal waits
 * for the Office of Research. One open proposal per person; editing it again updates that proposal.
 */
export function proposeProfileChange(db: DB, actor: Actor, input: { biodata: Biodata; contact: Partial<Faculty> }, submit: boolean): string {
  if (actor.role !== 'faculty' || !actor.facultyId) throw forbid('Profiles are updated by the faculty member, and approved by the Office of Research.');
  const me = actor.facultyId;
  const f = db.faculty.find((x) => x.id === me);
  if (!f?.active) throw forbid('Your faculty profile is inactive.');
  db.profileChanges ??= [];
  const prev = db.biodata.find((x) => x.facultyId === me);
  const open = db.profileChanges.find((c) => c.facultyId === me && ['Draft', 'Submitted', 'Rework'].includes(c.status));
  const biodata = cleanBiodata({ ...(input.biodata ?? {}), facultyId: me } as Biodata, prev, actor.name);
  const c = input.contact ?? {};
  const contact = { email: str(c.email, 200).trim(), phone: str(c.phone, 20), orcid: str(c.orcid, 19).trim(), scopusId: str(c.scopusId, 20).trim() };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contact.email)) throw invalid('Enter a valid email address.');
  if (contact.orcid && !/^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/.test(contact.orcid)) throw invalid('ORCID must look like 0000-0002-1825-0097.');
  const base = prev ? normalizeBiodata(prev) : blankBiodata(me);
  const changed = [
    ...PROFILE_KEYS.filter((k) => !same(biodata[k], base[k])),
    ...(['email', 'phone', 'orcid', 'scopusId'] as const).filter((k) => contact[k] !== f[k]),
  ].map((k) => FIELD_LABEL[k]);
  if (!changed.length) throw invalid('Nothing has changed compared with your approved profile.');
  const at = now();
  const history = [...(open?.history ?? [])];
  history.push({ at, by: actor.name, action: open ? 'Edited' : 'Created' });
  if (submit) history.push({ at, by: actor.name, action: open?.status === 'Rework' ? 'Resubmitted' : 'Submitted' });
  let id = open?.id;
  if (!id) { db.seq += 1; id = `PRF${db.seq}`; }
  const next: ProfileChange = { id, facultyId: me, status: submit ? 'Submitted' : open?.status === 'Submitted' ? 'Submitted' : open?.status ?? 'Draft', createdAt: open?.createdAt ?? at, updatedAt: at, history, biodata, contact, changed };
  db.profileChanges = [next, ...db.profileChanges.filter((x) => x.id !== id)];
  return id;
}
const PROFILE_KEYS = ['dob', 'gender', 'address', 'summary', 'researchInterests', 'googleScholar', 'phdGuided', 'phdOngoing', 'qualifications', 'experience', 'memberships', 'expertise', 'keywords', 'sdgs', 'photo', 'scholar'] as const;

/** Office of Research decision on a proposed profile update. Only an approval touches the live profile. */
export function reviewProfileChange(db: DB, actor: Actor, id: string, decision: Decision, remark: string) {
  requireOffice(actor);
  if (!['Approved', 'Rework', 'Rejected'].includes(decision)) throw invalid('Unknown decision.');
  const i = (db.profileChanges ?? []).findIndex((c) => c.id === id);
  if (i < 0) throw notFound('Profile update');
  const c = db.profileChanges[i];
  if (c.status !== 'Submitted') throw invalid('Only submitted profile updates can be reviewed.');
  const note = str(remark, 1000).trim();
  if (decision !== 'Approved' && !note) throw invalid('Give a remark so the faculty member knows what to change.');
  const at = now();
  const action = decision === 'Approved' ? 'Approved' : decision === 'Rework' ? 'Returned for correction' : 'Rejected';
  db.profileChanges[i] = { ...c, status: decision, updatedAt: at, history: [...c.history, { at, by: actor.name, action, remark: note || undefined }] };
  if (decision !== 'Approved') return;
  const bi = db.biodata.findIndex((x) => x.facultyId === c.facultyId);
  const approved = { ...c.biodata, updatedAt: at };
  if (bi >= 0) db.biodata[bi] = approved; else db.biodata.push(approved);
  db.faculty = db.faculty.map((f) => (f.id === c.facultyId ? { ...f, ...c.contact } : f));
}

export const blankBiodata = (facultyId: string, at = now()): Biodata => ({
  facultyId, dob: '', gender: '', address: '', summary: '', researchInterests: '', googleScholar: '', phdGuided: 0, phdOngoing: 0, qualifications: [], experience: [], awards: [], memberships: [],
  expertise: '', keywords: '', sdgs: [], photo: '', scholar: { ...EMPTY_SCHOLAR }, updatedAt: at,
});

/** Fills in profile fields added after a biodata row was stored. */
export const normalizeBiodata = (b: Biodata): Biodata => ({ ...blankBiodata(b.facultyId, b.updatedAt), ...b, scholar: { ...EMPTY_SCHOLAR, ...(b.scholar ?? {}) }, sdgs: Array.isArray(b.sdgs) ? b.sdgs : [] });

/**
 * Official faculty details (name, designation, department, status). Office of Research only: faculty propose their
 * contact details through a profile update, and Top-Level Management has read-only access.
 */
export function saveFaculty(db: DB, actor: Actor, input: Faculty, isNew = false) {
  const f: Faculty = {
    id: str(input.id, 20).trim(), title: str(input.title, 10), name: str(input.name, 200).trim(), designation: str(input.designation, 100), department: str(input.department, 200),
    email: str(input.email, 200).trim(), phone: str(input.phone, 20), joiningDate: str(input.joiningDate, 10), orcid: str(input.orcid, 19), scopusId: str(input.scopusId, 20), active: input.active !== false,
  };
  requireOffice(actor);
  if (!/^[A-Za-z0-9-]{3,20}$/.test(f.id)) throw invalid('Employee code must be 3-20 letters or digits.');
  if (!f.name) throw invalid('Name is required.');
  if (!db.settings.departments.includes(f.department)) throw invalid('Choose one of the institution’s departments.');
  const exists = db.faculty.some((x) => x.id.toLowerCase() === f.id.toLowerCase());
  if (isNew) {
    if (exists) throw invalid(`Employee code ${f.id} already exists.`);
    db.faculty.push(f);
    db.biodata.push(blankBiodata(f.id));
  } else {
    if (!exists) throw notFound('Faculty member');
    db.faculty = db.faculty.map((x) => (x.id === f.id ? f : x));
  }
}

/** Used by the Office of Research approval: links a new faculty account to a profile, creating the profile if needed. */
export function ensureFacultyProfile(db: DB, p: { id: string; title: string; name: string; designation: string; department: string; email: string }) {
  const existing = db.faculty.find((x) => x.id.toLowerCase() === p.id.toLowerCase());
  if (existing) return existing.id;
  if (!/^[A-Za-z0-9-]{3,20}$/.test(p.id)) throw invalid('Employee code must be 3-20 letters or digits.');
  if (!db.settings.departments.includes(p.department)) throw invalid('Choose one of the institution’s departments.');
  db.faculty.push({ id: p.id, title: p.title || 'Dr.', name: p.name, designation: p.designation || 'Assistant Professor', department: p.department, email: p.email, phone: '', joiningDate: now().slice(0, 10), orcid: '', scopusId: '', active: true });
  db.biodata.push(blankBiodata(p.id));
  return p.id;
}

export function saveSettings(db: DB, actor: Actor, s: Settings) {
  requireOffice(actor); // institution settings and notices are not managed by Top-Level Management
  if (!str(s.institutionName).trim()) throw invalid('Institution name is required.');
  const departments = list(s.departments as unknown, 100, (x) => x as unknown).map((d) => str(d, 200).trim()).filter(Boolean);
  if (!departments.length) throw invalid('Keep at least one department.');
  const used = new Set(db.faculty.map((f) => f.department));
  for (const d of db.settings.departments) if (used.has(d) && !departments.includes(d)) throw invalid(`“${d}” still has faculty; move them first.`);
  const nums = <T extends object>(o: T, ref: T) => Object.fromEntries(Object.keys(ref).map((k) => [k, Math.max(0, num((o as Record<string, unknown>)?.[k]))])) as T;
  db.settings = {
    institutionName: str(s.institutionName, 200).trim(), institutionTagline: str(s.institutionTagline, 200), departments,
    academicYearStartMonth: Math.min(12, Math.max(1, Math.round(num(s.academicYearStartMonth)) || 6)), seedMoneyWindowOpen: s.seedMoneyWindowOpen === true,
    targets: nums(s.targets, db.settings.targets), weights: nums(s.weights, db.settings.weights),
  };
}

export function addNotice(db: DB, actor: Actor, title: string, body: string) {
  requireOffice(actor); // institution settings and notices are not managed by Top-Level Management
  if (!str(title).trim()) throw invalid('Title is required.');
  db.seq += 1;
  db.notices.unshift({ id: `N${db.seq}`, at: now(), title: str(title, 200).trim(), body: str(body, 2000).trim() } as Notice);
}
export function deleteNotice(db: DB, actor: Actor, id: string) {
  requireOffice(actor); // institution settings and notices are not managed by Top-Level Management
  db.notices = db.notices.filter((n) => n.id !== id);
}

/** Fills in fields added after an IP record was saved (older records used per-type stages and a separate country). */
export function normalizeIp(x: Partial<IntellectualProperty> & Pick<IntellectualProperty, 'stage' | 'office' | 'status'> & Record<string, unknown>): IntellectualProperty {
  const STAGE: Record<string, string> = { Applied: 'Filed', 'Under Examination': 'Published', Granted: 'Granted / Registered', Registered: 'Granted / Registered' };
  const country = typeof x.country === 'string' ? x.country : '';
  const { country: _c, registrationNumber: _r, ...rest } = x;
  return {
    ipTypeOther: '', description: '', grantDate: '', owner: 'University', ownerOther: '', funding: '', licensed: false, licensee: '', coOwners: '', agreementName: '', declared: x.status !== 'Draft',
    ...rest,
    stage: STAGE[x.stage] ?? x.stage,
    office: x.office && country && !x.office.includes(country) ? `${x.office}, ${country}` : x.office || country,
  } as IntellectualProperty;
}
