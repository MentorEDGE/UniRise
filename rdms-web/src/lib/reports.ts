import { academicYearOf, fmtDate, inr, isSanctioned } from './analytics';
import { creditedFaculty } from './domain';
import type { AnyRecord, Conference, DB, EntityKind, Faculty, Fdp, Grant, Honour, IntellectualProperty, Publication } from './types';
import { ipIsGranted, ipTypeLabel } from './types';

export interface Ctx { db: DB; byId: Map<string, Faculty> }
export interface ListCol { label: string; get: (r: AnyRecord, ctx: Ctx) => string | number; num?: boolean }
export interface Measure { label: string; get: (rows: AnyRecord[], key: string, ctx: Ctx) => number; money?: boolean }

export interface ReportDef {
  id: string;
  group: string;
  title: string;
  kind: EntityKind;
  /** Optional row filter specific to the report. */
  where?: (r: AnyRecord, ctx: Ctx) => boolean;
  /** list: one row per record. group: one row per key with measures. */
  mode: 'list' | 'group';
  columns?: ListCol[];
  groupLabel?: string;
  keys?: (r: AnyRecord, ctx: Ctx) => string[];
  measures?: Measure[];
}

const pub = (r: AnyRecord) => r as Publication;
const grant = (r: AnyRecord) => r as Grant;
const fdp = (r: AnyRecord) => r as Fdp;
const conf = (r: AnyRecord) => r as Conference;
const award = (r: AnyRecord) => r as Honour;
const ip = (r: AnyRecord) => r as IntellectualProperty;
const owner = (r: AnyRecord, c: Ctx) => c.byId.get(r.facultyId);
const credited = (kind: EntityKind) => (r: AnyRecord, c: Ctx) => creditedFaculty(kind, r).filter((id) => c.byId.has(id));
const facultyKey = (kind: EntityKind) => (r: AnyRecord, c: Ctx) => credited(kind)(r, c).map((id) => `${id} – ${c.byId.get(id)!.name}`);
const deptKey = (kind: EntityKind) => (r: AnyRecord, c: Ctx) => [...new Set(credited(kind)(r, c).map((id) => c.byId.get(id)!.department))];
const count: Measure = { label: 'Count', get: (rows) => rows.length };
const sum = (label: string, fn: (r: AnyRecord) => number, money = false): Measure => ({ label, get: (rows) => rows.reduce((a, r) => a + fn(r), 0), money });
const countWhere = (label: string, fn: (r: AnyRecord) => boolean): Measure => ({ label, get: (rows) => rows.filter(fn).length });
const ayKey = (date: (r: AnyRecord) => string) => (r: AnyRecord, c: Ctx) => [`AY ${academicYearOf(date(r), c.db.settings.academicYearStartMonth)}`];
const internalAuthors = (r: AnyRecord) => pub(r).authors.filter((a) => a.kind !== 'External').map((a) => a.name).join('; ');

const PUB_LIST: ListCol[] = [
  { label: 'Publication ID', get: (r) => r.id },
  { label: 'Entry Type', get: (r) => pub(r).entryType },
  { label: 'Title', get: (r) => pub(r).title },
  { label: 'Journal / Venue', get: (r) => pub(r).venue },
  { label: 'ISSN', get: (r) => pub(r).issn },
  { label: 'Month/Year', get: (r) => `${pub(r).month} ${pub(r).year}` },
  { label: 'Indexing', get: (r) => pub(r).indexing },
  { label: 'Quartile', get: (r) => pub(r).quartile },
  { label: 'Authors', get: (r) => pub(r).authors.map((a) => a.name).join('; ') },
  { label: 'Entered by', get: (r, c) => owner(r, c)?.name ?? '' },
  { label: 'Department', get: (r, c) => owner(r, c)?.department ?? '' },
  { label: 'DOI', get: (r) => pub(r).doi },
];
const GRANT_LIST: ListCol[] = [
  { label: 'Grant ID', get: (r) => r.id },
  { label: 'Type', get: (r) => grant(r).grantType },
  { label: 'Title', get: (r) => grant(r).title },
  { label: 'Agency', get: (r) => grant(r).agency },
  { label: 'Applied', get: (r) => fmtDate(grant(r).appliedDate) },
  { label: 'Applied (₹)', get: (r) => grant(r).appliedAmount, num: true },
  { label: 'Outcome', get: (r) => grant(r).outcome },
  { label: 'Sanctioned (₹)', get: (r) => grant(r).sanctionedAmount, num: true },
  { label: 'Received (₹)', get: (r) => grant(r).receivedAmount, num: true },
  { label: 'PI', get: (r) => grant(r).investigators.find((i) => i.role === 'PI')?.name ?? '' },
  { label: 'Department', get: (r, c) => owner(r, c)?.department ?? '' },
];
const FDP_LIST: ListCol[] = [
  { label: 'FDP ID', get: (r) => r.id },
  { label: 'Faculty', get: (r, c) => owner(r, c)?.name ?? '' },
  { label: 'Department', get: (r, c) => owner(r, c)?.department ?? '' },
  { label: 'Role', get: (r) => fdp(r).role },
  { label: 'Type', get: (r) => fdp(r).programmeType },
  { label: 'Title', get: (r) => fdp(r).title },
  { label: 'Organiser', get: (r) => fdp(r).organiser },
  { label: 'Mode', get: (r) => fdp(r).mode },
  { label: 'From', get: (r) => fmtDate(fdp(r).fromDate) },
  { label: 'To', get: (r) => fmtDate(fdp(r).toDate) },
  { label: 'Hours', get: (r) => fdp(r).hours, num: true },
];
const CONF_LIST: ListCol[] = [
  { label: 'Conference ID', get: (r) => r.id },
  { label: 'Faculty', get: (r, c) => owner(r, c)?.name ?? '' },
  { label: 'Department', get: (r, c) => owner(r, c)?.department ?? '' },
  { label: 'Participation', get: (r) => conf(r).participation },
  { label: 'Conference', get: (r) => conf(r).conferenceName },
  { label: 'Paper / Talk', get: (r) => conf(r).paperTitle },
  { label: 'Level', get: (r) => conf(r).level },
  { label: 'Venue', get: (r) => `${conf(r).venue}, ${conf(r).country}` },
  { label: 'From', get: (r) => fmtDate(conf(r).fromDate) },
  { label: 'Claimed (₹)', get: (r) => conf(r).amountClaimed, num: true },
];
const AWARD_LIST: ListCol[] = [
  { label: 'Award ID', get: (r) => r.id },
  { label: 'Faculty', get: (r, c) => owner(r, c)?.name ?? '' },
  { label: 'Department', get: (r, c) => owner(r, c)?.department ?? '' },
  { label: 'Category', get: (r) => award(r).category },
  { label: 'Honour / Award', get: (r) => award(r).title },
  { label: 'Conferred by', get: (r) => award(r).awardedBy },
  { label: 'Level', get: (r) => award(r).level },
  { label: 'Received', get: (r) => fmtDate(award(r).awardDate) },
  { label: 'Prize (₹)', get: (r) => award(r).prizeAmount, num: true },
];
const AWARD_MEASURES: Measure[] = [count, countWhere('International', (r) => award(r).level === 'International'), countWhere('National', (r) => award(r).level === 'National'),
  countWhere('State / Institutional', (r) => award(r).level === 'State' || award(r).level === 'Institutional'), sum('Prize (₹)', (r) => award(r).prizeAmount, true)];
const IP_LIST: ListCol[] = [
  { label: 'IP ID', get: (r) => r.id },
  { label: 'Type of IP', get: (r) => ipTypeLabel(ip(r)) },
  { label: 'Title', get: (r) => ip(r).title },
  { label: 'Status', get: (r) => ip(r).stage },
  { label: 'Application / Registration No.', get: (r) => ip(r).applicationNumber },
  { label: 'Filed', get: (r) => fmtDate(ip(r).filingDate) },
  { label: 'Granted / Registered', get: (r) => (ip(r).grantDate ? fmtDate(ip(r).grantDate) : '') },
  { label: 'Office / Country', get: (r) => ip(r).office },
  { label: 'Owner / Applicant', get: (r) => (ip(r).owner === 'Other' ? ip(r).ownerOther : ip(r).owner) },
  { label: 'Licensed to', get: (r) => (ip(r).licensed ? ip(r).licensee : '') },
  { label: 'Faculty', get: (r, c) => owner(r, c)?.name ?? '' },
  { label: 'Department', get: (r, c) => owner(r, c)?.department ?? '' },
  { label: 'Co-inventors / Co-creators', get: (r) => ip(r).coOwners },
];
const granted = (r: AnyRecord) => ipIsGranted(ip(r).stage);
const IP_MEASURES: Measure[] = [count, countWhere('Patents', (r) => ip(r).ipType === 'Patent'), countWhere('Patents granted', (r) => ip(r).ipType === 'Patent' && granted(r)),
  countWhere('Designs', (r) => ip(r).ipType === 'Design'), countWhere('Copyrights', (r) => ip(r).ipType === 'Copyright'), countWhere('Trademarks', (r) => ip(r).ipType === 'Trademark'),
  countWhere('Licensed', (r) => ip(r).licensed)];
const PUB_MEASURES: Measure[] = [count, countWhere('Journal', (r) => pub(r).entryType === 'Journal Article'), countWhere('Conf. paper', (r) => pub(r).entryType === 'Conference Paper'),
  countWhere('Book / chapter', (r) => pub(r).entryType === 'Book' || pub(r).entryType === 'Book Chapter'), countWhere('Q1', (r) => pub(r).quartile === 'Q1'), countWhere('Q2', (r) => pub(r).quartile === 'Q2'),
  countWhere('Scopus/WoS', (r) => /Scopus|Web of Science/.test(pub(r).indexing))];
const GRANT_MEASURES: Measure[] = [count, countWhere('Sanctioned', (r) => isSanctioned(grant(r))), sum('Applied (₹)', (r) => grant(r).appliedAmount, true),
  sum('Sanctioned (₹)', (r) => grant(r).sanctionedAmount, true), sum('Received (₹)', (r) => grant(r).receivedAmount, true)];
const FDP_MEASURES: Measure[] = [count, sum('Hours', (r) => fdp(r).hours), countWhere('Attended', (r) => fdp(r).role === 'Attended'), countWhere('Organised', (r) => fdp(r).role === 'Organised'), countWhere('Resource person', (r) => fdp(r).role === 'Resource Person')];
const CONF_MEASURES: Measure[] = [count, countWhere('Presented', (r) => conf(r).participation.includes('Presented')), countWhere('International', (r) => conf(r).level === 'International'), sum('Claimed (₹)', (r) => conf(r).amountClaimed, true)];

export const REPORTS: ReportDef[] = [
  // Publications
  { id: 'pub-dept', group: 'publications', title: 'Institute-Department wise', kind: 'publications', mode: 'list', columns: PUB_LIST },
  { id: 'pub-emp', group: 'publications', title: 'Employee ID wise', kind: 'publications', mode: 'list', columns: [{ label: 'Emp. Codes', get: (r, c) => credited('publications')(r, c).join('; ') }, ...PUB_LIST] },
  { id: 'pub-journal', group: 'publications', title: 'Journal wise', kind: 'publications', mode: 'group', groupLabel: 'Journal', where: (r) => pub(r).entryType === 'Journal Article', keys: (r) => [pub(r).venue], measures: [count, countWhere('Q1/Q2', (r) => ['Q1', 'Q2'].includes(pub(r).quartile)), countWhere('Open access', (r) => pub(r).openAccess)] },
  { id: 'pub-quartile', group: 'publications', title: 'Quartile wise', kind: 'publications', mode: 'group', groupLabel: 'Quartile', where: (r) => pub(r).entryType === 'Journal Article', keys: (r) => [pub(r).quartile === 'NA' ? 'Unranked' : pub(r).quartile], measures: [count] },
  { id: 'pub-index', group: 'publications', title: 'Indexing wise', kind: 'publications', mode: 'group', groupLabel: 'Indexing', keys: (r) => [pub(r).indexing], measures: PUB_MEASURES.slice(0, 4) },
  { id: 'pub-year', group: 'publications', title: 'Year wise', kind: 'publications', mode: 'group', groupLabel: 'Calendar year', keys: (r) => [String(pub(r).year)], measures: PUB_MEASURES },
  { id: 'pub-faculty-journal', group: 'publications', title: 'Faculty Authored – Journal wise', kind: 'publications', mode: 'list', where: (r) => pub(r).entryType === 'Journal Article' && !pub(r).authors.some((a) => a.kind === 'Student' || a.kind === 'Ex-Student'), columns: PUB_LIST },
  { id: 'pub-student-journal', group: 'publications', title: 'Student Authored – Journal wise', kind: 'publications', mode: 'list', where: (r) => pub(r).entryType === 'Journal Article' && pub(r).authors.some((a) => a.kind === 'Student' || a.kind === 'Ex-Student'), columns: [...PUB_LIST.slice(0, 4), { label: 'Student authors', get: (r) => pub(r).authors.filter((a) => a.kind.includes('Student')).map((a) => `${a.name} (${a.code})`).join('; ') }, ...PUB_LIST.slice(9)] },
  { id: 'pub-inter', group: 'publications', title: 'Journal Publication – Inter Institution wise', kind: 'publications', mode: 'list', where: (r) => pub(r).authors.some((a) => a.kind === 'External'), columns: [...PUB_LIST.slice(0, 4), { label: 'Internal authors', get: internalAuthors }, { label: 'External institutions', get: (r) => [...new Set(pub(r).authors.filter((a) => a.kind === 'External').map((a) => a.institution))].join('; ') }, ...PUB_LIST.slice(10)] },
  { id: 'pub-oa', group: 'publications', title: 'Open Access publications', kind: 'publications', mode: 'list', where: (r) => pub(r).openAccess, columns: PUB_LIST },
  { id: 'pub-dept-count', group: 'publications', title: 'Department wise Publication Count', kind: 'publications', mode: 'group', groupLabel: 'Department', keys: deptKey('publications'), measures: PUB_MEASURES },
  { id: 'pub-emp-count', group: 'publications', title: 'Employee Code wise Publication Count', kind: 'publications', mode: 'group', groupLabel: 'Faculty', keys: facultyKey('publications'), measures: PUB_MEASURES },
  // Grants
  { id: 'grt-type-applied', group: 'grants', title: 'Project Type wise (Applied Date wise)', kind: 'grants', mode: 'group', groupLabel: 'Project type', keys: (r) => [grant(r).grantType], measures: GRANT_MEASURES },
  { id: 'grt-dept', group: 'grants', title: 'Project – Institute-Department wise', kind: 'grants', mode: 'group', groupLabel: 'Department', keys: deptKey('grants'), measures: GRANT_MEASURES },
  { id: 'grt-agency', group: 'grants', title: 'Funding Agency wise', kind: 'grants', mode: 'group', groupLabel: 'Agency', keys: (r) => [grant(r).agency], measures: GRANT_MEASURES },
  { id: 'grt-source', group: 'grants', title: 'Grant Source wise', kind: 'grants', mode: 'group', groupLabel: 'Source', keys: (r) => [grant(r).source], measures: GRANT_MEASURES },
  { id: 'grt-year', group: 'grants', title: 'Year Wise Grant Received Amount Details', kind: 'grants', mode: 'group', groupLabel: 'Academic year', keys: ayKey((r) => grant(r).appliedDate), measures: GRANT_MEASURES },
  { id: 'grt-sanctioned', group: 'grants', title: 'Project Sanctioned Details', kind: 'grants', mode: 'list', where: (r) => isSanctioned(grant(r)), columns: [...GRANT_LIST.slice(0, 4), { label: 'Sanction date', get: (r) => fmtDate(grant(r).sanctionDate) }, ...GRANT_LIST.slice(7)] },
  { id: 'grt-all', group: 'grants', title: 'Project Details – All proposals', kind: 'grants', mode: 'list', columns: GRANT_LIST },
  { id: 'grt-emp', group: 'grants', title: 'Employee ID wise Project Details', kind: 'grants', mode: 'group', groupLabel: 'Investigator', keys: facultyKey('grants'), measures: GRANT_MEASURES },
  { id: 'grt-share', group: 'grants', title: 'Percentage Sharing Details', kind: 'grants', mode: 'list', where: (r) => isSanctioned(grant(r)), columns: [...GRANT_LIST.slice(0, 3), { label: 'Sanctioned (₹)', get: (r) => grant(r).sanctionedAmount, num: true }, { label: 'Investigator shares', get: (r) => grant(r).investigators.map((i) => `${i.name} ${i.role} ${i.sharePct}% (${inr((grant(r).sanctionedAmount * i.sharePct) / 100)})`).join('; ') }] },
  { id: 'grt-inst', group: 'grants', title: 'Institution wise Project Count', kind: 'grants', mode: 'group', groupLabel: 'Investigator institution', keys: (r) => [...new Set(grant(r).investigators.map((i) => i.institution || '—'))], measures: [count, countWhere('Sanctioned', (r) => isSanctioned(grant(r)))] },
  // FDPs
  { id: 'fdp-faculty', group: 'fdps', title: 'Faculty wise FDP Hours', kind: 'fdps', mode: 'group', groupLabel: 'Faculty', keys: facultyKey('fdps'), measures: FDP_MEASURES },
  { id: 'fdp-dept', group: 'fdps', title: 'Department wise FDP Summary', kind: 'fdps', mode: 'group', groupLabel: 'Department', keys: deptKey('fdps'), measures: FDP_MEASURES },
  { id: 'fdp-type', group: 'fdps', title: 'Programme Type wise', kind: 'fdps', mode: 'group', groupLabel: 'Programme type', keys: (r) => [fdp(r).programmeType], measures: FDP_MEASURES },
  { id: 'fdp-mode', group: 'fdps', title: 'Mode wise (Online / Offline / Hybrid)', kind: 'fdps', mode: 'group', groupLabel: 'Mode', keys: (r) => [fdp(r).mode], measures: FDP_MEASURES },
  { id: 'fdp-level', group: 'fdps', title: 'Level wise', kind: 'fdps', mode: 'group', groupLabel: 'Level', keys: (r) => [fdp(r).level], measures: FDP_MEASURES },
  { id: 'fdp-org', group: 'fdps', title: 'Organising Institution wise', kind: 'fdps', mode: 'group', groupLabel: 'Organiser', keys: (r) => [fdp(r).organiser], measures: FDP_MEASURES },
  { id: 'fdp-organised', group: 'fdps', title: 'Programmes Organised / Resource Person', kind: 'fdps', mode: 'list', where: (r) => fdp(r).role !== 'Attended', columns: FDP_LIST },
  { id: 'fdp-list', group: 'fdps', title: 'FDP Details – All', kind: 'fdps', mode: 'list', columns: FDP_LIST },
  // Conferences
  { id: 'cnf-faculty', group: 'conferences', title: 'Faculty wise Participation', kind: 'conferences', mode: 'group', groupLabel: 'Faculty', keys: facultyKey('conferences'), measures: CONF_MEASURES },
  { id: 'cnf-dept', group: 'conferences', title: 'Department wise Participation', kind: 'conferences', mode: 'group', groupLabel: 'Department', keys: deptKey('conferences'), measures: CONF_MEASURES },
  { id: 'cnf-type', group: 'conferences', title: 'Participation Type wise', kind: 'conferences', mode: 'group', groupLabel: 'Participation', keys: (r) => [conf(r).participation], measures: CONF_MEASURES },
  { id: 'cnf-level', group: 'conferences', title: 'National / International', kind: 'conferences', mode: 'group', groupLabel: 'Level', keys: (r) => [conf(r).level], measures: CONF_MEASURES },
  { id: 'cnf-country', group: 'conferences', title: 'Country wise', kind: 'conferences', mode: 'group', groupLabel: 'Country', keys: (r) => [conf(r).country], measures: CONF_MEASURES },
  { id: 'cnf-funding', group: 'conferences', title: 'Funding and Claims', kind: 'conferences', mode: 'group', groupLabel: 'Funding', keys: (r) => [conf(r).funding], measures: [count, sum('Registration fees (₹)', (r) => conf(r).registrationFee, true), sum('Claimed (₹)', (r) => conf(r).amountClaimed, true)] },
  { id: 'cnf-awards', group: 'conferences', title: 'Awards received', kind: 'conferences', mode: 'list', where: (r) => !!conf(r).award, columns: [...CONF_LIST.slice(0, 6), { label: 'Award', get: (r) => conf(r).award }] },
  { id: 'cnf-list', group: 'conferences', title: 'Conference Details – All', kind: 'conferences', mode: 'list', columns: CONF_LIST },
  // Honours & Awards
  { id: 'awd-faculty', group: 'awards', title: 'Faculty wise Honours & Awards', kind: 'awards', mode: 'group', groupLabel: 'Faculty', keys: facultyKey('awards'), measures: AWARD_MEASURES },
  { id: 'awd-dept', group: 'awards', title: 'Department wise Honours & Awards', kind: 'awards', mode: 'group', groupLabel: 'Department', keys: deptKey('awards'), measures: AWARD_MEASURES },
  { id: 'awd-level', group: 'awards', title: 'Level wise (International / National / State)', kind: 'awards', mode: 'group', groupLabel: 'Level', keys: (r) => [award(r).level], measures: AWARD_MEASURES },
  { id: 'awd-category', group: 'awards', title: 'Category wise', kind: 'awards', mode: 'group', groupLabel: 'Category', keys: (r) => [award(r).category], measures: AWARD_MEASURES },
  { id: 'awd-body', group: 'awards', title: 'Conferring Body wise', kind: 'awards', mode: 'group', groupLabel: 'Conferred by', keys: (r) => [award(r).awardedBy], measures: AWARD_MEASURES },
  { id: 'awd-year', group: 'awards', title: 'Year wise', kind: 'awards', mode: 'group', groupLabel: 'Academic year', keys: ayKey((r) => award(r).awardDate), measures: AWARD_MEASURES },
  { id: 'awd-international', group: 'awards', title: 'International Recognition', kind: 'awards', mode: 'list', where: (r) => award(r).level === 'International', columns: AWARD_LIST },
  { id: 'awd-list', group: 'awards', title: 'Honours & Awards Details – All', kind: 'awards', mode: 'list', columns: AWARD_LIST },
  // Intellectual Property
  { id: 'ipr-faculty', group: 'ipr', title: 'Faculty wise Intellectual Property', kind: 'ipr', mode: 'group', groupLabel: 'Faculty', keys: facultyKey('ipr'), measures: IP_MEASURES },
  { id: 'ipr-dept', group: 'ipr', title: 'Department wise Intellectual Property', kind: 'ipr', mode: 'group', groupLabel: 'Department', keys: deptKey('ipr'), measures: IP_MEASURES },
  { id: 'ipr-type', group: 'ipr', title: 'Type and status wise', kind: 'ipr', mode: 'group', groupLabel: 'Type: status', keys: (r) => [`${ipTypeLabel(ip(r))}: ${ip(r).stage}`], measures: [count] },
  { id: 'ipr-owner', group: 'ipr', title: 'Owner / applicant wise', kind: 'ipr', mode: 'group', groupLabel: 'Owner / applicant', keys: (r) => [ip(r).owner === 'Other' ? ip(r).ownerOther || 'Other' : ip(r).owner], measures: IP_MEASURES },
  { id: 'ipr-licensed', group: 'ipr', title: 'Licensed or commercialised', kind: 'ipr', mode: 'list', where: (r) => ip(r).licensed, columns: IP_LIST },
  { id: 'ipr-year', group: 'ipr', title: 'Year wise (by filing date)', kind: 'ipr', mode: 'group', groupLabel: 'Academic year', keys: ayKey((r) => ip(r).filingDate), measures: IP_MEASURES },
  { id: 'ipr-granted', group: 'ipr', title: 'Patents Granted', kind: 'ipr', mode: 'list', where: (r) => ip(r).ipType === 'Patent' && granted(r), columns: IP_LIST },
  { id: 'ipr-list', group: 'ipr', title: 'Intellectual Property Details – All', kind: 'ipr', mode: 'list', columns: IP_LIST },
];

export interface ReportResult { header: string[]; rows: (string | number)[][]; numeric: boolean[]; money: boolean[]; total?: (string | number)[] }

export function runReport(def: ReportDef, records: AnyRecord[], ctx: Ctx): ReportResult {
  const rows = def.where ? records.filter((r) => def.where!(r, ctx)) : records;
  if (def.mode === 'list') {
    const cols = def.columns!;
    return { header: cols.map((c) => c.label), rows: rows.map((r) => cols.map((c) => c.get(r, ctx))), numeric: cols.map((c) => !!c.num), money: cols.map(() => false) };
  }
  const groups = new Map<string, AnyRecord[]>();
  for (const r of rows) for (const k of def.keys!(r, ctx)) groups.set(k, [...(groups.get(k) ?? []), r]);
  const ms = def.measures!;
  const out = [...groups.entries()].map(([k, rs]) => [k, ...ms.map((m) => m.get(rs, k, ctx))]).sort((a, b) => (b[1] as number) - (a[1] as number) || String(a[0]).localeCompare(String(b[0])));
  // Totals use the unique record set, so a co-authored paper is counted once.
  const total = ['Total (unique)', ...ms.map((m) => m.get(rows, '', ctx))];
  return { header: [def.groupLabel ?? 'Group', ...ms.map((m) => m.label)], rows: out, numeric: [false, ...ms.map(() => true)], money: [false, ...ms.map((m) => !!m.money)], total };
}
