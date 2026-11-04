import crypto from 'node:crypto';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import * as rules from '../src/lib/domain';
import type { Actor } from '../src/lib/domain';
import { RuleError } from '../src/lib/domain';
import { emptyInstitution } from '../src/lib/seed';
import type { EntityKind, Institution, User } from '../src/lib/types';
import {
  burnPasswordCheck, createSession, endAllSessions, endSession, hashPassword, passwordProblem, randomPassword, readSession, SESSION_COOKIE,
  Throttle, verifyPassword,
} from './auth';
import type { AccountRow, Storage } from './storage';

declare module 'express-serve-static-core' {
  interface Request { account?: AccountRow; actor?: Actor; institutionId?: string }
}

const KINDS: EntityKind[] = ['publications', 'grants', 'seedMoney', 'fdps', 'conferences'];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const s = (v: unknown, max = 300) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export function toUser(a: AccountRow): User {
  return { id: a.id, email: a.email, name: a.name, role: a.role, status: a.status, institutionId: a.institution_id, facultyId: a.faculty_id ?? undefined, designation: a.designation };
}

export function createApp(store: Storage, opts: { secureCookies?: boolean } = {}) {
  const app = express();
  const loginByEmail = new Throttle(5);
  const loginByIp = new Throttle(20);
  const registerByIp = new Throttle(10, 60 * 60_000);

  app.disable('x-powered-by');
  app.set('trust proxy', false);
  app.use((_req, res, next) => {
    res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'DENY', 'Cache-Control': 'no-store' });
    next();
  });
  app.use('/api', express.json({ limit: '1mb' }));

  // CSRF: the session cookie is SameSite=Strict, and every state-changing call must carry a custom header,
  // which a cross-site form or image cannot send.
  app.use('/api', (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.get('X-RDMS') !== '1') return res.status(403).json({ error: 'Missing request header.' });
    next();
  });

  // Session → account
  app.use('/api', (req, _res, next) => {
    const token = cookie(req, SESSION_COOKIE);
    req.account = readSession(store, token) ?? undefined;
    next();
  });

  const setCookie = (res: Response, token: string) =>
    res.append('Set-Cookie', `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/${opts.secureCookies ? '; Secure' : ''}`);
  const clearCookie = (res: Response) => res.append('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);

  /** Institution users only. The institution comes from the account, never from the request. */
  const institutionUser = (req: Request, res: Response, next: NextFunction) => {
    const a = req.account;
    if (!a) return res.status(401).json({ error: 'Please sign in.' });
    if (a.role === 'it_admin' || !a.institution_id) return res.status(403).json({ error: 'Institution data is not available to platform administrators.' });
    const inst = store.institution(a.institution_id);
    if (!inst || inst.status !== 'active') return res.status(403).json({ error: 'Your institution’s access is suspended. Contact the platform administrator.' });
    if (a.role === 'faculty') {
      const f = store.tenant(inst.id).faculty.find((x) => x.id === a.faculty_id);
      if (!f || !f.active) return res.status(403).json({ error: 'Your faculty profile is inactive. Contact your institution.' });
      req.actor = { userId: a.id, name: f.name, role: 'faculty', facultyId: f.id };
    } else {
      req.actor = { userId: a.id, name: a.name, role: 'management' };
    }
    req.institutionId = inst.id;
    next();
  };
  const itAdmin = (req: Request, res: Response, next: NextFunction) => {
    if (!req.account) return res.status(401).json({ error: 'Please sign in.' });
    if (req.account.role !== 'it_admin') return res.status(403).json({ error: 'Not allowed.' });
    next();
  };

  /** Runs a rule against the caller's own institution database and saves the result. */
  const tenantAction = (fn: (db: Parameters<typeof rules.saveRecord>[0], actor: Actor, req: Request) => unknown) => (req: Request, res: Response) => {
    const result = store.mutateTenant(req.institutionId!, (db) => fn(db, req.actor!, req));
    res.json({ ok: true, result: result ?? null });
  };
  const kindParam = (req: Request): EntityKind => {
    const k = String(req.params.kind) as EntityKind;
    if (!KINDS.includes(k)) throw new RuleError(404, 'Not found.');
    return k;
  };

  // ---------- public ----------

  app.get('/api/public/institutions', (_req, res) => {
    res.json(store.institutions().filter((i) => i.status === 'active').map((i) => ({ id: i.id, name: i.name })));
  });
  app.get('/api/public/institutions/:id/departments', (req, res) => {
    const inst = store.institution(String(req.params.id));
    if (!inst || inst.status !== 'active') return res.status(404).json({ error: 'Institution not found.' });
    res.json(store.tenant(inst.id).settings.departments);
  });

  app.post('/api/register', (req, res) => {
    const ip = req.ip ?? '';
    if (registerByIp.blocked(ip)) return res.status(429).json({ error: 'Too many requests. Try again later.' });
    registerByIp.fail(ip);
    const b = req.body ?? {};
    const role = b.role === 'management' ? 'management' : b.role === 'faculty' ? 'faculty' : '';
    const email = s(b.email, 200).toLowerCase();
    const name = s(b.name, 200);
    const password = typeof b.password === 'string' ? b.password : '';
    const inst = store.institution(s(b.institutionId, 40));
    if (!role) return res.status(400).json({ error: 'Choose Faculty or Top-Level Management.' });
    if (!inst || inst.status !== 'active') return res.status(400).json({ error: 'Choose your institution.' });
    if (!name) return res.status(400).json({ error: 'Enter your full name.' });
    if (!EMAIL.test(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
    const pwErr = passwordProblem(password);
    if (pwErr) return res.status(400).json({ error: pwErr });
    const department = s(b.department, 200);
    const employeeCode = s(b.employeeCode, 20);
    if (role === 'faculty') {
      if (!/^[A-Za-z0-9-]{3,20}$/.test(employeeCode)) return res.status(400).json({ error: 'Enter your employee code (3-20 letters or digits).' });
      if (!store.tenant(inst.id).settings.departments.includes(department)) return res.status(400).json({ error: 'Choose your department.' });
    }
    // The same answer whether or not the email is already known, so the form cannot be used to find accounts.
    const exists = store.platform.prepare('SELECT 1 FROM accounts WHERE email = ?').get(email);
    if (!exists) {
      const id = `acc_${crypto.randomBytes(8).toString('hex')}`;
      store.platform.prepare(`INSERT INTO accounts (id, email, password_hash, role, institution_id, status, name, title, designation, department, employee_code, request_note, requested_at)
        VALUES (?,?,?,?,?,'pending',?,?,?,?,?,?,?)`).run(id, email, hashPassword(password), role, inst.id, name, s(b.title, 10), s(b.designation, 100), department, employeeCode, s(b.note, 500), new Date().toISOString());
      store.audit({ action: 'Access requested', target: email, institutionId: inst.id, detail: role });
    } else {
      store.audit({ action: 'Duplicate access request ignored', target: email, institutionId: inst.id });
    }
    res.json({ ok: true });
  });

  // ---------- sign in ----------

  const signIn = (admin: boolean) => (req: Request, res: Response) => {
    const email = s(req.body?.email, 200).toLowerCase();
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const ip = req.ip ?? '';
    if (loginByEmail.blocked(email) || loginByIp.blocked(ip)) return res.status(429).json({ error: 'Too many failed attempts. Try again in 15 minutes.' });
    const acc = store.platform.prepare('SELECT * FROM accounts WHERE email = ?').get(email) as AccountRow | undefined;
    // IT Admin accounts cannot use the regular sign-in, and other accounts cannot use the admin one.
    const eligible = acc && (acc.role === 'it_admin') === admin;
    if (!acc || !eligible) burnPasswordCheck(password);
    if (!acc || !eligible || !verifyPassword(password, acc.password_hash)) {
      loginByEmail.fail(email); loginByIp.fail(ip);
      if (admin) store.audit({ action: 'Admin sign-in failed', target: email });
      return res.status(401).json({ error: 'Invalid email or password.' });
    }
    loginByEmail.clear(email);
    const msg: Record<string, string> = {
      pending: 'Your access request is waiting for approval by the platform administrator.',
      rejected: 'Your access request was not approved. Contact the platform administrator if you think this is a mistake.',
      suspended: 'Your account is suspended. Contact the platform administrator.',
      deactivated: 'Your account has been deactivated.',
    };
    if (acc.status !== 'active') return res.status(403).json({ error: msg[acc.status] });
    if (acc.institution_id) {
      const inst = store.institution(acc.institution_id);
      if (!inst || inst.status !== 'active') return res.status(403).json({ error: 'Your institution’s access is suspended. Contact the platform administrator.' });
      if (acc.role === 'faculty' && !store.tenant(inst.id).faculty.find((f) => f.id === acc.faculty_id)?.active) return res.status(403).json({ error: 'Your faculty profile is inactive. Contact your institution.' });
    }
    const old = cookie(req, SESSION_COOKIE);
    if (old) endSession(store, old);
    setCookie(res, createSession(store, acc.id, admin));
    if (admin) store.audit({ actorId: acc.id, actorName: acc.name, action: 'Admin signed in' });
    res.json({ user: toUser(acc), institution: acc.institution_id ? store.institution(acc.institution_id) : null });
  };
  app.post('/api/login', signIn(false));
  app.post('/api/admin/login', signIn(true));

  app.post('/api/logout', (req, res) => {
    const t = cookie(req, SESSION_COOKIE);
    if (t) endSession(store, t);
    clearCookie(res);
    res.json({ ok: true });
  });

  app.get('/api/session', (req, res) => {
    if (!req.account) return res.status(401).json({ error: 'Not signed in.' });
    res.json({ user: toUser(req.account), institution: req.account.institution_id ? store.institution(req.account.institution_id) : null });
  });

  app.post('/api/account/password', (req, res) => {
    const a = req.account;
    if (!a) return res.status(401).json({ error: 'Please sign in.' });
    const cur = typeof req.body?.current === 'string' ? req.body.current : '';
    const next = typeof req.body?.next === 'string' ? req.body.next : '';
    if (!verifyPassword(cur, a.password_hash)) return res.status(400).json({ error: 'Current password is incorrect.' });
    const p = passwordProblem(next);
    if (p) return res.status(400).json({ error: p });
    store.platform.prepare('UPDATE accounts SET password_hash = ? WHERE id = ?').run(hashPassword(next), a.id);
    // Sign out every other session of this account.
    const t = cookie(req, SESSION_COOKIE)!;
    store.platform.prepare('DELETE FROM sessions WHERE account_id = ? AND token_hash != ?').run(a.id, crypto.createHash('sha256').update(t).digest('hex'));
    res.json({ ok: true });
  });

  // ---------- institution data (management and faculty) ----------

  app.get('/api/data', institutionUser, (req, res) => {
    res.json(rules.scopeFor(store.tenant(req.institutionId!), req.actor!));
  });
  app.post('/api/records/:kind', institutionUser, tenantAction((db, actor, req) => rules.saveRecord(db, actor, kindParam(req), req.body?.record ?? {}, req.body?.submit === true)));
  app.delete('/api/records/:kind/:id', institutionUser, tenantAction((db, actor, req) => rules.deleteRecord(db, actor, kindParam(req), String(req.params.id))));
  app.post('/api/records/:kind/:id/review', institutionUser, tenantAction((db, actor, req) =>
    rules.review(db, actor, kindParam(req), String(req.params.id), req.body?.decision, s(req.body?.remark, 1000), req.body?.sanctionedAmount)));
  app.post('/api/grants/:id/outcome', institutionUser, tenantAction((db, actor, req) => rules.updateGrantOutcome(db, actor, String(req.params.id), req.body ?? {})));
  app.put('/api/biodata/:facultyId', institutionUser, tenantAction((db, actor, req) => rules.saveBiodata(db, actor, { ...(req.body ?? {}), facultyId: String(req.params.facultyId) })));
  app.post('/api/faculty', institutionUser, tenantAction((db, actor, req) => rules.saveFaculty(db, actor, req.body ?? {}, true)));
  app.put('/api/faculty/:id', institutionUser, tenantAction((db, actor, req) => rules.saveFaculty(db, actor, { ...(req.body ?? {}), id: String(req.params.id) }, false)));
  app.put('/api/settings', institutionUser, tenantAction((db, actor, req) => rules.saveSettings(db, actor, req.body ?? {})));
  app.post('/api/notices', institutionUser, tenantAction((db, actor, req) => rules.addNotice(db, actor, req.body?.title, req.body?.body)));
  app.delete('/api/notices/:id', institutionUser, tenantAction((db, actor, req) => rules.deleteNotice(db, actor, String(req.params.id))));

  // ---------- IT Admin (platform level: accounts and institutions, never research data) ----------

  app.get('/api/admin/requests', itAdmin, (req, res) => {
    const status = ['pending', 'rejected'].includes(String(req.query.status)) ? String(req.query.status) : 'pending';
    res.json((store.platform.prepare('SELECT * FROM accounts WHERE status = ? ORDER BY requested_at').all(status) as AccountRow[]).map(requestView));
  });

  app.post('/api/admin/requests/:id/approve', itAdmin, (req, res) => {
    const acc = store.platform.prepare('SELECT * FROM accounts WHERE id = ?').get(String(req.params.id)) as AccountRow | undefined;
    if (!acc || acc.role === 'it_admin') return res.status(404).json({ error: 'Request not found.' });
    if (acc.status !== 'pending') return res.status(400).json({ error: 'This request has already been decided.' });
    const b = req.body ?? {};
    if (b.affiliationVerified !== true) return res.status(400).json({ error: 'Confirm that you verified the person’s affiliation with the institution.' });
    const role = b.role === 'management' ? 'management' : b.role === 'faculty' ? 'faculty' : acc.role;
    const inst = store.institution(s(b.institutionId, 40) || acc.institution_id || '');
    if (!inst || inst.status !== 'active') return res.status(400).json({ error: 'Choose an active institution.' });
    let facultyId: string | null = null;
    if (role === 'faculty') {
      const code = s(b.employeeCode, 20) || acc.employee_code;
      facultyId = store.mutateTenant(inst.id, (db) => rules.ensureFacultyProfile(db, {
        id: code, title: s(b.title, 10) || acc.title, name: acc.name, designation: s(b.designation, 100) || acc.designation,
        department: s(b.department, 200) || acc.department, email: acc.email,
      }));
      const taken = store.platform.prepare("SELECT 1 FROM accounts WHERE institution_id = ? AND faculty_id = ? AND status IN ('active','suspended') AND id != ?").get(inst.id, facultyId, acc.id);
      if (taken) return res.status(400).json({ error: `Faculty profile ${facultyId} is already linked to another account.` });
    }
    store.platform.prepare(`UPDATE accounts SET status = 'active', role = ?, institution_id = ?, faculty_id = ?, designation = ?, reviewed_by = ?, reviewed_at = ?, review_note = ?, affiliation_verified = 1 WHERE id = ?`)
      .run(role, inst.id, facultyId, s(b.designation, 100) || acc.designation, req.account!.name, new Date().toISOString(), s(b.note, 500), acc.id);
    store.audit({ actorId: req.account!.id, actorName: req.account!.name, action: 'Access approved', target: acc.email, institutionId: inst.id, detail: `${role}${facultyId ? ` · profile ${facultyId}` : ''}` });
    res.json({ ok: true });
  });

  app.post('/api/admin/requests/:id/reject', itAdmin, (req, res) => {
    const acc = store.platform.prepare('SELECT * FROM accounts WHERE id = ?').get(String(req.params.id)) as AccountRow | undefined;
    if (!acc || acc.role === 'it_admin') return res.status(404).json({ error: 'Request not found.' });
    if (acc.status !== 'pending') return res.status(400).json({ error: 'This request has already been decided.' });
    const reason = s(req.body?.reason, 500);
    if (!reason) return res.status(400).json({ error: 'Give a reason for the rejection.' });
    store.platform.prepare("UPDATE accounts SET status = 'rejected', reviewed_by = ?, reviewed_at = ?, review_note = ? WHERE id = ?").run(req.account!.name, new Date().toISOString(), reason, acc.id);
    store.audit({ actorId: req.account!.id, actorName: req.account!.name, action: 'Access rejected', target: acc.email, institutionId: acc.institution_id, detail: reason });
    res.json({ ok: true });
  });

  app.get('/api/admin/users', itAdmin, (_req, res) => {
    res.json((store.platform.prepare("SELECT * FROM accounts WHERE status NOT IN ('pending','rejected') ORDER BY role = 'it_admin' DESC, institution_id, name").all() as AccountRow[]).map(requestView));
  });

  app.post('/api/admin/users/:id/status', itAdmin, (req, res) => {
    const acc = store.platform.prepare('SELECT * FROM accounts WHERE id = ?').get(String(req.params.id)) as AccountRow | undefined;
    if (!acc || ['pending', 'rejected'].includes(acc.status)) return res.status(404).json({ error: 'User not found.' });
    if (acc.role === 'it_admin') return res.status(400).json({ error: 'IT Admin accounts are managed from the server command line.' });
    const status = String(req.body?.status);
    if (!['active', 'suspended', 'deactivated'].includes(status)) return res.status(400).json({ error: 'Unknown status.' });
    const reason = s(req.body?.reason, 500);
    if (status !== 'active' && !reason) return res.status(400).json({ error: 'Give a reason.' });
    if (status === 'active' && acc.faculty_id) {
      const taken = store.platform.prepare("SELECT 1 FROM accounts WHERE institution_id = ? AND faculty_id = ? AND status IN ('active','suspended') AND id != ?").get(acc.institution_id, acc.faculty_id, acc.id);
      if (taken) return res.status(400).json({ error: 'Another account is already linked to this faculty profile.' });
    }
    store.platform.prepare('UPDATE accounts SET status = ? WHERE id = ?').run(status, acc.id);
    if (status !== 'active') endAllSessions(store, acc.id);
    store.audit({ actorId: req.account!.id, actorName: req.account!.name, action: `Account ${status === 'active' ? 'activated' : status}`, target: acc.email, institutionId: acc.institution_id, detail: reason });
    res.json({ ok: true });
  });

  app.post('/api/admin/users/:id/role', itAdmin, (req, res) => {
    const acc = store.platform.prepare('SELECT * FROM accounts WHERE id = ?').get(String(req.params.id)) as AccountRow | undefined;
    if (!acc || acc.role === 'it_admin' || ['pending', 'rejected'].includes(acc.status)) return res.status(404).json({ error: 'User not found.' });
    const role = req.body?.role === 'management' ? 'management' : req.body?.role === 'faculty' ? 'faculty' : '';
    if (!role) return res.status(400).json({ error: 'Unknown role.' });
    if (role === 'faculty' && !acc.faculty_id) return res.status(400).json({ error: 'This account has no faculty profile. Ask the person to request faculty access instead.' });
    store.platform.prepare('UPDATE accounts SET role = ? WHERE id = ?').run(role, acc.id);
    endAllSessions(store, acc.id);
    store.audit({ actorId: req.account!.id, actorName: req.account!.name, action: `Role changed to ${role}`, target: acc.email, institutionId: acc.institution_id });
    res.json({ ok: true });
  });

  app.post('/api/admin/users/:id/reset-password', itAdmin, (req, res) => {
    const acc = store.platform.prepare('SELECT * FROM accounts WHERE id = ?').get(String(req.params.id)) as AccountRow | undefined;
    if (!acc || acc.role === 'it_admin') return res.status(404).json({ error: 'User not found.' });
    const temp = randomPassword();
    store.platform.prepare('UPDATE accounts SET password_hash = ? WHERE id = ?').run(hashPassword(temp), acc.id);
    endAllSessions(store, acc.id);
    store.audit({ actorId: req.account!.id, actorName: req.account!.name, action: 'Password reset', target: acc.email, institutionId: acc.institution_id });
    res.json({ temporaryPassword: temp });
  });

  app.get('/api/admin/institutions', itAdmin, (_req, res) => {
    const counts = store.platform.prepare("SELECT institution_id, role, status, COUNT(*) n FROM accounts WHERE institution_id IS NOT NULL GROUP BY institution_id, role, status").all() as { institution_id: string; role: string; status: string; n: number }[];
    res.json(store.institutions().map((i) => ({
      ...i,
      management: counts.filter((c) => c.institution_id === i.id && c.role === 'management' && c.status === 'active').reduce((a, c) => a + c.n, 0),
      faculty: counts.filter((c) => c.institution_id === i.id && c.role === 'faculty' && c.status === 'active').reduce((a, c) => a + c.n, 0),
      pending: counts.filter((c) => c.institution_id === i.id && c.status === 'pending').reduce((a, c) => a + c.n, 0),
    })));
  });

  app.post('/api/admin/institutions', itAdmin, (req, res) => {
    const b = req.body ?? {};
    const name = s(b.name, 200);
    const slug = s(b.slug, 40).toLowerCase();
    const emailDomain = s(b.emailDomain, 100).toLowerCase().replace(/^@/, '');
    const departments = (Array.isArray(b.departments) ? b.departments : []).map((d: unknown) => s(d, 200)).filter(Boolean);
    if (!name) return res.status(400).json({ error: 'Enter the institution name.' });
    if (!/^[a-z0-9-]{2,40}$/.test(slug)) return res.status(400).json({ error: 'Short code must be 2-40 lower-case letters, digits or hyphens.' });
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(emailDomain)) return res.status(400).json({ error: 'Enter the institution’s email domain, like college.edu.in.' });
    if (!departments.length) return res.status(400).json({ error: 'Add at least one department.' });
    if (store.institution(slug)) return res.status(400).json({ error: 'That short code is already used.' });
    const inst: Institution = { id: slug, slug, name, tagline: s(b.tagline, 200) || 'Faculty Research & Development Portal', emailDomain, status: 'active', createdAt: new Date().toISOString() };
    store.createInstitution(inst, emptyInstitution(inst.name, inst.tagline, departments));
    store.audit({ actorId: req.account!.id, actorName: req.account!.name, action: 'Institution created', target: name, institutionId: slug });
    res.json({ ok: true });
  });

  app.post('/api/admin/institutions/:id/status', itAdmin, (req, res) => {
    const inst = store.institution(String(req.params.id));
    if (!inst) return res.status(404).json({ error: 'Institution not found.' });
    const status = req.body?.status === 'suspended' ? 'suspended' : 'active';
    store.platform.prepare('UPDATE institutions SET status = ? WHERE id = ?').run(status, inst.id);
    if (status === 'suspended') store.platform.prepare('DELETE FROM sessions WHERE account_id IN (SELECT id FROM accounts WHERE institution_id = ?)').run(inst.id);
    store.audit({ actorId: req.account!.id, actorName: req.account!.name, action: `Institution ${status === 'active' ? 'reactivated' : 'suspended'}`, target: inst.name, institutionId: inst.id });
    res.json({ ok: true });
  });

  app.get('/api/admin/audit', itAdmin, (_req, res) => {
    res.json(store.platform.prepare('SELECT * FROM audit ORDER BY id DESC LIMIT 500').all());
  });

  // ---------- errors ----------

  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found.' }));
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof RuleError) return res.status(err.status).json({ error: err.message });
    if ((err as { type?: string })?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid request body.' });
    if ((err as { type?: string })?.type === 'entity.too.large') return res.status(413).json({ error: 'Request too large.' });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Try again.' });
  });

  return app;
}

/** Account as the IT Admin sees it: identity and request details, never the password hash. */
function requestView(a: AccountRow) {
  return {
    id: a.id, email: a.email, name: a.name, title: a.title, role: a.role, status: a.status, institutionId: a.institution_id, facultyId: a.faculty_id,
    designation: a.designation, department: a.department, employeeCode: a.employee_code, note: a.request_note, requestedAt: a.requested_at,
    reviewedBy: a.reviewed_by, reviewedAt: a.reviewed_at, reviewNote: a.review_note, affiliationVerified: !!a.affiliation_verified,
  };
}

function cookie(req: Request, name: string): string | undefined {
  const raw = req.headers.cookie;
  if (!raw) return undefined;
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return undefined;
}
