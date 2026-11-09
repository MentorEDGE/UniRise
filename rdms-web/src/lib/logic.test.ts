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
const office: Actor = { userId: 'o', name: 'Office of Research', role: 'office' };
const fac = (id: string): Actor => ({ userId: id, name: id, role: 'faculty', facultyId: id });
const fdp = (): Record<string, unknown> => ({
  role: 'Attended', programmeType: 'FDP', title: 'Test FDP', organiser: 'NPTEL', sponsoredBy: '', mode: 'Online', level: 'National',
  fromDate: '2026-08-01', toDate: '2026-08-05', hours: 30, outcome: '', certificateName: 'c.pdf',
});
const find = (kind: 'fdps', id: string) => db[kind].find((x) => x.id === id)!;

beforeEach(() => { db = createSeed(); });

describe('workflow rules', () => {
  it('faculty create and submit; only the Office of Research approves; approved entries are locked', () => {
    const id = rules.saveRecord(db, fac('EMP1001'), 'fdps', fdp(), true);
    expect(find('fdps', id).status).toBe('Submitted');
    expect(() => rules.review(db, fac('EMP1002'), 'fdps', id, 'Approved', '')).toThrow(/Office of Research/);
    expect(() => rules.review(db, mgmt, 'fdps', id, 'Approved', '')).toThrow(/Office of Research/);
    rules.review(db, office, 'fdps', id, 'Approved', '');
    expect(find('fdps', id).status).toBe('Approved');
    expect(() => rules.saveRecord(db, fac('EMP1001'), 'fdps', { ...find('fdps', id) }, false)).toThrow(/approved/);
  });

  it('rework and reject need a remark; rework re-opens editing', () => {
    const id = rules.saveRecord(db, fac('EMP1002'), 'fdps', fdp(), true);
    expect(() => rules.review(db, office, 'fdps', id, 'Rework', '  ')).toThrow(/remark/);
    rules.review(db, office, 'fdps', id, 'Rework', 'Attach certificate');
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
    expect(() => rules.saveSettings(db, fac('EMP1001'), db.settings)).toThrow(/Office of Research/);
    expect(() => rules.saveSettings(db, mgmt, db.settings)).toThrow(/Office of Research/);
    expect(() => rules.addNotice(db, mgmt, 'x', 'y')).toThrow(/Office of Research/);
  });

  it('management is read-only: no faculty edits, profile edits or grant outcomes', () => {
    const f = db.faculty.find((x) => x.id === 'EMP1001')!;
    expect(() => rules.saveFaculty(db, mgmt, { ...f, designation: 'Professor' })).toThrow(/Office of Research/);
    expect(() => rules.saveFaculty(db, fac('EMP1001'), { ...f, designation: 'Professor' })).toThrow(/Office of Research/);
    expect(() => rules.proposeProfileChange(db, mgmt, { biodata: db.biodata[0], contact: f }, true)).toThrow(/faculty member/);
    const g = db.grants.find((x) => x.status === 'Approved')!;
    expect(() => rules.updateGrantOutcome(db, mgmt, g.id, { outcome: 'Completed', sanctionDate: '', sanctionedAmount: 0, receivedAmount: 0 })).toThrow(/Office of Research/);
    rules.updateGrantOutcome(db, office, g.id, { outcome: 'Completed', sanctionDate: '', sanctionedAmount: 0, receivedAmount: 0 });
    expect(db.grants.find((x) => x.id === g.id)!.outcome).toBe('Completed');
  });

  it('profile updates wait for the Office of Research; returned or rejected updates never change the approved profile', () => {
    const f = db.faculty.find((x) => x.id === 'EMP1001')!;
    const before = structuredClone(db.biodata.find((x) => x.facultyId === 'EMP1001')!);
    const b = rules.normalizeBiodata(before);
    const contact = { email: f.email, phone: '9000000000', orcid: f.orcid, scopusId: f.scopusId };
    expect(() => rules.proposeProfileChange(db, fac('EMP1001'), { biodata: b, contact: f }, true)).toThrow(/Nothing has changed/);
    const id = rules.proposeProfileChange(db, fac('EMP1001'), { biodata: { ...b, summary: 'New biography' }, contact }, true);
    const pending = db.profileChanges.find((c) => c.id === id)!;
    expect(pending.status).toBe('Submitted');
    expect(pending.changed).toEqual(expect.arrayContaining(['Biography', 'Phone']));
    expect(db.biodata.find((x) => x.facultyId === 'EMP1001')!.summary).toBe(before.summary);
    expect(rules.scopeFor(db, mgmt).profileChanges).toEqual([]);
    expect(rules.scopeFor(db, fac('EMP1002')).profileChanges).toEqual([]);
    expect(() => rules.reviewProfileChange(db, mgmt, id, 'Approved', '')).toThrow(/Office of Research/);
    rules.reviewProfileChange(db, office, id, 'Rework', 'Add your ORCID');
    expect(db.biodata.find((x) => x.facultyId === 'EMP1001')!.summary).toBe(before.summary);
    // editing the returned update reuses it; approval then applies it
    expect(rules.proposeProfileChange(db, fac('EMP1001'), { biodata: { ...b, summary: 'New biography' }, contact }, true)).toBe(id);
    rules.reviewProfileChange(db, office, id, 'Approved', '');
    expect(db.biodata.find((x) => x.facultyId === 'EMP1001')!.summary).toBe('New biography');
    expect(db.faculty.find((x) => x.id === 'EMP1001')!.phone).toBe('9000000000');
    const rej = rules.proposeProfileChange(db, fac('EMP1001'), { biodata: { ...b, summary: 'Wrong' }, contact }, true);
    rules.reviewProfileChange(db, office, rej, 'Rejected', 'Not accurate');
    expect(db.biodata.find((x) => x.facultyId === 'EMP1001')!.summary).toBe('New biography');
  });
});

describe('honours and awards', () => {
  const honour = (): Record<string, unknown> => ({ category: 'Award', title: 'Young Scientist Award', awardedBy: 'DST', level: 'National', awardDate: '2026-08-15', citation: '', prizeAmount: 25000, certificateName: 'c.pdf' });

  it('go through the same approval workflow and stay private to their owner', () => {
    const id = rules.saveRecord(db, fac('EMP1001'), 'awards', { ...honour(), status: 'Approved' }, true);
    const rec = db.awards.find((x) => x.id === id)!;
    expect(id).toMatch(/^AWD/);
    expect(rec.status).toBe('Submitted');
    expect(rules.scopeFor(db, fac('EMP1002')).awards.some((x) => x.id === id)).toBe(false);
    rules.review(db, office, 'awards', id, 'Approved', '');
    expect(db.awards.find((x) => x.id === id)!.status).toBe('Approved');
  });

  it('reject future dates, unknown categories and missing fields', () => {
    expect(() => rules.saveRecord(db, fac('EMP1001'), 'awards', { ...honour(), awardDate: '2999-01-01' }, false)).toThrow(/after it has been received/);
    expect(() => rules.saveRecord(db, fac('EMP1001'), 'awards', { ...honour(), category: 'Made up' }, false)).toThrow(/category/);
    expect(() => rules.saveRecord(db, fac('EMP1001'), 'awards', { ...honour(), awardedBy: ' ' }, false)).toThrow(/Conferred by/);
  });

  it('approved honours count for the faculty member and score by level', () => {
    const f = { from: '2026-08-01', to: '2026-08-31', department: '' };
    const before = facultyStats(db, f).find((s) => s.faculty.id === 'EMP1001')!;
    const id = rules.saveRecord(db, fac('EMP1001'), 'awards', { ...honour(), level: 'International' }, true);
    rules.review(db, office, 'awards', id, 'Approved', '');
    const after = facultyStats(db, f).find((s) => s.faculty.id === 'EMP1001')!;
    expect(after.awards).toBe(before.awards + 1);
    expect(after.score - before.score).toBeCloseTo(db.settings.weights.awardInternational);
    expect(uniqueCounts(db, f).awards.some((x) => x.id === id)).toBe(true);
  });
});

describe('intellectual property', () => {
  const patent = (): Record<string, unknown> => ({ ipType: 'Patent', ipTypeOther: '', title: 'A system for testing', description: 'A test invention.', stage: 'Filed', applicationNumber: '202641100001', filingDate: '2026-08-10', grantDate: '', office: 'Indian Patent Office', owner: 'University', ownerOther: '', funding: '', licensed: false, licensee: '', coOwners: '', documentName: 'r.pdf', agreementName: '', declared: true });

  it('is entered by faculty, approved only by the Office of Research, and shown to management once approved', () => {
    const id = rules.saveRecord(db, fac('EMP1001'), 'ipr', patent(), true);
    expect(id).toMatch(/^IPR/);
    expect(db.ipr.find((x) => x.id === id)!.status).toBe('Submitted');
    expect(() => rules.saveRecord(db, mgmt, 'ipr', patent(), false)).toThrow(/faculty/);
    expect(rules.scopeFor(db, mgmt).ipr.some((x) => x.id === id)).toBe(false);
    expect(rules.scopeFor(db, fac('EMP1002')).ipr.some((x) => x.id === id)).toBe(false);
    expect(() => rules.review(db, mgmt, 'ipr', id, 'Approved', '')).toThrow(/Office of Research/);
    rules.review(db, office, 'ipr', id, 'Approved', '');
    expect(rules.scopeFor(db, mgmt).ipr.some((x) => x.id === id)).toBe(true);
  });

  it('checks the form: type, description length, status, dates, owner, licence partner, duplicates, attachment and declaration', () => {
    const save = (x: Record<string, unknown>, submit = false) => rules.saveRecord(db, fac('EMP1001'), 'ipr', { ...patent(), ...x }, submit);
    expect(() => save({ ipType: 'Utility model' })).toThrow(/type of IP/);
    expect(() => save({ ipType: 'Other' })).toThrow(/type of IP \(other\)/);
    expect(() => save({ description: Array(51).fill('word').join(' ') })).toThrow(/50 words/);
    expect(() => save({ stage: 'Granted' })).toThrow(/status/);
    expect(() => save({ filingDate: '2999-01-01' })).toThrow(/after it has been filed/);
    expect(() => save({ grantDate: '2026-01-01' })).toThrow(/before the filing date/);
    expect(() => save({ office: ' ' })).toThrow(/Office \/ country/);
    expect(() => save({ owner: 'Nobody' })).toThrow(/owner/);
    expect(() => save({ licensed: true })).toThrow(/Partner name/);
    expect(() => save({ documentName: '' }, true)).toThrow(/filing receipt/);
    expect(() => save({ declared: false }, true)).toThrow(/declaration/);
    save({ applicationNumber: 'DUP-1' });
    expect(() => save({ applicationNumber: 'dup-1', ipType: 'Design' })).toThrow(/already entered/);
    expect(save({ ipType: 'Other', ipTypeOther: 'Plant variety', stage: 'Granted / Registered', applicationNumber: 'PV-1', grantDate: '2026-09-01', owner: 'Joint', licensed: true, licensee: 'A seed company' })).toMatch(/^IPR/);
  });

  it('approved patents count for the faculty member and score as granted or filed', () => {
    const f = { from: '2026-08-01', to: '2026-08-31', department: '' };
    const before = facultyStats(db, f).find((s) => s.faculty.id === 'EMP1001')!;
    const id = rules.saveRecord(db, fac('EMP1001'), 'ipr', { ...patent(), applicationNumber: 'SCORE-1', stage: 'Granted / Registered', grantDate: '2026-09-01' }, true);
    rules.review(db, office, 'ipr', id, 'Approved', '');
    const after = facultyStats(db, f).find((s) => s.faculty.id === 'EMP1001')!;
    expect(after.ipr).toBe(before.ipr + 1);
    expect(after.patents).toBe(before.patents + 1);
    expect(after.score - before.score).toBeCloseTo(db.settings.weights.patentGranted);
    expect(uniqueCounts(db, f).ipr.some((x) => x.id === id)).toBe(true);
  });

  it('older IP records are brought up to the form fields without losing what was entered', () => {
    const old = { id: 'IPR1', facultyId: 'EMP1001', status: 'Approved', createdAt: '', updatedAt: '', history: [], ipType: 'Copyright', title: 'T', stage: 'Registered', applicationNumber: 'SW-1', filingDate: '2024-01-01', registrationNumber: 'SW-1/2025', grantDate: '2025-01-01', country: 'India', office: 'Copyright Office', coOwners: '', description: '', documentName: 'c.pdf' };
    const x = rules.normalizeIp(old as never);
    expect(x.stage).toBe('Granted / Registered');
    expect(x.office).toBe('Copyright Office, India');
    expect(x.owner).toBe('University');
    expect('country' in x || 'registrationNumber' in x).toBe(false);
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

describe('expert-finder profile fields and the public directory', () => {
  const contactOf = (id: string) => { const f = db.faculty.find((x) => x.id === id)!; return { email: f.email, phone: f.phone, orcid: f.orcid, scopusId: f.scopusId }; };
  it('are checked, go through approval, and only then appear', () => {
    const b = rules.normalizeBiodata(structuredClone(db.biodata.find((x) => x.facultyId === 'EMP1001')!));
    const save = (x: Partial<typeof b>) => rules.proposeProfileChange(db, fac('EMP1001'), { biodata: { ...b, ...x }, contact: contactOf('EMP1001') }, true);
    expect(() => save({ links: { ...b.links, linkedin: 'http://linkedin.com/in/x' } })).toThrow(/https/);
    expect(() => save({ media: [{ headline: 'H', outlet: 'O', date: '2026-01-01', url: 'javascript:alert(1)' }] })).toThrow(/Media links/);
    const id = save({
      primaryInterest: 'Edge computing', availableForMedia: !b.availableForMedia, office: 'Block A · Room 1',
      teaching: [{ code: 'CSE1', title: 'Distributed systems', level: 'Postgraduate' }, { code: '', title: '', level: '' }],
      supervision: [{ name: 'Scholar Z1', degree: 'Made-up', status: 'Current', year: '2025', topic: 'T' }],
      engagement: [{ type: 'Editorial board', role: 'Associate Editor', organisation: 'A journal', from: '2024', to: 'Present' }],
      highlights: ['publications:PUB1', 'not a key', 'ipr:IPR2', 'grants:G1', 'awards:AWD3', 'publications:PUB4', 'publications:PUB5', 'publications:PUB6'],
    });
    const pending = db.profileChanges.find((c) => c.id === id)!;
    expect(pending.changed).toEqual(expect.arrayContaining(['Primary interest', 'Available for media comment', 'Teaching', 'Supervision', 'Engagement', 'Office location', 'Highlights']));
    expect(pending.biodata.teaching).toHaveLength(1);
    expect(pending.biodata.supervision[0].degree).toBe('PhD');
    expect(pending.biodata.highlights.length).toBeLessThanOrEqual(6);
    expect(pending.biodata.highlights).not.toContain('not a key');
    expect(db.biodata.find((x) => x.facultyId === 'EMP1001')!.primaryInterest ?? '').not.toBe('Edge computing');
    rules.reviewProfileChange(db, office, id, 'Approved', '');
    expect(db.biodata.find((x) => x.facultyId === 'EMP1001')!.primaryInterest).toBe('Edge computing');
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

describe('management scope and researcher profiles', () => {
  it('management receives approved records only, without review remarks', () => {
    const id = rules.saveRecord(db, fac('EMP1001'), 'fdps', fdp(), true);
    const seen = rules.scopeFor(db, mgmt);
    for (const k of ['publications', 'grants', 'seedMoney', 'fdps', 'conferences', 'awards'] as const) {
      expect((seen[k] as { status: string }[]).every((r) => r.status === 'Approved')).toBe(true);
    }
    expect(seen.fdps.some((x) => x.id === id)).toBe(false);
    expect(seen.publications.every((p) => p.history.every((h) => !h.remark))).toBe(true);
  });

  it('Google Scholar metrics are kept as entered, blank means not available, and changes are stamped', () => {
    const b = rules.normalizeBiodata(db.biodata.find((x) => x.facultyId === 'EMP1001')!);
    expect(b.scholar.citations).toBeNull();
    const f = db.faculty.find((x) => x.id === 'EMP1001')!;
    const save = (bio: typeof b) => rules.reviewProfileChange(db, office, rules.proposeProfileChange(db, fac('EMP1001'), { biodata: bio, contact: f }, true), 'Approved', '');
    save({ ...b, googleScholar: 'https://scholar.google.com/citations?user=abc', scholar: { ...b.scholar, citations: 420, hIndex: 11, i10Index: 13 } });
    const saved = db.biodata.find((x) => x.facultyId === 'EMP1001')!;
    expect(saved.scholar).toMatchObject({ citations: 420, hIndex: 11, i10Index: 13, updatedBy: 'EMP1001' });
    expect(saved.scholar.updatedAt).not.toBe('');
    expect(() => save({ ...saved, scholar: { ...saved.scholar, hIndex: 40 } })).toThrow(/h-index/);
    expect(() => save({ ...saved, googleScholar: 'https://example.com/me' })).toThrow(/scholar.google/);
    save({ ...saved, scholar: { ...saved.scholar, citations: null, hIndex: null, i10Index: null } });
    expect(db.biodata.find((x) => x.facultyId === 'EMP1001')!.scholar.citations).toBeNull();
  });

  it('SDGs are limited to goals 1-17 and the sample data never invents metrics or photos', () => {
    const b = rules.normalizeBiodata(db.biodata.find((x) => x.facultyId === 'EMP1001')!);
    const f = db.faculty.find((x) => x.id === 'EMP1001')!;
    rules.reviewProfileChange(db, office, rules.proposeProfileChange(db, fac('EMP1001'), { biodata: { ...b, sdgs: [3, 3, 0, 18, 9] }, contact: f }, true), 'Approved', '');
    expect(db.biodata.find((x) => x.facultyId === 'EMP1001')!.sdgs).toEqual([3, 9]);
    const fresh = createSeed();
    expect(fresh.biodata.every((x) => x.scholar.citations === null && x.photo === '')).toBe(true);
    expect(fresh.faculty.every((f) => /^Faculty [A-Z]+$/.test(f.name))).toBe(true);
  });
});
