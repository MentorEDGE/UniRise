/**
 * Business and access rules for ONE institution's data. Pure functions: they take the institution's DB and the
 * signed-in actor, check permissions, and mutate the DB (or throw). The server is the only caller; it loads the
 * actor's own institution database, so nothing here can reach another institution.
 */
import type {
  AnyRecord, Author, Biodata, DB, EntityKind, Faculty, Grant, Investigator, Notice, Publication, Settings, Status,
} from './types';
import { AUTHOR_KINDS, PUB_TYPES } from './types';

export interface Actor { userId: string; name: string; role: 'management' | 'faculty'; facultyId?: string }

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
 * Faculty see records they are credited on (any state) and other people's APPROVED publications (the RMS
 * Publication View). FDPs, conferences, grants, seed money and biodata of other faculty are private.
 * Management sees everything in its own institution.
 */
export function canView(actor: Actor, kind: EntityKind, r: AnyRecord) {
  if (actor.role === 'management') return true;
  if (creditedFaculty(kind, r).includes(actor.facultyId!)) return true;
  return kind === 'publications' && r.status === 'Approved';
}

const KINDS: EntityKind[] = ['publications', 'grants', 'seedMoney', 'fdps', 'conferences'];

/** The slice of the institution's data this actor may receive. */
export function scopeFor(db: DB, actor: Actor): DB {
  if (actor.role === 'management') return db;
  const me = actor.facultyId!;
  const out: DB = {
    ...db,
    // Directory entries of colleagues carry only what the RMS shows publicly (name, department, research IDs).
    faculty: db.faculty.map((f) => (f.id === me ? f : { ...f, phone: '', joiningDate: '' })),
    biodata: db.biodata.filter((b) => b.facultyId === me),
    publications: [], grants: [], seedMoney: [], fdps: [], conferences: [],
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
    else if (t === 'authors') out[k] = list(v, 100, (a): Author => ({ kind: kindOf(a.kind), code: str(a.code, 40), name: str(a.name, 200), institution: str(a.institution, 300), department: str(a.department, 300), email: str(a.email, 200) }));
    else out[k] = list(v, 30, (a): Investigator => ({ kind: kindOf(a.kind), code: str(a.code, 40), name: str(a.name, 200), role: (['PI', 'Co-PI', 'Co-I'].includes(a.role as string) ? a.role : 'Co-I') as Investigator['role'], institution: str(a.institution, 300), department: str(a.department, 300), sharePct: num(a.sharePct) }));
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
}

// ---------- workflow records ----------

const PREFIX: Record<EntityKind, string> = { publications: 'PUB', grants: 'GRT', seedMoney: 'SM', fdps: 'FDP', conferences: 'CNF' };

function requireFaculty(actor: Actor, db: DB) {
  if (actor.role !== 'faculty' || !actor.facultyId) throw forbid('Entries are made by faculty members.');
  if (!db.faculty.find((f) => f.id === actor.facultyId)?.active) throw forbid('Your faculty profile is inactive.');
}
function requireManagement(actor: Actor) {
  if (actor.role !== 'management') throw forbid('Only Top-Level Management can do this.');
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

export function review(db: DB, actor: Actor, kind: EntityKind, id: string, decision: Decision, remark: string, sanctionedAmount?: number) {
  requireManagement(actor);
  if (!['Approved', 'Rework', 'Rejected'].includes(decision)) throw invalid('Unknown decision.');
  const list = db[kind] as AnyRecord[];
  const i = list.findIndex((x) => x.id === id);
  if (i < 0) throw notFound();
  if (list[i].status !== 'Submitted') throw invalid('Only submitted entries can be reviewed.');
  const note = str(remark, 1000).trim();
  if (decision !== 'Approved' && !note) throw invalid('Give a remark so the faculty member knows what to change.');
  const at = now();
  const action = decision === 'Approved' ? 'Approved' : decision === 'Rework' ? 'Sent for rework' : 'Rejected';
  const updated = { ...list[i], status: decision, updatedAt: at, history: [...list[i].history, { at, by: actor.name, action, remark: note || undefined }] } as AnyRecord;
  if (kind === 'seedMoney' && decision === 'Approved' && sanctionedAmount != null) {
    if (num(sanctionedAmount) < 0) throw invalid('Sanctioned amount cannot be negative.');
    (updated as unknown as { sanctionedAmount: number }).sanctionedAmount = num(sanctionedAmount);
  }
  list[i] = updated;
}

export function updateGrantOutcome(db: DB, actor: Actor, id: string, patch: Pick<Grant, 'outcome' | 'sanctionDate' | 'sanctionedAmount' | 'receivedAmount'>) {
  requireManagement(actor);
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

export function saveBiodata(db: DB, actor: Actor, b: Biodata) {
  if (actor.role === 'faculty' && actor.facultyId !== b.facultyId) throw forbid('You can only edit your own biodata.');
  if (!db.faculty.some((f) => f.id === b.facultyId)) throw notFound('Faculty member');
  const rows = <T,>(v: unknown, keys: (keyof T)[]) => list(v, 50, (x) => Object.fromEntries(keys.map((k) => [k, str(x[k as string], 300)])) as T);
  const clean: Biodata = {
    facultyId: b.facultyId, dob: str(b.dob, 10), gender: str(b.gender, 40), address: str(b.address, 500), summary: str(b.summary, 3000),
    researchInterests: str(b.researchInterests, 1000), googleScholar: str(b.googleScholar, 300), phdGuided: num(b.phdGuided), phdOngoing: num(b.phdOngoing),
    qualifications: rows(b.qualifications, ['degree', 'specialization', 'institution', 'year']),
    experience: rows(b.experience, ['organisation', 'designation', 'from', 'to']),
    awards: rows(b.awards, ['title', 'by', 'year']),
    memberships: rows(b.memberships, ['body', 'type', 'since']),
    updatedAt: now(),
  };
  const i = db.biodata.findIndex((x) => x.facultyId === b.facultyId);
  if (i >= 0) db.biodata[i] = clean; else db.biodata.push(clean);
}

const blankBiodata = (facultyId: string): Biodata => ({ facultyId, dob: '', gender: '', address: '', summary: '', researchInterests: '', googleScholar: '', phdGuided: 0, phdOngoing: 0, qualifications: [], experience: [], awards: [], memberships: [], updatedAt: now() });

/** Faculty may update their own contact and research IDs; management edits everything inside its institution. */
export function saveFaculty(db: DB, actor: Actor, input: Faculty, isNew = false) {
  const f: Faculty = {
    id: str(input.id, 20).trim(), title: str(input.title, 10), name: str(input.name, 200).trim(), designation: str(input.designation, 100), department: str(input.department, 200),
    email: str(input.email, 200).trim(), phone: str(input.phone, 20), joiningDate: str(input.joiningDate, 10), orcid: str(input.orcid, 19), scopusId: str(input.scopusId, 20), active: input.active !== false,
  };
  if (actor.role === 'faculty') {
    if (isNew || actor.facultyId !== f.id) throw forbid('You can only update your own profile.');
    const cur = db.faculty.find((x) => x.id === f.id)!;
    db.faculty = db.faculty.map((x) => (x.id === f.id ? { ...cur, phone: f.phone, email: f.email, orcid: f.orcid, scopusId: f.scopusId } : x));
    return;
  }
  requireManagement(actor);
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

/** Used by IT Admin approval: links a new faculty account to a profile, creating the profile if needed. */
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
  requireManagement(actor);
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
  requireManagement(actor);
  if (!str(title).trim()) throw invalid('Title is required.');
  db.seq += 1;
  db.notices.unshift({ id: `N${db.seq}`, at: now(), title: str(title, 200).trim(), body: str(body, 2000).trim() } as Notice);
}
export function deleteNotice(db: DB, actor: Actor, id: string) {
  requireManagement(actor);
  db.notices = db.notices.filter((n) => n.id !== id);
}
