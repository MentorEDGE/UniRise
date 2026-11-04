import { beforeEach, describe, expect, it } from 'vitest';
import { academicYearOf, academicYearRange, facultyStats, scoreRecord, uniqueCounts } from './analytics';
import { toCsv } from './csv';
import * as rules from './domain';
import type { Actor } from './domain';
import { REPORTS, runReport } from './reports';
import { createSeed } from './seed';
import type { DB, Fdp, Publication } from './types';

let db: DB;
const mgmt: Actor = { userId: 'm', name: 'Dean', role: 'management' };
const fac = (id: string): Actor => ({ userId: id, name: id, role: 'faculty', facultyId: id });
const fdp = (): Record<string, unknown> => ({
  role: 'Attended', programmeType: 'FDP', title: 'Test FDP', organiser: 'NPTEL', sponsoredBy: '', mode: 'Online', level: 'National',
  fromDate: '2026-08-01', toDate: '2026-08-05', hours: 30, outcome: '', certificateName: 'c.pdf',
});
const find = (kind: 'fdps', id: string) => db[kind].find((x) => x.id === id)!;

beforeEach(() => { db = createSeed(); });

describe('workflow rules', () => {
  it('faculty create and submit; management approves; approved entries are locked', () => {
    const id = rules.saveRecord(db, fac('EMP1001'), 'fdps', fdp(), true);
    expect(find('fdps', id).status).toBe('Submitted');
    expect(() => rules.review(db, fac('EMP1002'), 'fdps', id, 'Approved', '')).toThrow(/Management/);
    rules.review(db, mgmt, 'fdps', id, 'Approved', '');
    expect(find('fdps', id).status).toBe('Approved');
    expect(() => rules.saveRecord(db, fac('EMP1001'), 'fdps', { ...find('fdps', id) }, false)).toThrow(/approved/);
  });

  it('rework and reject need a remark; rework re-opens editing', () => {
    const id = rules.saveRecord(db, fac('EMP1002'), 'fdps', fdp(), true);
    expect(() => rules.review(db, mgmt, 'fdps', id, 'Rework', '  ')).toThrow(/remark/);
    rules.review(db, mgmt, 'fdps', id, 'Rework', 'Attach certificate');
    rules.saveRecord(db, fac('EMP1002'), 'fdps', { ...find('fdps', id), hours: 24 }, true);
    expect(find('fdps', id).status).toBe('Submitted');
    expect(find('fdps', id).history.map((h) => h.action)).toContain('Resubmitted');
  });

  it('ignores workflow fields sent by the client', () => {
    const id = rules.saveRecord(db, fac('EMP1001'), 'fdps', { ...fdp(), status: 'Approved', facultyId: 'EMP1009', history: [] }, false);
    const r = find('fdps', id);
    expect(r.status).toBe('Draft');
    expect(r.facultyId).toBe('EMP1001');
    expect(r.history[0].action).toBe('Created');
  });

  it('faculty cannot set grant funding outcomes', () => {
    const id = rules.saveRecord(db, fac('EMP1001'), 'grants', {
      unit: 'Indian Grant', grantType: 'Research Project', title: 'T', agency: 'DST', appliedDate: '2026-08-01', appliedAmount: 100000,
      investigators: [{ kind: 'Faculty', code: 'EMP1001', name: 'A', role: 'PI', institution: '', department: '', sharePct: 100 }],
      outcome: 'Sanctioned', sanctionedAmount: 9e9, receivedAmount: 9e9,
    }, false);
    const g = db.grants.find((x) => x.id === id)!;
    expect(g.outcome).toBe('Applied');
    expect(g.sanctionedAmount).toBe(0);
  });

  it('faculty cannot edit, delete or see another person’s private entry', () => {
    const id = rules.saveRecord(db, fac('EMP1001'), 'fdps', fdp(), false);
    expect(() => rules.saveRecord(db, fac('EMP1003'), 'fdps', { ...find('fdps', id) }, false)).toThrow(/not found/);
    expect(() => rules.deleteRecord(db, fac('EMP1003'), 'fdps', id)).toThrow(/not found/);
    const scoped = rules.scopeFor(db, fac('EMP1003'));
    expect(scoped.fdps.some((x) => x.id === id)).toBe(false);
  });

  it('only drafts can be deleted', () => {
    const id = rules.saveRecord(db, fac('EMP1001'), 'fdps', fdp(), true);
    expect(() => rules.deleteRecord(db, fac('EMP1001'), 'fdps', id)).toThrow(/drafts/);
  });

  it('server-side checks: investigator shares, own authorship, duplicate DOI', () => {
    const base = { unit: 'Indian Grant', grantType: 'Research Project', title: 'T', agency: 'DST', appliedDate: '2026-08-01', appliedAmount: 100000 };
    expect(() => rules.saveRecord(db, fac('EMP1001'), 'grants', { ...base, investigators: [{ kind: 'Faculty', code: 'EMP1001', name: 'A', role: 'PI', sharePct: 60 }] }, false)).toThrow(/100%/);
    const doi = db.publications[0].doi;
    expect(() => rules.saveRecord(db, fac('EMP1001'), 'publications', {
      entryType: 'Journal Article', title: 'X', venue: 'J', year: 2025, doi, authors: [{ kind: 'Faculty', code: 'EMP1001', name: 'A' }],
    }, false)).toThrow(/already entered/);
    expect(() => rules.saveRecord(db, fac('EMP1001'), 'publications', {
      entryType: 'Journal Article', title: 'X', venue: 'J', year: 2025, authors: [{ kind: 'Faculty', code: 'EMP1002', name: 'B' }],
    }, false)).toThrow(/listed as one of the authors/);
  });

  it('management cannot create entries; faculty cannot change settings or others’ biodata', () => {
    expect(() => rules.saveRecord(db, mgmt, 'fdps', fdp(), false)).toThrow(/faculty/);
    expect(() => rules.saveSettings(db, fac('EMP1001'), db.settings)).toThrow(/Management/);
    expect(() => rules.saveBiodata(db, fac('EMP1001'), db.biodata.find((b) => b.facultyId === 'EMP1002')!)).toThrow(/own/);
  });

  it('faculty edits to their profile keep management-owned fields', () => {
    const f = db.faculty.find((x) => x.id === 'EMP1001')!;
    rules.saveFaculty(db, fac('EMP1001'), { ...f, designation: 'Professor', department: 'Civil Engineering', phone: '9000000000' });
    const after = db.faculty.find((x) => x.id === 'EMP1001')!;
    expect(after.phone).toBe('9000000000');
    expect(after.department).toBe(f.department);
    expect(after.designation).toBe(f.designation);
  });
});

describe('what faculty receive', () => {
  it('own records in any state, colleagues’ approved publications only, no colleague biodata or contact details', () => {
    const me = 'EMP1005';
    const s = rules.scopeFor(db, fac(me));
    for (const p of s.publications) expect(p.status === 'Approved' || rules.creditedFaculty('publications', p).includes(me)).toBe(true);
    for (const k of ['grants', 'seedMoney', 'fdps', 'conferences'] as const) for (const r of s[k]) expect(rules.creditedFaculty(k, r)).toContain(me);
    expect(s.biodata.map((b) => b.facultyId)).toEqual([me]);
    expect(s.faculty.filter((f) => f.id !== me).every((f) => !f.phone)).toBe(true);
  });
});

describe('analytics', () => {
  it('academic year boundaries follow the configured start month', () => {
    expect(academicYearOf('2026-05-31', 6)).toBe('2025-26');
    expect(academicYearOf('2026-06-01', 6)).toBe('2026-27');
    expect(academicYearRange('2026-27', 6)).toEqual({ from: '2026-06-01', to: '2027-05-31' });
    expect(academicYearRange('2026', 1)).toEqual({ from: '2026-01-01', to: '2026-12-31' });
  });

  it('a co-authored paper is credited to both authors but counted once for the institution', () => {
    const a = db.faculty[0], b = db.faculty[1];
    const p: Publication = {
      id: 'PUBX', facultyId: a.id, status: 'Approved', createdAt: '', updatedAt: '', history: [], entryType: 'Journal Article', category: 'Research Article',
      title: 'Shared', doi: 'x', month: 'Jul', year: 2030, issn: '', venue: 'J', indexing: 'Scopus', quartile: 'Q1', impactFactor: 1, erfRelated: false,
      projectReference: '', openAccess: false, pdfName: 'x.pdf',
      authors: [{ kind: 'Faculty', code: a.id, name: a.name, institution: '', department: '', email: '' }, { kind: 'Faculty', code: b.id, name: b.name, institution: '', department: '', email: '' }],
    };
    db.publications.push(p);
    const f = { from: '2030-01-01', to: '2030-12-31', department: '' };
    expect(uniqueCounts(db, f).pubs).toHaveLength(1);
    const stats = facultyStats(db, f);
    expect(stats.find((s) => s.faculty.id === a.id)!.publications).toBe(1);
    expect(stats.find((s) => s.faculty.id === b.id)!.publications).toBe(1);
  });

  it('only approved entries count, and scores follow the weights', () => {
    const stats = facultyStats(db, { from: '', to: '', department: '' });
    const hours = db.fdps.filter((x) => x.status === 'Approved').reduce((a, x) => a + x.hours, 0);
    expect(stats.reduce((a, s) => a + s.fdpHours, 0)).toBe(hours);
    const w = db.settings.weights;
    expect(scoreRecord('fdps', { ...(fdp() as unknown as Fdp), role: 'Organised' }, w)).toBe(w.fdpOrganised);
  });
});

describe('reports', () => {
  it('group totals count unique records; every report runs', () => {
    const ctx = { db, byId: new Map(db.faculty.map((f) => [f.id, f])) };
    const recs = db.publications.filter((p) => p.status === 'Approved');
    const res = runReport(REPORTS.find((r) => r.id === 'pub-emp-count')!, recs, ctx);
    expect(res.total![1]).toBe(recs.length);
    for (const def of REPORTS) expect(() => runReport(def, db[def.kind], ctx)).not.toThrow();
  });
});

describe('csv', () => {
  it('quotes commas and neutralises formulas', () => {
    expect(toCsv(['a', 'b'], [['x,y', '=SUM(A1)'], [-5, 'ok']])).toBe('a,b\r\n"x,y",\'=SUM(A1)\r\n-5,ok');
  });
});
