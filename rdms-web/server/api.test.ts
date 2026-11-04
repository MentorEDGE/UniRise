/**
 * End-to-end tests of the HTTP API: institution isolation, role permissions, the IT Admin approval workflow
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
const ADMIN = { email: 'it.admin@unirise.platform', password: 'Admin-Test-1' };

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rdms-test-'));
  store = new Storage(dir);
  seedDemo(store, { small: true, adminPassword: ADMIN.password });
  server = createApp(store).listen(0);
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
    const c = await signedIn('director@sit.edu.in', DEMO_PASSWORDS.management);
    const data = (await c.get('/api/data')).body;
    expect(data.settings.institutionName).toBe('Sample Institute of Technology');
    expect(data.faculty.every((f) => f.email.endsWith('@sit.edu.in'))).toBe(true);
    const greenEmails = new Set(store.tenant('greenfield').faculty.map((f) => f.email));
    expect(data.faculty.some((f) => greenEmails.has(f.email))).toBe(false);
  });

  it('a record id from another institution is simply not found', async () => {
    // Ids are numbered per institution, so pick one that exists only in Greenfield: a 404 then proves isolation.
    const sitIds = new Set(store.tenant('sit').fdps.map((x) => x.id));
    const greenRecord = store.tenant('greenfield').fdps.find((x) => !sitIds.has(x.id))!;
    expect(greenRecord).toBeDefined();
    const c = await signedIn('director@sit.edu.in', DEMO_PASSWORDS.management);
    const r = await c.post(`/api/records/fdps/${greenRecord.id}/review`, { decision: 'Rejected', remark: 'x' });
    expect(r.status).toBe(404);
    expect(store.tenant('greenfield').fdps.find((x) => x.id === greenRecord.id)!.status).toBe(greenRecord.status);
  });

  it('the client cannot choose the institution', async () => {
    const c = await signedIn('director@sit.edu.in', DEMO_PASSWORDS.management);
    const r = await c.get('/api/data?institution=greenfield');
    expect(r.body.settings.institutionName).toBe('Sample Institute of Technology');
  });

  it('each institution has its own database file', () => {
    expect(fs.existsSync(path.join(dir, 'tenants', 'sit.sqlite'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'tenants', 'greenfield.sqlite'))).toBe(true);
  });
});

describe('faculty access', () => {
  it('receives only own private records and colleagues’ approved publications', async () => {
    const me = facultyOf('sit', 0);
    const c = await signedIn(me.email, DEMO_PASSWORDS.faculty);
    const data = (await c.get('/api/data')).body;
    expect(data.fdps.every((x) => x.facultyId === me.id)).toBe(true);
    expect(data.conferences.every((x) => x.facultyId === me.id)).toBe(true);
    expect(data.biodata.map((b) => b.facultyId)).toEqual([me.id]);
    expect(data.publications.every((p) => p.status === 'Approved' || p.facultyId === me.id || p.authors.some((a) => a.code === me.id))).toBe(true);
  });

  it('cannot act as management or touch another faculty member’s entry', async () => {
    const me = facultyOf('sit', 0);
    const other = store.tenant('sit').fdps.find((x) => x.facultyId !== me.id && x.status === 'Draft') ?? store.tenant('sit').fdps.find((x) => x.facultyId !== me.id)!;
    const c = await signedIn(me.email, DEMO_PASSWORDS.faculty);
    expect((await c.call('PUT', '/api/settings', store.tenant('sit').settings)).status).toBe(403);
    expect((await c.post(`/api/records/fdps/${other.id}/review`, { decision: 'Approved', remark: '' })).status).toBe(403);
    expect((await c.call('DELETE', `/api/records/fdps/${other.id}`)).status).toBe(404);
    expect((await c.call('PUT', `/api/biodata/${other.facultyId}`, { facultyId: other.facultyId })).status).toBe(403);
  });

  it('a submitted entry can be approved by management of the same institution', async () => {
    const me = facultyOf('sit', 0);
    const f = await signedIn(me.email, DEMO_PASSWORDS.faculty);
    const saved = await f.post('/api/records/fdps', { record: { role: 'Attended', programmeType: 'FDP', title: 'API test', organiser: 'NPTEL', mode: 'Online', level: 'National', fromDate: '2026-07-01', toDate: '2026-07-02', hours: 12, certificateName: 'c.pdf' }, submit: true });
    expect(saved.status).toBe(200);
    const id = saved.body.result as unknown as string;
    const m = await signedIn('dean@sit.edu.in', DEMO_PASSWORDS.management);
    expect((await m.post(`/api/records/fdps/${id}/review`, { decision: 'Approved', remark: '' })).status).toBe(200);
    expect(store.tenant('sit').fdps.find((x) => x.id === id)!.status).toBe('Approved');
  });
});

describe('IT Admin', () => {
  it('cannot use the regular sign-in, and others cannot use the admin one', async () => {
    expect((await client().post('/api/login', ADMIN)).status).toBe(401);
    expect((await client().post('/api/admin/login', { email: 'director@sit.edu.in', password: DEMO_PASSWORDS.management })).status).toBe(401);
  });

  it('manages access but cannot read institution data', async () => {
    const a = await signedIn(ADMIN.email, ADMIN.password, '/api/admin/login');
    expect((await a.get('/api/data')).status).toBe(403);
    expect((await a.get('/api/admin/institutions')).status).toBe(200);
    const users = (await a.get('/api/admin/users')).body as unknown as Record<string, unknown>[];
    expect(users.every((u) => !('password_hash' in u) && !('passwordHash' in u))).toBe(true);
  });

  it('non-admins cannot reach admin endpoints', async () => {
    const m = await signedIn('director@sit.edu.in', DEMO_PASSWORDS.management);
    expect((await m.get('/api/admin/requests')).status).toBe(403);
    expect((await client().get('/api/admin/requests')).status).toBe(401);
  });
});

describe('registration and approval', () => {
  it('pending users cannot sign in until approved; approval links the institution and role', async () => {
    const email = 'new.person@sit.edu.in';
    expect((await client().post('/api/register', { institutionId: 'sit', role: 'faculty', title: 'Dr.', name: 'New Person', email, password: 'Newpass123', employeeCode: 'EMP9001', department: store.tenant('sit').settings.departments[0], designation: 'Assistant Professor' })).status).toBe(200);
    const blocked = await client().post('/api/login', { email, password: 'Newpass123' });
    expect(blocked.status).toBe(403);
    expect(String(blocked.body.error)).toMatch(/waiting for approval/);

    const a = await signedIn(ADMIN.email, ADMIN.password, '/api/admin/login');
    const req = ((await a.get('/api/admin/requests')).body as unknown as { id: string; email: string }[]).find((r) => r.email === email)!;
    expect((await a.post(`/api/admin/requests/${req.id}/approve`, { institutionId: 'sit', role: 'faculty' })).status).toBe(400); // affiliation not confirmed
    expect((await a.post(`/api/admin/requests/${req.id}/approve`, { institutionId: 'sit', role: 'faculty', affiliationVerified: true })).status).toBe(200);

    const u = await signedIn(email, 'Newpass123');
    const session = (await u.get('/api/session')).body as unknown as { user: { role: string; institutionId: string; facultyId: string } };
    expect(session.user).toMatchObject({ role: 'faculty', institutionId: 'sit', facultyId: 'EMP9001' });
    expect(store.tenant('sit').faculty.some((f) => f.id === 'EMP9001')).toBe(true);
    expect(store.tenant('greenfield').faculty.some((f) => f.email === email)).toBe(false);
  });

  it('rejected requests cannot sign in, and registration does not reveal existing emails', async () => {
    const dup = await client().post('/api/register', { institutionId: 'sit', role: 'management', name: 'X', email: 'director@sit.edu.in', password: 'Whatever123', designation: 'X' });
    expect(dup.status).toBe(200);
    const email = 'outsider@gmail.com';
    await client().post('/api/register', { institutionId: 'greenfield', role: 'management', name: 'Outsider', email, password: 'Outside123', designation: 'Dean' });
    const a = await signedIn(ADMIN.email, ADMIN.password, '/api/admin/login');
    const req = ((await a.get('/api/admin/requests')).body as unknown as { id: string; email: string }[]).find((r) => r.email === email)!;
    expect((await a.post(`/api/admin/requests/${req.id}/reject`, { reason: '' })).status).toBe(400);
    expect((await a.post(`/api/admin/requests/${req.id}/reject`, { reason: 'Not affiliated' })).status).toBe(200);
    expect(String((await client().post('/api/login', { email, password: 'Outside123' })).body.error)).toMatch(/not approved/);
  });

  it('suspending a user ends their session immediately', async () => {
    const me = facultyOf('greenfield', 1);
    const u = await signedIn(me.email, DEMO_PASSWORDS.faculty);
    expect((await u.get('/api/data')).status).toBe(200);
    const a = await signedIn(ADMIN.email, ADMIN.password, '/api/admin/login');
    const acc = ((await a.get('/api/admin/users')).body as unknown as { id: string; email: string }[]).find((x) => x.email === me.email)!;
    expect((await a.post(`/api/admin/users/${acc.id}/status`, { status: 'suspended', reason: 'Test' })).status).toBe(200);
    expect((await u.get('/api/data')).status).toBe(401);
    expect((await client().post('/api/login', { email: me.email, password: DEMO_PASSWORDS.faculty })).status).toBe(403);
  });

  it('a suspended institution cannot be used', async () => {
    const a = await signedIn(ADMIN.email, ADMIN.password, '/api/admin/login');
    await a.post('/api/admin/institutions/greenfield/status', { status: 'suspended' });
    expect((await client().post('/api/login', { email: 'vc@greenfield.ac.in', password: DEMO_PASSWORDS.management })).status).toBe(403);
    await a.post('/api/admin/institutions/greenfield/status', { status: 'active' });
    expect((await client().post('/api/login', { email: 'vc@greenfield.ac.in', password: DEMO_PASSWORDS.management })).status).toBe(200);
  });
});

describe('request hygiene', () => {
  it('rejects state-changing requests without the custom header (CSRF)', async () => {
    const m = await signedIn('director@sit.edu.in', DEMO_PASSWORDS.management);
    expect((await m.call('POST', '/api/notices', { title: 'x' }, {})).status).toBe(403);
  });

  it('locks an email after repeated wrong passwords', async () => {
    const c = client();
    for (let i = 0; i < 5; i++) await c.post('/api/login', { email: 'registrar@greenfield.ac.in', password: 'wrong' });
    expect((await c.post('/api/login', { email: 'registrar@greenfield.ac.in', password: DEMO_PASSWORDS.management })).status).toBe(429);
  });

  it('data survives a restart (it is on disk, per institution)', () => {
    const fresh = new Storage(dir);
    expect(fresh.tenant('sit').faculty.length).toBe(store.tenant('sit').faculty.length);
    fresh.close();
  });
});
