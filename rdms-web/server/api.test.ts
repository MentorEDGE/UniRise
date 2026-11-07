/**
 * End-to-end tests of the HTTP API: institution isolation, role permissions, the Office of Research approval workflow
 * and session handling. Each run uses a fresh data directory with two small demo institutions.
 */
import fs from 'node:fs';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DB } from '../src/lib/types';
import { createApp } from './app';
import { DEMO_PASSWORDS, seedDemo } from './demo';
import { Storage } from './storage';

let dir: string; let store: Storage; let server: Server; let base: string;
const ADMIN = { email: 'office@abc.edu.in', password: DEMO_PASSWORDS.office }; // ABC's Office of Research
const XYZ_OFFICE = { email: 'office@xyz.ac.in', password: DEMO_PASSWORDS.office };
const sentMail: { to: string; subject: string; text: string }[] = [];

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rdms-test-'));
  store = new Storage(dir);
  seedDemo(store, { small: true });
  server = createApp(store, { mailer: async (m) => { sentMail.push(m); return { ok: true, note: 'test' }; } }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => { server.close(); store.close(); fs.rmSync(dir, { recursive: true, force: true }); });

/** A browser-like client with its own cookie jar. */
function client() {
  let cookie = '';
  const call = async (method: string, p: string, body?: unknown, headers: Record<string, string> = { 'X-RDMS': '1' }) => {
    const res = await fetch(base + p, { method, headers: { ...headers, ...(cookie ? { cookie } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0].endsWith('=') ? '' : set.split(';')[0];
    return { status: res.status, body: await res.json().catch(() => ({})) as Record<string, unknown> & DB };
  };
  return { call, get: (p: string) => call('GET', p), post: (p: string, b: unknown = {}) => call('POST', p, b) };
}
const signedIn = async (email: string, password: string, route = '/api/login') => {
  const c = client();
  const r = await c.post(route, { email, password });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return c;
};
const facultyOf = (inst: string, i = 0) => store.tenant(inst).faculty[i];

describe('institution isolation', () => {
  it('management sees only its own institution’s data', async () => {
    const c = await signedIn('director@abc.edu.in', DEMO_PASSWORDS.management);
    const data = (await c.get('/api/data')).body;
    expect(data.settings.institutionName).toBe('ABC Institute of Technology');
    expect(data.faculty.every((f) => f.email.endsWith('@abc.edu.in'))).toBe(true);
    const greenEmails = new Set(store.tenant('xyz').faculty.map((f) => f.email));
    expect(data.faculty.some((f) => greenEmails.has(f.email))).toBe(false);
  });

  it('a record id from another institution is simply not found', async () => {
    // Ids are numbered per institution, so pick one that exists only in XYZ: a 404 then proves isolation.
    const abcIds = new Set(store.tenant('abc').grants.map((x) => x.id));
    const xyzGrant = store.tenant('xyz').grants.find((x) => !abcIds.has(x.id))!;
    expect(xyzGrant).toBeDefined();
    const c = await signedIn('director@abc.edu.in', DEMO_PASSWORDS.management);
    expect((await c.post(`/api/grants/${xyzGrant.id}/outcome`, { outcome: 'Completed', sanctionDate: '', sanctionedAmount: 0, receivedAmount: 0 })).status).toBe(403);
    const a = await signedIn(ADMIN.email, ADMIN.password, '/api/admin/login');
    expect((await a.post(`/api/office/approvals/grants/${xyzGrant.id}/outcome`, { outcome: 'Completed', sanctionDate: '', sanctionedAmount: 0, receivedAmount: 0 })).status).toBe(404);
    expect(store.tenant('xyz').grants.find((x) => x.id === xyzGrant.id)!.outcome).toBe(xyzGrant.outcome);
  });

  it('the client cannot choose the institution', async () => {
    const c = await signedIn('director@abc.edu.in', DEMO_PASSWORDS.management);
    const r = await c.get('/api/data?institution=xyz');
    expect(r.body.settings.institutionName).toBe('ABC Institute of Technology');
  });

  it('each institution has its own database file', () => {
    expect(fs.existsSync(path.join(dir, 'tenants', 'abc.sqlite'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'tenants', 'xyz.sqlite'))).toBe(true);
  });
});

describe('faculty access', () => {
  it('receives only their own records, and only names and departments of colleagues', async () => {
    const me = facultyOf('abc', 0);
    const c = await signedIn(me.email, DEMO_PASSWORDS.faculty);
    const data = (await c.get('/api/data')).body;
    expect(data.fdps.every((x) => x.facultyId === me.id)).toBe(true);
    expect(data.conferences.every((x) => x.facultyId === me.id)).toBe(true);
    expect(data.awards.every((x) => x.facultyId === me.id)).toBe(true);
    expect(data.biodata.map((b) => b.facultyId)).toEqual([me.id]);
    expect(data.publications.every((p) => p.facultyId === me.id || p.authors.some((a) => a.code === me.id))).toBe(true);
    expect(data.faculty.filter((f) => f.id !== me.id).every((f) => !f.email && !f.orcid && !f.phone)).toBe(true);
    expect((await c.get('/api/office/users')).status).toBe(403);
  });

  it('cannot act as management or touch another faculty member’s entry', async () => {
    const me = facultyOf('abc', 0);
    const other = store.tenant('abc').fdps.find((x) => x.facultyId !== me.id && x.status === 'Draft') ?? store.tenant('abc').fdps.find((x) => x.facultyId !== me.id)!;
    const c = await signedIn(me.email, DEMO_PASSWORDS.faculty);
    expect((await c.call('PUT', '/api/settings', store.tenant('abc').settings)).status).toBe(403);
    expect((await c.post(`/api/records/fdps/${other.id}/review`, { decision: 'Approved', remark: '' })).status).toBe(403);
    expect((await c.call('DELETE', `/api/records/fdps/${other.id}`)).status).toBe(404);
    expect((await c.call('PUT', `/api/biodata/${other.facultyId}`, { facultyId: other.facultyId })).status).toBe(403);
  });

  it('only the Office of Research approves a submitted entry; management cannot see or review it', async () => {
    const me = facultyOf('abc', 0);
    const f = await signedIn(me.email, DEMO_PASSWORDS.faculty);
    const saved = await f.post('/api/records/fdps', { record: { role: 'Attended', programmeType: 'FDP', title: 'API test', organiser: 'NPTEL', mode: 'Online', level: 'National', fromDate: '2026-07-01', toDate: '2026-07-02', hours: 12, certificateName: 'c.pdf' }, submit: true });
    expect(saved.status).toBe(200);
    const id = saved.body.result as unknown as string;
    const m = await signedIn('dean@abc.edu.in', DEMO_PASSWORDS.management);
    expect((await m.post(`/api/records/fdps/${id}/review`, { decision: 'Approved', remark: '' })).status).toBe(403);
    expect((await m.post(`/api/office/approvals/fdps/${id}/review`, { decision: 'Approved', remark: '' })).status).toBe(403);
    expect((await m.get('/api/office/approvals')).status).toBe(403);
    const mdata = (await m.get('/api/data')).body;
    expect(mdata.fdps.some((x) => x.id === id)).toBe(false);
    expect(mdata.publications.every((x) => x.status === 'Approved')).toBe(true);
    expect(store.tenant('abc').fdps.find((x) => x.id === id)!.status).toBe('Submitted');

    const a = await signedIn(ADMIN.email, ADMIN.password, '/api/admin/login');
    expect(((await a.get('/api/office/approvals/count')).body as unknown as { total: number }).total).toBeGreaterThan(0);
    const queue = (await a.get('/api/office/approvals')).body as unknown as { records: Record<string, { id: string }[]> };
    expect(queue.records.fdps.some((x) => x.id === id)).toBe(true);
    expect((await a.post(`/api/office/approvals/fdps/${id}/review`, { decision: 'Approved', remark: '' })).status).toBe(200);
    expect(store.tenant('abc').fdps.find((x) => x.id === id)!.status).toBe('Approved');
    expect((await m.get('/api/data')).body.fdps.some((x) => x.id === id)).toBe(true);
  });

  it('honours and awards are saved, checked and approved through the API', async () => {
    const me = facultyOf('abc', 0);
    const f = await signedIn(me.email, DEMO_PASSWORDS.faculty);
    const record = { category: 'Award', title: 'API test award', awardedBy: 'IEEE', level: 'International', awardDate: '2026-07-01', citation: '', prizeAmount: 0, certificateName: 'c.pdf' };
    expect((await f.post('/api/records/awards', { record: { ...record, category: 'Made up' }, submit: false })).status).toBe(400);
    const saved = await f.post('/api/records/awards', { record, submit: true });
    expect(saved.status).toBe(200);
    const id = saved.body.result as unknown as string;
    const a = await signedIn(ADMIN.email, ADMIN.password, '/api/admin/login');
    expect((await a.post(`/api/office/approvals/awards/${id}/review`, { decision: 'Approved', remark: '' })).status).toBe(200);
    expect(store.tenant('abc').awards.find((x) => x.id === id)!.status).toBe('Approved');
    // another institution's Office of Research cannot act on it
    const x = await signedIn(XYZ_OFFICE.email, XYZ_OFFICE.password);
    await x.post(`/api/office/approvals/awards/${id}/review`, { decision: 'Rejected', remark: 'x' });
    expect(store.tenant('abc').awards.find((r) => r.id === id)!.status).toBe('Approved');
  });

  it('intellectual property is entered by faculty, approved by the Office of Research and then visible to management', async () => {
    const me = facultyOf('abc', 0);
    const f = await signedIn(me.email, DEMO_PASSWORDS.faculty);
    const record = { ipType: 'Trademark', ipTypeOther: '', title: 'APITESTMARK', description: 'Name of the lab.', stage: 'Filed', applicationNumber: 'TM-API-1', filingDate: '2026-07-01', grantDate: '', office: 'Trade Marks Registry, India', owner: 'University', ownerOther: '', funding: '', licensed: false, licensee: '', coOwners: '', documentName: 'r.pdf', agreementName: '', declared: true };
    expect((await f.post('/api/records/ipr', { record: { ...record, stage: 'Registered' }, submit: false })).status).toBe(400);
    const saved = await f.post('/api/records/ipr', { record, submit: true });
    expect(saved.status).toBe(200);
    const id = saved.body.result as unknown as string;
    const m = await signedIn('director@abc.edu.in', DEMO_PASSWORDS.management);
    expect(((await m.get('/api/data')).body as unknown as { ipr: { id: string }[] }).ipr.some((x) => x.id === id)).toBe(false);
    expect((await m.post(`/api/office/approvals/ipr/${id}/review`, { decision: 'Approved', remark: '' })).status).toBe(403);
    const a = await signedIn(ADMIN.email, ADMIN.password, '/api/admin/login');
    expect((await a.post(`/api/office/approvals/ipr/${id}/review`, { decision: 'Approved', remark: '' })).status).toBe(200);
    expect(((await m.get('/api/data')).body as unknown as { ipr: { id: string }[] }).ipr.some((x) => x.id === id)).toBe(true);
  });
});

describe('read-only management and profile approval', () => {
  it('management cannot add or edit faculty or profiles, and sees only active faculty and approved data', async () => {
    const m = await signedIn('director@abc.edu.in', DEMO_PASSWORDS.management);
    const f = facultyOf('abc', 1);
    expect((await m.post('/api/faculty', { ...f, id: 'NEW1' })).status).toBe(403);
    expect((await m.call('PUT', `/api/faculty/${f.id}`, f)).status).toBe(403);
    expect((await m.post('/api/profile-changes', { biodata: {}, contact: f, submit: true })).status).toBe(403);
    const data = (await m.get('/api/data')).body;
    expect(data.faculty.every((x) => x.active)).toBe(true);
    expect(data.profileChanges).toEqual([]);
    expect((await m.call('PUT', '/api/settings', store.tenant('abc').settings)).status).toBe(403);
    expect((await m.post('/api/notices', { title: 'x', body: 'y' })).status).toBe(403);
  });

  it('a faculty profile update reaches the profile only after Office of Research approval', async () => {
    const me = facultyOf('abc', 0);
    const fc = await signedIn(me.email, DEMO_PASSWORDS.faculty);
    const bio = store.tenant('abc').biodata.find((b) => b.facultyId === me.id)!;
    const r = await fc.post('/api/profile-changes', { biodata: { ...bio, summary: 'API biography' }, contact: me, submit: true });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const id = r.body.result as unknown as string;
    expect(store.tenant('abc').biodata.find((b) => b.facultyId === me.id)!.summary).not.toBe('API biography');
    const m = await signedIn('director@abc.edu.in', DEMO_PASSWORDS.management);
    expect((await m.post(`/api/office/approvals/profiles/${id}/review`, { decision: 'Approved', remark: '' })).status).toBe(403);
    const a = await signedIn(ADMIN.email, ADMIN.password, '/api/admin/login');
    const queue = (await a.get('/api/office/approvals')).body as unknown as { profiles: { id: string }[] };
    expect(queue.profiles.some((c) => c.id === id)).toBe(true);
    expect((await a.post(`/api/office/approvals/profiles/${id}/review`, { decision: 'Approved', remark: '' })).status).toBe(200);
    expect(store.tenant('abc').biodata.find((b) => b.facultyId === me.id)!.summary).toBe('API biography');
    const decided = (await a.get('/api/office/approvals?view=decided')).body as unknown as { profiles: { id: string }[] };
    expect(decided.profiles.some((c) => c.id === id)).toBe(true);
  });
});

describe('Office of Research (one per institution)', () => {
  it('signs in on the same page as everyone; the role and institution come from the account', async () => {
    const r = await client().post('/api/login', ADMIN);
    expect(r.status).toBe(200);
    expect((r.body as unknown as { user: { role: string; institutionId: string } }).user).toMatchObject({ role: 'office', institutionId: 'abc' });
    expect((await client().post('/api/admin/login', { email: 'director@abc.edu.in', password: DEMO_PASSWORDS.management })).status).toBe(401);
  });

  it('sees its own institution’s data and users only', async () => {
    const a = await signedIn(ADMIN.email, ADMIN.password);
    expect((await a.get('/api/data')).body.settings.institutionName).toBe('ABC Institute of Technology');
    const users = (await a.get('/api/office/users')).body as unknown as Record<string, unknown>[];
    expect(users.length).toBeGreaterThan(0);
    expect(users.every((u) => u.institutionId === 'abc' && !('password_hash' in u) && !('passwordHash' in u))).toBe(true);
    const xyzUser = store.platform.prepare("SELECT id FROM accounts WHERE institution_id = 'xyz' AND role = 'faculty'").get() as { id: string };
    expect((await a.post(`/api/office/users/${xyzUser.id}/status`, { status: 'suspended', reason: 'x' })).status).toBe(404);
    expect((await a.post(`/api/office/users/${xyzUser.id}/reset-password`, {})).status).toBe(404);
  });

  it('administers institution settings and notices; management cannot', async () => {
    const a = await signedIn(ADMIN.email, ADMIN.password);
    const settings = store.tenant('abc').settings;
    expect((await a.call('PUT', '/api/settings', { ...settings, institutionTagline: 'Updated by the Office' })).status).toBe(200);
    expect(store.tenant('abc').settings.institutionTagline).toBe('Updated by the Office');
    expect((await a.post('/api/notices', { title: 'Office notice', body: 'x' })).status).toBe(200);
    const m = await signedIn('director@abc.edu.in', DEMO_PASSWORDS.management);
    expect((await m.call('PUT', '/api/settings', settings)).status).toBe(403);
  });

  it('edits official faculty details and deactivates a faculty member; management cannot', async () => {
    const f = facultyOf('abc', 1);
    const m = await signedIn('director@abc.edu.in', DEMO_PASSWORDS.management);
    expect((await m.call('PUT', `/api/faculty/${f.id}`, { ...f, active: false })).status).toBe(403);
    const a = await signedIn(ADMIN.email, ADMIN.password);
    expect((await a.call('PUT', `/api/faculty/${f.id}`, { ...f, active: false })).status).toBe(200);
    expect((await client().post('/api/login', { email: f.email, password: DEMO_PASSWORDS.faculty })).status).toBe(403);
    expect((await m.get('/api/data')).body.faculty.some((x) => x.id === f.id)).toBe(false);
    expect((await a.call('PUT', `/api/faculty/${f.id}`, { ...f, active: true })).status).toBe(200);
  });

  it('non-office users cannot reach Office of Research endpoints', async () => {
    const m = await signedIn('director@abc.edu.in', DEMO_PASSWORDS.management);
    expect((await m.get('/api/office/users')).status).toBe(403);
    expect((await m.get('/api/office/audit')).status).toBe(403);
    expect((await client().get('/api/office/users')).status).toBe(401);
  });
});

describe('accounts are created by the Office of Research', () => {
  it('self-registration is closed', async () => {
    const r = await client().post('/api/register', { institutionId: 'abc', role: 'faculty', name: 'X', email: 'x@abc.edu.in', password: 'Whatever123' });
    expect(r.status).toBe(410);
  });

  it('the Office of Research creates a faculty account; the person signs in with the temporary password', async () => {
    const email = 'new.person@abc.edu.in';
    const m = await signedIn('director@abc.edu.in', DEMO_PASSWORDS.management);
    expect((await m.post('/api/office/users', { role: 'faculty', name: 'New Person', email })).status).toBe(403);
    const a = await signedIn(ADMIN.email, ADMIN.password, '/api/admin/login');
    const dept = store.tenant('abc').settings.departments[0];
    expect((await a.post('/api/office/users', { role: 'faculty', name: 'New Person', email, department: dept })).status).toBe(400); // no employee code
    const r = await a.post('/api/office/users', { role: 'faculty', title: 'Dr.', name: 'New Person', email, employeeCode: 'EMP9001', department: dept, designation: 'Assistant Professor' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const temp = (r.body as unknown as { temporaryPassword: string }).temporaryPassword;
    expect((await a.post('/api/office/users', { role: 'management', name: 'Dup', email })).status).toBe(400); // email taken
    const u = await signedIn(email, temp);
    const session = (await u.get('/api/session')).body as unknown as { user: { role: string; institutionId: string; facultyId: string } };
    expect(session.user).toMatchObject({ role: 'faculty', institutionId: 'abc', facultyId: 'EMP9001' });
    expect(store.tenant('abc').faculty.some((f) => f.id === 'EMP9001')).toBe(true);
    expect(store.tenant('xyz').faculty.some((f) => f.email === email)).toBe(false);
  });

  it('suspending a user ends their session immediately', async () => {
    const me = facultyOf('xyz', 1);
    const u = await signedIn(me.email, DEMO_PASSWORDS.faculty);
    expect((await u.get('/api/data')).status).toBe(200);
    const a = await signedIn(XYZ_OFFICE.email, XYZ_OFFICE.password);
    const acc = ((await a.get('/api/office/users')).body as unknown as { id: string; email: string }[]).find((x) => x.email === me.email)!;
    expect((await a.post(`/api/office/users/${acc.id}/status`, { status: 'suspended', reason: 'Test' })).status).toBe(200);
    expect((await u.get('/api/data')).status).toBe(401);
    expect((await client().post('/api/login', { email: me.email, password: DEMO_PASSWORDS.faculty })).status).toBe(403);
  });

  it('a suspended institution cannot be used', async () => {
    // suspension is done by the UniRise team (npm run provision -- suspend xyz)
    store.platform.prepare("UPDATE institutions SET status = 'suspended' WHERE id = 'xyz'").run();
    expect((await client().post('/api/login', { email: 'vc@xyz.ac.in', password: DEMO_PASSWORDS.management })).status).toBe(403);
    expect((await client().post('/api/login', XYZ_OFFICE)).status).toBe(403);
    store.platform.prepare("UPDATE institutions SET status = 'active' WHERE id = 'xyz'").run();
    expect((await client().post('/api/login', { email: 'vc@xyz.ac.in', password: DEMO_PASSWORDS.management })).status).toBe(200);
  });
});

describe('Talk to Our Team enquiries', () => {
  it('are validated, stored and emailed to corporate@mentoredge.co.in', async () => {
    expect((await client().post('/api/enquiries', { institutionName: 'PQR College' })).status).toBe(400);
    const e = { institutionName: 'PQR College', institutionType: 'Autonomous College', country: 'India', state: 'Karnataka', city: 'Mysuru', contactName: 'Contact P', designation: 'Dean', email: 'dean@pqr.edu.in', phone: '+91 98450 00000', facultyCount: '50 – 200', interest: 'UniRise institutional partnership', message: 'Interested.', consent: 'yes' };
    expect((await client().post('/api/enquiries', { ...e, email: 'not-an-email' })).status).toBe(400);
    expect((await client().post('/api/enquiries', e)).status).toBe(200);
    const mail = sentMail.at(-1)!;
    expect(mail.to).toBe('corporate@mentoredge.co.in');
    expect(mail.text).toContain('PQR College');
    const row = store.platform.prepare('SELECT data, delivered FROM enquiries ORDER BY id DESC').get() as { data: string; delivered: number };
    expect(JSON.parse(row.data).email).toBe('dean@pqr.edu.in');
    expect(row.delivered).toBe(1);
  });
});

describe('request hygiene', () => {
  it('rejects state-changing requests without the custom header (CSRF)', async () => {
    const m = await signedIn('director@abc.edu.in', DEMO_PASSWORDS.management);
    expect((await m.call('POST', '/api/notices', { title: 'x' }, {})).status).toBe(403);
  });

  it('locks an email after repeated wrong passwords', async () => {
    const c = client();
    for (let i = 0; i < 5; i++) await c.post('/api/login', { email: 'registrar@xyz.ac.in', password: 'wrong' });
    expect((await c.post('/api/login', { email: 'registrar@xyz.ac.in', password: DEMO_PASSWORDS.management })).status).toBe(429);
  });

  it('data survives a restart (it is on disk, per institution)', () => {
    const fresh = new Storage(dir);
    expect(fresh.tenant('abc').faculty.length).toBe(store.tenant('abc').faculty.length);
    fresh.close();
  });
});
