import type { ReactNode } from 'react';
import type { Column } from '../components/ui';
import { StatusBadge } from '../components/ui';
import { dateOf, fmtDate, inr } from './analytics';
import type { AnyRecord, Conference, DB, EntityKind, Fdp, Grant, Honour, IntellectualProperty, Publication, SeedMoney } from './types';
import { AWARD_CATEGORIES, IP_TYPES, ipTypeLabel, statusLabel } from './types';

export interface EntityConfig {
  kind: EntityKind;
  label: string;
  plural: string;
  entryPath: string;
  viewPath: string;
  typeOf: (r: AnyRecord) => string; // the "Entry Type" column / filter
  typeOptions: string[];
  title: (r: AnyRecord) => string;
  columns: Column<AnyRecord>[]; // kind-specific columns shown between title and status
  details: (r: AnyRecord) => [string, ReactNode][];
}

const people = (list: { name: string; kind: string; role?: string; institution: string; sharePct?: number }[]) => (
  <ol style={{ margin: 0, paddingLeft: 16 }}>
    {list.map((a, i) => <li key={i}>{a.name} <span className="muted">({a.kind}{a.role ? `, ${a.role}` : ''}{a.sharePct != null ? `, ${a.sharePct}%` : ''}) – {a.institution || '—'}</span></li>)}
  </ol>
);
const yn = (b: boolean) => (b ? 'Yes' : 'No');
const file = (n: string) => (n ? `📎 ${n}` : <span className="muted">Not attached</span>);

export const ENTITIES: Record<EntityKind, EntityConfig> = {
  publications: {
    kind: 'publications', label: 'Publication', plural: 'Publications', entryPath: '/publications/entry', viewPath: '/publications',
    typeOf: (r) => (r as Publication).entryType,
    typeOptions: ['Journal Article', 'Book', 'Book Chapter', 'Conference Paper', 'Technical Report'],
    title: (r) => (r as Publication).title,
    columns: [
      { key: 'category', label: 'Category', value: (r) => (r as Publication).category },
      { key: 'venue', label: 'Journal / Venue', value: (r) => (r as Publication).venue },
      { key: 'quartile', label: 'Quartile', value: (r) => (r as Publication).quartile },
      { key: 'year', label: 'Year', value: (r) => (r as Publication).year, num: true },
    ],
    details: (r) => {
      const p = r as Publication;
      return [
        ['Entry Type', p.entryType], ['Category', p.category], ['Title', p.title], ['DOI / Webpage', p.doi ? <a href={p.doi} target="_blank" rel="noreferrer">{p.doi}</a> : '—'],
        ['Journal / Venue', p.venue], ['ISSN / ISBN', p.issn || '—'], ['Published', `${p.month} ${p.year}`], ['Indexing', p.indexing],
        ['Quartile', p.quartile], ['Impact Factor', p.impactFactor || '—'], ['Open Access', yn(p.openAccess)], ['ERF Related', yn(p.erfRelated)],
        ['Project Reference', p.projectReference || 'No'], ['Authors', people(p.authors)], ['Full text', file(p.pdfName)],
      ];
    },
  },
  grants: {
    kind: 'grants', label: 'Grant', plural: 'Grants', entryPath: '/grants/entry', viewPath: '/grants',
    typeOf: (r) => (r as Grant).grantType,
    typeOptions: ['Research Project', 'Consultancy', 'Infrastructure', 'Fellowship', 'Industry Sponsored'],
    title: (r) => (r as Grant).title,
    columns: [
      { key: 'agency', label: 'Agency', value: (r) => (r as Grant).agency },
      { key: 'applied', label: 'Applied', value: (r) => (r as Grant).appliedAmount, render: (r) => inr((r as Grant).appliedAmount), num: true },
      { key: 'outcome', label: 'Outcome', value: (r) => (r as Grant).outcome },
      { key: 'sanctioned', label: 'Sanctioned', value: (r) => (r as Grant).sanctionedAmount, render: (r) => ((r as Grant).sanctionedAmount ? inr((r as Grant).sanctionedAmount) : '—'), num: true },
    ],
    details: (r) => {
      const g = r as Grant;
      return [
        ['Grant Unit', g.unit], ['Grant Type', g.grantType], ['UTN', g.utn || '—'], ['Title', g.title], ['Description', g.description || '—'],
        ['Grant Call', `${g.callTitle || '—'} (${g.callSource || 'source not given'})`], ['Grant Source', g.source], ['Agency', g.agency],
        ['Agency Comment', g.agencyComment || '—'], ['Applied Date', fmtDate(g.appliedDate)], ['Applied Amount', inr(g.appliedAmount)],
        ['Duration', `${g.durationMonths} months`], ['ERF Related', yn(g.erfRelated)], ['Matching grant for capital items', yn(g.matchingGrant)],
        ['Contact Number', g.contactNumber || '—'], ['Outcome', g.outcome], ['Sanction Date', fmtDate(g.sanctionDate) || '—'],
        ['Sanctioned Amount', g.sanctionedAmount ? inr(g.sanctionedAmount) : '—'], ['Received Amount', g.receivedAmount ? inr(g.receivedAmount) : '—'],
        ['Investigators', people(g.investigators)], ['Enclosures', g.enclosures.length ? g.enclosures.join(', ') : '—'], ['Other remarks', g.otherRemarks || '—'],
      ];
    },
  },
  seedMoney: {
    kind: 'seedMoney', label: 'Seed Money', plural: 'Seed Money Proposals', entryPath: '/seed-money/entry', viewPath: '/seed-money',
    typeOf: (r) => (r as SeedMoney).category, typeOptions: ['Faculty', 'Student'],
    title: (r) => (r as SeedMoney).title,
    columns: [
      { key: 'applied', label: 'Applied Date', value: (r) => (r as SeedMoney).appliedDate, render: (r) => fmtDate((r as SeedMoney).appliedDate) },
      { key: 'requested', label: 'Requested', value: (r) => (r as SeedMoney).requestedAmount, render: (r) => inr((r as SeedMoney).requestedAmount), num: true },
      { key: 'sanctioned', label: 'Sanctioned', value: (r) => (r as SeedMoney).sanctionedAmount, render: (r) => ((r as SeedMoney).sanctionedAmount ? inr((r as SeedMoney).sanctionedAmount) : '—'), num: true },
    ],
    details: (r) => {
      const s = r as SeedMoney;
      return [['Category Applied', s.category], ['Applied Date', fmtDate(s.appliedDate)], ['Title of the Project', s.title], ['Abstract', s.abstract || '—'],
        ['Requested Amount', inr(s.requestedAmount)], ['Sanctioned Amount', s.sanctionedAmount ? inr(s.sanctionedAmount) : '—'], ['Investigators', people(s.investigators)]];
    },
  },
  fdps: {
    kind: 'fdps', label: 'FDP', plural: 'FDPs', entryPath: '/fdp/entry', viewPath: '/fdp',
    typeOf: (r) => (r as Fdp).programmeType,
    typeOptions: ['FDP', 'Workshop', 'STTP', 'Refresher Course', 'Orientation Programme', 'Online Course (MOOC)'],
    title: (r) => (r as Fdp).title,
    columns: [
      { key: 'role', label: 'Role', value: (r) => (r as Fdp).role },
      { key: 'organiser', label: 'Organiser', value: (r) => (r as Fdp).organiser },
      { key: 'mode', label: 'Mode', value: (r) => (r as Fdp).mode },
      { key: 'from', label: 'From', value: (r) => (r as Fdp).fromDate, render: (r) => fmtDate((r as Fdp).fromDate) },
      { key: 'hours', label: 'Hours', value: (r) => (r as Fdp).hours, num: true },
    ],
    details: (r) => {
      const f = r as Fdp;
      return [['Role', f.role], ['Programme Type', f.programmeType], ['Title', f.title], ['Organised by', f.organiser], ['Sponsored by', f.sponsoredBy || '—'],
        ['Mode', f.mode], ['Level', f.level], ['Dates', `${fmtDate(f.fromDate)} to ${fmtDate(f.toDate)}`], ['Duration', `${f.hours} hours`],
        ['Outcome / Learning applied', f.outcome || '—'], ['Certificate', file(f.certificateName)]];
    },
  },
  conferences: {
    kind: 'conferences', label: 'Conference', plural: 'Conferences', entryPath: '/conferences/entry', viewPath: '/conferences',
    typeOf: (r) => (r as Conference).participation,
    typeOptions: ['Paper Presented', 'Poster Presented', 'Invited Talk / Keynote', 'Session Chair', 'Attended', 'Organised'],
    title: (r) => (r as Conference).conferenceName,
    columns: [
      { key: 'level', label: 'Level', value: (r) => (r as Conference).level },
      { key: 'venue', label: 'Venue', value: (r) => (r as Conference).venue },
      { key: 'from', label: 'From', value: (r) => (r as Conference).fromDate, render: (r) => fmtDate((r as Conference).fromDate) },
      { key: 'funding', label: 'Funding', value: (r) => (r as Conference).funding },
    ],
    details: (r) => {
      const c = r as Conference;
      return [['Participation', c.participation], ['Conference', c.conferenceName], ['Paper / Talk Title', c.paperTitle || '—'], ['Organiser', c.organiser],
        ['Venue', `${c.venue}, ${c.country}`], ['Level', c.level], ['Mode', c.mode], ['Dates', `${fmtDate(c.fromDate)} to ${fmtDate(c.toDate)}`],
        ['Proceedings indexed', c.proceedingsIndexed], ['Funding', c.funding], ['Registration Fee', inr(c.registrationFee)],
        ['Amount Claimed', c.amountClaimed ? inr(c.amountClaimed) : '—'], ['Award', c.award || '—'], ['Certificate', file(c.certificateName)]];
    },
  },
  awards: {
    kind: 'awards', label: 'Honour / Award', plural: 'Honours & Awards', entryPath: '/awards/entry', viewPath: '/awards',
    typeOf: (r) => (r as Honour).category, typeOptions: AWARD_CATEGORIES,
    title: (r) => (r as Honour).title,
    columns: [
      { key: 'by', label: 'Conferred by', value: (r) => (r as Honour).awardedBy },
      { key: 'level', label: 'Level', value: (r) => (r as Honour).level },
      { key: 'date', label: 'Received', value: (r) => (r as Honour).awardDate, render: (r) => fmtDate((r as Honour).awardDate) },
    ],
    details: (r) => {
      const a = r as Honour;
      return [['Category', a.category], ['Honour / Award', a.title], ['Conferred by', a.awardedBy], ['Level', a.level], ['Date received', fmtDate(a.awardDate)],
        ['Citation', a.citation || '—'], ['Prize / Honorarium', a.prizeAmount ? inr(a.prizeAmount) : '—'], ['Certificate', file(a.certificateName)]];
    },
  },
  ipr: {
    kind: 'ipr', label: 'Intellectual Property', plural: 'Intellectual Property', entryPath: '/ipr/entry', viewPath: '/ipr',
    typeOf: (r) => (r as IntellectualProperty).ipType, typeOptions: IP_TYPES,
    title: (r) => (r as IntellectualProperty).title,
    columns: [
      { key: 'stage', label: 'IP Status', value: (r) => (r as IntellectualProperty).stage },
      { key: 'appno', label: 'Application / Reg. No.', value: (r) => (r as IntellectualProperty).applicationNumber },
      { key: 'date', label: 'Filed', value: (r) => (r as IntellectualProperty).filingDate, render: (r) => fmtDate((r as IntellectualProperty).filingDate) },
    ],
    details: (r) => {
      const x = r as IntellectualProperty;
      return [['Type of IP', ipTypeLabel(x)], ['Title', x.title], ['Brief description', x.description || '—'], ['Status', x.stage],
        ['Application / registration number', x.applicationNumber], ['Filing date', fmtDate(x.filingDate)], ['Grant / registration date', x.grantDate ? fmtDate(x.grantDate) : '—'],
        ['Office / country', x.office], ['Registered owner / applicant', x.owner === 'Other' ? x.ownerOther || 'Other' : x.owner], ['Funding source / sponsor', x.funding || '—'],
        ['Licensed or commercialised?', x.licensed ? `Yes — ${x.licensee}` : 'No'], ['Co-inventors / co-creators', x.coOwners || '—'],
        ['Filing receipt / registration certificate', file(x.documentName)], ['Funding or ownership agreement', x.agreementName ? file(x.agreementName) : '—'],
        ['Declaration', x.declared ? 'Confirmed: the information is accurate and all co-inventors / co-creators are listed.' : 'Not confirmed']];
    },
  },
};

/** Common leading/trailing columns for every list. */
export function listColumns(db: DB, kind: EntityKind, opts: { showOwner: boolean }): Column<AnyRecord>[] {
  const cfg = ENTITIES[kind];
  const byId = new Map(db.faculty.map((f) => [f.id, f]));
  return [
    { key: 'id', label: 'ID', value: (r) => r.id, className: 'nowrap' },
    { key: 'type', label: kind === 'conferences' ? 'Participation' : kind === 'seedMoney' || kind === 'awards' ? 'Category' : kind === 'ipr' ? 'Type of IP' : 'Type', value: (r) => cfg.typeOf(r) },
    { key: 'title', label: kind === 'conferences' ? 'Conference' : kind === 'awards' ? 'Honour / Award' : 'Title', value: (r) => cfg.title(r), className: 'title-cell' },
    ...(opts.showOwner ? [
      { key: 'owner', label: 'Faculty', value: (r: AnyRecord) => byId.get(r.facultyId)?.name ?? r.facultyId, className: 'nowrap' },
      { key: 'dept', label: 'Department', value: (r: AnyRecord) => byId.get(r.facultyId)?.department ?? '' },
    ] : []),
    ...cfg.columns,
    { key: 'status', label: 'Status', value: (r) => statusLabel(r), render: (r) => <StatusBadge status={r.status} history={r.history} /> },
  ];
}

export const recordDate = dateOf;
