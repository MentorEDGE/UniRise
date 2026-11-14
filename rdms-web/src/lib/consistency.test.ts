/**
 * The sample data must be internally consistent, and every figure management sees must come from approved records
 * only. These checks run on the full demo dataset, so a change to the seed or to a calculation that breaks either
 * rule fails here.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { academicYears, academicYearRange, approvedIn, dateOf, facultyStats, isSanctioned, KINDS, trend, uniqueCounts } from './analytics';
import * as rules from './domain';
import type { Actor } from './domain';
import { createSeed } from './seed';
import type { AnyRecord, DB, EntityKind, Grant, Publication, SeedMoney, Status } from './types';
import { DECISION_ACTIONS } from './types';

const mgmt: Actor = { userId: 'm', name: 'Dean', role: 'management' };
const office: Actor = { userId: 'o', name: 'Office of Research', role: 'office' };
const ALL = { from: '', to: '', department: '' };
const TODAY = '2026-11-10';
let db: DB;
const records = (d: DB) => KINDS.flatMap((k) => (d[k] as AnyRecord[]).map((r) => ({ k, r })));

beforeAll(() => { db = createSeed(); });

describe('sample data: the workflow history agrees with each status', () => {
  it('every record has a known status, a history in time order, and nothing dated after today', () => {
    for (const { r } of records(db)) {
      expect(['Draft', 'Submitted', 'UnderReview', 'Approved', 'Rework', 'Rejected']).toContain(r.status);
      const times = r.history.map((h) => h.at);
      expect([...times].sort()).toEqual(times);
      expect(times[times.length - 1].slice(0, 10) <= TODAY).toBe(true);
      expect(r.updatedAt).toBe(times[times.length - 1]);
    }
  });
  it('the last workflow step matches the status', () => {
    const lastStep: Record<Status, string[]> = { Draft: ['Created', 'Edited'], Submitted: ['Submitted', 'Resubmitted'], UnderReview: ['Review started'], Rework: ['Returned for correction'], Approved: ['Approved'], Rejected: ['Rejected'] };
    for (const { r } of records(db)) {
      const steps = r.history.filter((h) => h.action !== 'Edited' || r.status === 'Draft');
      expect(lastStep[r.status]).toContain(steps[steps.length - 1].action);
      // Changes requested and rejections always tell the faculty member why.
      for (const h of r.history) if (h.action === 'Returned for correction' || h.action === 'Rejected') expect(h.remark).toBeTruthy();
      // Every decision is preceded by the review being started.
      r.history.forEach((h, i) => { if (DECISION_ACTIONS.includes(h.action)) expect(r.history[i - 1].action).toBe('Review started'); });
    }
  });
  it('covers every stage of the workflow, including resubmissions', () => {
    const statuses = new Set(records(db).map(({ r }) => r.status));
    for (const s of ['Draft', 'Submitted', 'UnderReview', 'Rework', 'Approved', 'Rejected'] as Status[]) expect(statuses.has(s)).toBe(true);
    expect(records(db).some(({ r }) => r.status === 'Submitted' && r.history.some((h) => h.action === 'Resubmitted'))).toBe(true);
    expect(records(db).some(({ r }) => r.status === 'Approved' && r.history.some((h) => h.action === 'Returned for correction'))).toBe(true);
  });
});

describe('sample data: the figures in each record add up', () => {
  it('grants: an outcome only once approved; received ≤ sanctioned ≤ applied; one PI; shares add up to 100%', () => {
    for (const g of db.grants) {
      if (g.status !== 'Approved') expect([g.outcome, g.sanctionedAmount, g.receivedAmount, g.sanctionDate]).toEqual(['Applied', 0, 0, '']);
      expect(g.receivedAmount).toBeLessThanOrEqual(g.sanctionedAmount);
      expect(g.sanctionedAmount).toBeLessThanOrEqual(g.appliedAmount);
      expect(isSanctioned(g)).toBe(g.sanctionedAmount > 0);
      if (g.sanctionDate) expect(g.sanctionDate >= g.appliedDate).toBe(true);
      expect(g.investigators.filter((i) => i.role === 'PI')).toHaveLength(1);
      expect(g.investigators.reduce((a, i) => a + i.sharePct, 0)).toBe(100);
    }
  });
  it('seed money: sanctioned only when approved, never more than requested', () => {
    for (const s of db.seedMoney as SeedMoney[]) {
      if (s.status !== 'Approved') expect(s.sanctionedAmount).toBe(0);
      expect(s.sanctionedAmount).toBeLessThanOrEqual(s.requestedAmount);
    }
  });
  it('FDPs and conferences end on or after they start; FDP hours are 6 per day', () => {
    for (const x of db.fdps) { expect(x.toDate >= x.fromDate).toBe(true); expect(x.hours).toBe(((Date.parse(x.toDate) - Date.parse(x.fromDate)) / 864e5 + 1) * 6); }
    for (const x of db.conferences) expect(x.toDate >= x.fromDate).toBe(true);
  });
  it('profiles: Ph.D. guided and ongoing equal the scholars listed under supervision', () => {
    for (const b of db.biodata) {
      expect(b.supervision.filter((x) => x.degree === 'PhD' && x.status === 'Completed')).toHaveLength(b.phdGuided);
      expect(b.supervision.filter((x) => x.degree === 'PhD' && x.status === 'Current')).toHaveLength(b.phdOngoing);
    }
  });
  it('profile highlights point at the faculty member\'s own approved records', () => {
    for (const b of db.biodata) for (const h of b.highlights) {
      const [kind, id] = h.split(':') as [EntityKind, string];
      const r = (db[kind] as AnyRecord[]).find((x) => x.id === id)!;
      expect(r.status).toBe('Approved');
      expect(rules.creditedFaculty(kind, r)).toContain(b.facultyId);
    }
  });
});

describe('totals reconcile wherever they are shown', () => {
  it('publication types and quartiles add up to the total', () => {
    const u = uniqueCounts(db, ALL);
    const byType = ['Journal Article', 'Conference Paper', 'Book', 'Book Chapter', 'Technical Report'].map((t) => u.pubs.filter((p) => p.entryType === t).length);
    expect(byType.reduce((a, n) => a + n, 0)).toBe(u.pubs.length);
    const journals = u.pubs.filter((p) => p.entryType === 'Journal Article');
    expect(['Q1', 'Q2', 'Q3', 'Q4', 'NA'].map((q) => journals.filter((p) => p.quartile === q).length).reduce((a, n) => a + n, 0)).toBe(journals.length);
  });
  it('the year-by-year charts add up to the all-time totals', () => {
    const rows = trend(db, '', academicYears(db, TODAY));
    const u = uniqueCounts(db, ALL);
    const sum = (k: keyof (typeof rows)[number]) => rows.reduce((a, r) => a + (r[k] as number), 0);
    expect(sum('journal') + sum('confPaper') + sum('bookChapter') + sum('report')).toBe(u.pubs.length);
    expect(sum('proposals')).toBe(u.grants.length);
    expect(sum('sanctionedCount')).toBe(u.sanctioned.length);
    expect(sum('fdpHours')).toBe(u.fdpHours);
    expect(sum('confs')).toBe(u.confs.length);
    expect(Math.round(sum('sanctionedL') * 1e5)).toBeCloseTo(u.sanctionedAmount, -5); // per-year lakh values are rounded to 0.1
  });
  it('department totals add up to the institution total', () => {
    const inst = uniqueCounts(db, ALL);
    const depts = db.settings.departments.map((d) => uniqueCounts(db, { ...ALL, department: d }));
    // In the sample data every co-author and co-investigator is from the same department, so nothing is counted twice.
    expect(depts.reduce((a, u) => a + u.pubs.length, 0)).toBe(inst.pubs.length);
    expect(depts.reduce((a, u) => a + u.grants.length, 0)).toBe(inst.grants.length);
    expect(depts.reduce((a, u) => a + u.sanctionedAmount, 0)).toBe(inst.sanctionedAmount);
    expect(depts.reduce((a, u) => a + u.fdpHours, 0)).toBe(inst.fdpHours);
    expect(depts.reduce((a, u) => a + u.awards.length, 0)).toBe(inst.awards.length);
    expect(depts.reduce((a, u) => a + u.ipr.length, 0)).toBe(inst.ipr.length);
  });
  it('each faculty member\'s counts equal their approved records, and funding shares add up to each grant', () => {
    const stats = facultyStats(db, ALL);
    for (const s of stats) {
      const mine = (k: EntityKind) => (db[k] as AnyRecord[]).filter((r) => r.status === 'Approved' && rules.creditedFaculty(k, r).includes(s.faculty.id));
      expect(s.publications).toBe(mine('publications').length);
      expect(s.grantsApplied).toBe(mine('grants').length);
      expect(s.fdps).toBe(mine('fdps').length);
      expect(s.conferences).toBe(mine('conferences').length);
      expect(s.awards).toBe(mine('awards').length);
      expect(s.ipr).toBe(mine('ipr').length);
    }
    const shares = stats.reduce((a, s) => a + s.sanctionedAmount, 0);
    expect(Math.round(shares)).toBe(uniqueCounts(db, ALL).sanctionedAmount);
  });
  it('a co-authored paper counts once for the institution and once for each author', () => {
    const coauthored = (db.publications as Publication[]).filter((p) => p.status === 'Approved' && rules.creditedFaculty('publications', p).length > 1);
    expect(coauthored.length).toBeGreaterThan(0);
    const perPerson = facultyStats(db, ALL).reduce((a, s) => a + s.publications, 0);
    const extraCredits = coauthored.reduce((a, p) => a + rules.creditedFaculty('publications', p).length - 1, 0);
    expect(perPerson).toBe(uniqueCounts(db, ALL).pubs.length + extraCredits);
  });
});

describe('Top-Level Management sees approved records only', () => {
  it('receives no draft, submitted, under-review, returned or rejected record, and no review comments', () => {
    const seen = rules.scopeFor(db, mgmt);
    for (const { r } of records(seen)) {
      expect(r.status).toBe('Approved');
      expect(r.history.every((h) => !h.remark && ['Created', 'Approved'].includes(h.action) || h.action.startsWith('Outcome'))).toBe(true);
    }
    expect(seen.profileChanges).toEqual([]);
    expect(records(db).some(({ r }) => r.status !== 'Approved')).toBe(true); // there is pending work it must not see
  });
  it('every dashboard figure is the same whether computed from all data or from what management receives', () => {
    const seen = rules.scopeFor(db, mgmt);
    const strip = (u: ReturnType<typeof uniqueCounts>) => Object.fromEntries(Object.entries(u).map(([k, v]) => [k, Array.isArray(v) ? v.map((r: AnyRecord) => r.id) : v]));
    expect(strip(uniqueCounts(seen, ALL))).toEqual(strip(uniqueCounts(db, ALL)));
    const ays = academicYears(db, TODAY);
    expect(trend(seen, '', ays)).toEqual(trend(db, '', ays));
    const score = (d: DB) => facultyStats(d, ALL).map((s) => [s.faculty.id, s.publications, s.grantsSanctioned, s.sanctionedAmount, s.fdpHours, s.awards, s.ipr, s.score]);
    expect(score(seen)).toEqual(score(db));
  });
  it('a submission counts for management only after the Office of Research approves it', () => {
    const d = createSeed();
    const p = (d.publications as Publication[]).find((x) => x.status === 'Submitted')!;
    const ay = academicYearRange(String(p.year - (['Jan', 'Feb', 'Mar', 'Apr', 'May'].includes(p.month) ? 1 : 0)), d.settings.academicYearStartMonth);
    const count = () => uniqueCounts(rules.scopeFor(d, mgmt), { ...ay, department: '' }).pubs.length;
    const before = count();
    rules.startReview(d, office, 'publications', p.id);
    expect(count()).toBe(before);
    rules.review(d, office, 'publications', p.id, 'Rework', 'Attach the PDF.');
    expect(count()).toBe(before);
    rules.saveRecord(d, { userId: p.facultyId, name: 'Owner', role: 'faculty', facultyId: p.facultyId }, 'publications', { ...p, note: 'Attached.' } as unknown as Record<string, unknown>, true);
    expect(count()).toBe(before);
    rules.review(d, office, 'publications', p.id, 'Approved', '');
    expect(count()).toBe(before + 1);
    expect(approvedIn(d, 'publications', ay).some((x) => x.id === p.id)).toBe(true);
    expect(dateOf('publications', p) >= ay.from).toBe(true);
  });
});

describe('review workflow', () => {
  it('Submitted → Under Review → Changes Requested → Resubmitted → Under Review → Approved, with the conversation kept', () => {
    const d = createSeed();
    const me = d.faculty[0].id;
    const fac: Actor = { userId: me, name: 'Faculty member', role: 'faculty', facultyId: me };
    const id = rules.saveRecord(d, fac, 'fdps', { role: 'Attended', programmeType: 'FDP', title: 'Test', organiser: 'NPTEL', sponsoredBy: '', mode: 'Online', level: 'National', fromDate: '2026-08-01', toDate: '2026-08-02', hours: 12, outcome: '', certificateName: '' }, true);
    const get = () => d.fdps.find((x) => x.id === id)!;
    expect(get().status).toBe('Submitted');
    expect(() => rules.startReview(d, mgmt, 'fdps', id)).toThrow(/Office of Research/);
    rules.startReview(d, office, 'fdps', id);
    expect(get().status).toBe('UnderReview');
    expect(() => rules.saveRecord(d, fac, 'fdps', { ...get() } as unknown as Record<string, unknown>, false)).toThrow(/locked/);
    rules.review(d, office, 'fdps', id, 'Rework', 'Upload the certificate.');
    expect(get().status).toBe('Rework');
    rules.saveRecord(d, fac, 'fdps', { ...get(), certificateName: 'c.pdf', note: 'Uploaded.' } as unknown as Record<string, unknown>, true);
    expect(get().status).toBe('Submitted');
    rules.review(d, office, 'fdps', id, 'Approved', '');
    expect(get().history.map((h) => h.action)).toEqual(['Created', 'Submitted', 'Review started', 'Returned for correction', 'Edited', 'Resubmitted', 'Review started', 'Approved']);
    expect(get().history.find((h) => h.action === 'Resubmitted')!.remark).toBe('Uploaded.');
    // Management sees the approved record without any of the conversation.
    const seen = rules.scopeFor(d, mgmt).fdps.find((x) => x.id === id)!;
    expect(seen.history.map((h) => h.action)).toEqual(['Created', 'Approved']);
    expect(seen.history.some((h) => h.remark)).toBe(false);
  });
});

void ({} as Grant);

describe('profile updates keep Ph.D. counts and the supervision list in agreement', () => {
  it('counts typed by hand are replaced by the scholars listed, and kept when none is listed', () => {
    const d = createSeed();
    const b = d.biodata.find((x) => x.supervision.some((s) => s.degree === 'PhD'))!;
    const f = d.faculty.find((x) => x.id === b.facultyId)!;
    const me: Actor = { userId: f.id, name: f.name, role: 'faculty', facultyId: f.id };
    const contact = { email: f.email, phone: f.phone, orcid: f.orcid, scopusId: f.scopusId };
    rules.proposeProfileChange(d, me, { biodata: { ...b, summary: `${b.summary} Updated.`, phdGuided: 99, phdOngoing: 99 }, contact }, true);
    const sent = d.profileChanges.find((c) => c.facultyId === f.id)!;
    expect(sent.biodata.phdGuided).toBe(b.supervision.filter((x) => x.degree === 'PhD' && x.status === 'Completed').length);
    expect(sent.biodata.phdOngoing).toBe(b.supervision.filter((x) => x.degree === 'PhD' && x.status === 'Current').length);
    expect(rules.phdCounts([])).toBeNull();
  });
});

describe('Follow me links', () => {
  it('accept only https addresses on the right site, and keep them out of the profile until approved', () => {
    const d = createSeed();
    const b = d.biodata[0];
    const f = d.faculty.find((x) => x.id === b.facultyId)!;
    const me: Actor = { userId: f.id, name: f.name, role: 'faculty', facultyId: f.id };
    const contact = { email: f.email, phone: f.phone, orcid: f.orcid, scopusId: f.scopusId };
    const propose = (links: Record<string, string>) => rules.proposeProfileChange(d, me, { biodata: { ...b, links: { ...b.links, ...links } }, contact }, true);
    expect(() => propose({ linkedin: 'https://example.com/me' })).toThrow(/LinkedIn/);
    expect(() => propose({ twitter: 'http://x.com/me' })).toThrow(/X \(Twitter\)/);
    expect(() => propose({ github: 'https://github.com.evil.io/me' })).toThrow(/GitHub/);
    const id = propose({ linkedin: 'https://www.linkedin.com/in/someone', twitter: 'https://x.com/someone', website: 'https://example.org' });
    expect(d.biodata.find((x) => x.facultyId === f.id)!.links.twitter ?? '').toBe(''); // not live yet
    rules.reviewProfileChange(d, { userId: 'o', name: 'Office of Research', role: 'office' }, id, 'Approved', '');
    expect(d.biodata.find((x) => x.facultyId === f.id)!.links).toMatchObject({ linkedin: 'https://www.linkedin.com/in/someone', twitter: 'https://x.com/someone', website: 'https://example.org' });
  });
});
