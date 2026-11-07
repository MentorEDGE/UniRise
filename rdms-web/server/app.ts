import crypto from 'node:crypto';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import * as rules from '../src/lib/domain';
import type { Actor } from '../src/lib/domain';
import { RuleError } from '../src/lib/domain';
import type { EntityKind, User } from '../src/lib/types';
import {
  burnPasswordCheck, createSession, endAllSessions, endSession, hashPassword, passwordProblem, randomPassword, readSession, SESSION_COOKIE,
  Throttle, verifyPassword,
} from './auth';
import type { AccountRow, Storage } from './storage';
import { defaultMailer, enquiryEmail } from './mail';
import type { Mailer } from './mail';

declare module 'express-serve-static-core' {
  interface Request { account?: AccountRow; actor?: Actor; institutionId?: string }
}

const KINDS: EntityKind[] = ['publications', 'grants', 'seedMoney', 'fdps', 'conferences', 'awards', 'ipr'];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const s = (v: unknown, max = 300) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export function toUser(a: AccountRow): User {
  return { id: a.id, email: a.email, name: a.name, role: a.role, status: a.status, institutionId: a.institution_id, facultyId: a.faculty_id ?? undefined, designation: a.designation };
}

export function createApp(store: Storage, opts: { secureCookies?: boolean; mailer?: Mailer } = {}) {
  const app = express();
  const loginByEmail = new Throttle(5);
  const loginByIp = new Throttle(20);
  
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

  /**
   * Every signed-in user belongs to exactly one institution: faculty, Top-Level Management or that institution's
   * Office of Research. The institution comes from the account, never from the request.
   */
  const institutionUser = (req: Request, res: Response, next: NextFunction) => {
    const a = req.account;
    if (!a) return res.status(401).json({ error: 'Please sign in.' });
    const inst = a.institution_id ? store.institution(a.institution_id) : undefined;
    if (!inst || inst.status !== 'active') return res.status(403).json({ error: 'Your institution’s access is suspended. Contact the UniRise team.' });
    if (a.role === 'faculty') {
      const f = store.tenant(inst.id).faculty.find((x) => x.id === a.faculty_id);
      if (!f || !f.active) return res.status(403).json({ error: 'Your faculty profile is inactive. Contact your Office of Research.' });
      req.actor = { userId: a.id, name: f.name, role: 'faculty', facultyId: f.id };
    } else {
      req.actor = { userId: a.id, name: a.name, role: a.role === 'office' ? 'office' : 'management' };
    }
    req.institutionId = inst.id;
    next();
  };
  /** The institution's Office of Research only (and only for its own institution). */
  const office = (req: Request, res: Response, next: NextFunction) => institutionUser(req, res, () => {
    if (req.account!.role !== 'office') return res.status(403).json({ error: 'Only the Office of Research can do this.' });
    next();
  });
  /** An account in the Office of Research's own institution (never another institution's, never another Office account). */
  const ownAccount = (req: Request): AccountRow => {
    const acc = store.platform.prepare('SELECT * FROM accounts WHERE id = ? AND institution_id = ?').get(String(req.params.id), req.institutionId) as AccountRow | undefined;
    if (!acc || acc.role === 'office') throw new RuleError(404, 'User not found.');
    return acc;
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

  // Self-registration is closed: the Office of Research creates every account (POST /api/admin/users).
  app.post('/api/register', (_req, res) => res.status(410).json({ error: 'Accounts are created by the Office of Research. Ask them for your sign-in details.' }));

  // ---------- sign in ----------

  /**
   * One sign-in for every role: the role comes from the account record, never from the request. `officeOnly` keeps
   * the older Office of Research endpoint working for that role only. Office sessions get the shorter admin timeout.
   */
  const signIn = (officeOnly: boolean) => (req: Request, res: Response) => {
    const email = s(req.body?.email, 200).toLowerCase();
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const ip = req.ip ?? '';
    if (loginByEmail.blocked(email) || loginByIp.blocked(ip)) return res.status(429).json({ error: 'Too many failed attempts. Try again in 15 minutes.' });
    const acc = store.platform.prepare('SELECT * FROM accounts WHERE email = ?').get(email) as AccountRow | undefined;
    const eligible = acc && (!officeOnly || acc.role === 'office');
    const admin = acc?.role === 'office';
    if (!acc || !eligible) burnPasswordCheck(password);
    if (!acc || !eligible || !verifyPassword(password, acc.password_hash)) {
      loginByEmail.fail(email); loginByIp.fail(ip);
      if (officeOnly || admin) store.audit({ action: 'Office of Research sign-in failed', target: email });
      return res.status(401).json({ error: 'Invalid email or password.' });
    }
    loginByEmail.clear(email);
    const msg: Record<string, string> = {
      pending: 'Your account has not been activated yet. Contact your Office of Research.',
      rejected: 'Your account was not approved. Contact your Office of Research.',
      suspended: 'Your account is suspended. Contact your Office of Research.',
      deactivated: 'Your account has been deactivated.',
    };
    if (acc.status !== 'active') return res.status(403).json({ error: msg[acc.status] });
    if (acc.institution_id) {
      const inst = store.institution(acc.institution_id);
      if (!inst || inst.status !== 'active') return res.status(403).json({ error: 'Your institution’s access is suspended. Contact the UniRise team.' });
      if (acc.role === 'faculty' && !store.tenant(inst.id).faculty.find((f) => f.id === acc.faculty_id)?.active) return res.status(403).json({ error: 'Your faculty profile is inactive. Contact your institution.' });
    }
    const old = cookie(req, SESSION_COOKIE);
    if (old) endSession(store, old);
    setCookie(res, createSession(store, acc.id, admin));
    if (admin) store.audit({ actorId: acc.id, actorName: acc.name, action: 'Office of Research signed in' });
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
  // Kept so an old client gets a clear 403: only the Office of Research reviews entries (see /api/admin/approvals).
  app.post('/api/records/:kind/:id/review', institutionUser, tenantAction((db, actor, req) =>
    rules.review(db, actor, kindParam(req), String(req.params.id), req.body?.decision, s(req.body?.remark, 1000), req.body?.sanctionedAmount)));
  // Kept for a clear 403: funding outcomes are recorded by the Office of Research (see /api/admin/approvals).
  app.post('/api/grants/:id/outcome', institutionUser, tenantAction((db, actor, req) => rules.updateGrantOutcome(db, actor, String(req.params.id), req.body ?? {})));
  /** Faculty propose a profile update; it waits for the Office of Research. Management gets 403 (read-only). */
  app.post('/api/profile-changes', institutionUser, tenantAction((db, actor, req) => rules.proposeProfileChange(db, actor, { biodata: req.body?.biodata ?? {}, contact: req.body?.contact ?? {} }, req.body?.submit === true)));
  // Faculty records are no longer edited by management; these answer 403 so old clients fail clearly.
  app.put('/api/biodata/:facultyId', institutionUser, (_req, res) => res.status(403).json({ error: 'Profile updates are submitted for approval by the Office of Research.' }));
  // Official faculty details and deactivation: the institution's Office of Research only (rules.saveFaculty checks the role).
  app.post('/api/faculty', institutionUser, (_req, res) => res.status(403).json({ error: 'Faculty profiles are created with the account, under User Management.' }));
  app.put('/api/faculty/:id', institutionUser, tenantAction((db, actor, req) => rules.saveFaculty(db, actor, { ...(req.body ?? {}), id: String(req.params.id) }, false)));
  // Institution & departments, targets & scoring and notices: the institution's Office of Research (checked in the rules).
  app.put('/api/settings', institutionUser, tenantAction((db, actor, req) => rules.saveSettings(db, actor, req.body ?? {})));
  app.post('/api/notices', institutionUser, tenantAction((db, actor, req) => rules.addNotice(db, actor, req.body?.title, req.body?.body)));
  app.delete('/api/notices/:id', institutionUser, tenantAction((db, actor, req) => rules.deleteNotice(db, actor, String(req.params.id))));

  // ---------- Office of Research: approvals (own institution) ----------
  // The only place entries and profile updates are approved, returned for correction or rejected. Management and
  // faculty get 403 here and from the rules themselves (rules.review accepts only the 'office' actor).

  const decisionAction = (d: unknown, what: string) => ({ Approved: `${what} approved`, Rework: `${what} returned for correction`, Rejected: `${what} rejected` } as Record<string, string>)[String(d)] ?? `${what} reviewed`;

  /** view=pending (default): the queue. view=decided: entries already approved, returned or rejected, newest first. */
  app.get('/api/office/approvals', office, (req, res) => {
    const db = store.tenant(req.institutionId!);
    const decided = req.query.view === 'decided';
    const reviewed = (h: { action: string }[]) => h.some((x) => ['Approved', 'Sent for rework', 'Returned for correction', 'Rejected'].includes(x.action));
    const pick = <T extends { status: string; history: { action: string }[]; updatedAt: string }>(xs: T[]) => (decided
      ? xs.filter((r) => ['Approved', 'Rework', 'Rejected'].includes(r.status) && reviewed(r.history)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 300)
      : xs.filter((r) => r.status === 'Submitted'));
    const profiles = pick(db.profileChanges ?? []);
    res.json({
      records: Object.fromEntries(KINDS.map((k) => [k, pick(db[k] as never[])])),
      profiles,
      currentProfiles: Object.fromEntries(profiles.map((c) => [c.facultyId, db.biodata.find((b) => b.facultyId === c.facultyId) ?? null])),
    });
  });
  app.get('/api/office/approvals/count', office, (req, res) => {
    const db = store.tenant(req.institutionId!);
    res.json({ total: KINDS.reduce((a, k) => a + (db[k] as { status: string }[]).filter((r) => r.status === 'Submitted').length, 0) + (db.profileChanges ?? []).filter((c) => c.status === 'Submitted').length });
  });
  app.post('/api/office/approvals/profiles/:id/review', office, (req, res) => {
    store.mutateTenant(req.institutionId!, (db) => rules.reviewProfileChange(db, req.actor!, String(req.params.id), req.body?.decision, s(req.body?.remark, 1000)));
    store.audit({ actorId: req.account!.id, actorName: req.account!.name, action: decisionAction(req.body?.decision, 'Profile update'), target: String(req.params.id), institutionId: req.institutionId });
    res.json({ ok: true });
  });
  app.post('/api/office/approvals/grants/:id/outcome', office, (req, res) => {
    store.mutateTenant(req.institutionId!, (db) => rules.updateGrantOutcome(db, req.actor!, String(req.params.id), req.body ?? {}));
    store.audit({ actorId: req.account!.id, actorName: req.account!.name, action: `Grant outcome set to ${s(req.body?.outcome, 40)}`, target: String(req.params.id), institutionId: req.institutionId });
    res.json({ ok: true });
  });
  app.post('/api/office/approvals/:kind/:id/review', office, (req, res) => {
    const kind = kindParam(req);
    store.mutateTenant(req.institutionId!, (db) => rules.review(db, req.actor!, kind, String(req.params.id), req.body?.decision, s(req.body?.remark, 1000), req.body?.sanctionedAmount));
    store.audit({ actorId: req.account!.id, actorName: req.account!.name, action: decisionAction(req.body?.decision, 'Entry'), target: String(req.params.id), institutionId: req.institutionId, detail: kind });
    res.json({ ok: true });
  });

  // ---------- Office of Research: user management (own institution) ----------

  app.get('/api/office/users', office, (req, res) => {
    res.json((store.platform.prepare("SELECT * FROM accounts WHERE institution_id = ? ORDER BY role = 'office' DESC, role, name").all(req.institutionId) as AccountRow[]).map(requestView));
  });

  /** Creates a faculty or Top-Level Management account in the Office's own institution and returns a temporary password. */
  app.post('/api/office/users', office, (req, res) => {
    const b = req.body ?? {};
    const role = b.role === 'management' ? 'management' : b.role === 'faculty' ? 'faculty' : '';
    const instId = req.institutionId!;
    const name = s(b.name, 200);
    const email = s(b.email, 200).toLowerCase();
    if (!role) return res.status(400).json({ error: 'Choose Faculty or Top-Level Management.' });
    if (!name) return res.status(400).json({ error: 'Enter the full name.' });
    if (!EMAIL.test(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
    if (store.platform.prepare('SELECT 1 FROM accounts WHERE email = ?').get(email)) return res.status(400).json({ error: 'An account with this email already exists.' });
    const designation = s(b.designation, 100);
    const status = b.status === 'deactivated' ? 'deactivated' : 'active';
    let facultyId: string | null = null;
    if (role === 'faculty') {
      const code = s(b.employeeCode, 20);
      if (!/^[A-Za-z0-9-]{3,20}$/.test(code)) return res.status(400).json({ error: 'Enter the employee code (3-20 letters or digits).' });
      if (!store.tenant(instId).settings.departments.includes(s(b.department, 200))) return res.status(400).json({ error: 'Choose the department.' });
      const taken = store.platform.prepare("SELECT 1 FROM accounts WHERE institution_id = ? AND faculty_id = ? AND status IN ('active','suspended')").get(instId, code);
      if (taken) return res.status(400).json({ error: `Faculty profile ${code} is already linked to another account.` });
      facultyId = store.mutateTenant(instId, (db) => rules.ensureFacultyProfile(db, { id: code, title: s(b.title, 10), name, designation, department: s(b.department, 200), email }));
    }
    const temp = randomPassword();
    const at = new Date().toISOString();
    store.platform.prepare(`INSERT INTO accounts (id, email, password_hash, role, institution_id, faculty_id, status, name, title, designation, department, employee_code, request_note, requested_at, reviewed_by, reviewed_at, affiliation_verified)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'',?,?,?,1)`).run(`acc_${crypto.randomBytes(8).toString('hex')}`, email, hashPassword(temp), role, instId, facultyId, status, name, s(b.title, 10), designation, s(b.department, 200), facultyId ?? '', at, req.account!.name, at);
    store.audit({ actorId: req.account!.id, actorName: req.account!.name, action: 'Account created', target: email, institutionId: instId, detail: `${role}${facultyId ? ` · profile ${facultyId}` : ''}` });
    res.json({ temporaryPassword: temp });
  });

  app.post('/api/office/users/:id/status', office, (req, res) => {
    const acc = ownAccount(req);
    const status = String(req.body?.status);
    if (!['active', 'suspended', 'deactivated'].includes(status)) return res.status(400).json({ error: 'Unknown status.' });
    const reason = s(req.body?.reason, 500);
    if (status !== 'active' && !reason) return res.status(400).json({ error: 'Give a reason.' });
    if (status === 'active' && acc.role === 'faculty' && !acc.faculty_id) return res.status(400).json({ error: 'This account is not linked to a faculty profile. Create a new faculty account instead.' });
    if (status === 'active' && acc.faculty_id) {
      const taken = store.platform.prepare("SELECT 1 FROM accounts WHERE institution_id = ? AND faculty_id = ? AND status IN ('active','suspended') AND id != ?").get(acc.institution_id, acc.faculty_id, acc.id);
      if (taken) return res.status(400).json({ error: 'Another account is already linked to this faculty profile.' });
    }
    store.platform.prepare('UPDATE accounts SET status = ? WHERE id = ?').run(status, acc.id);
    if (status !== 'active') endAllSessions(store, acc.id);
    store.audit({ actorId: req.account!.id, actorName: req.account!.name, action: `Account ${status === 'active' ? 'activated' : status}`, target: acc.email, institutionId: acc.institution_id, detail: reason });
    res.json({ ok: true });
  });

  app.post('/api/office/users/:id/role', office, (req, res) => {
    const acc = ownAccount(req);
    const role = req.body?.role === 'management' ? 'management' : req.body?.role === 'faculty' ? 'faculty' : '';
    if (!role) return res.status(400).json({ error: 'Unknown role.' });
    if (role === 'faculty' && !acc.faculty_id) return res.status(400).json({ error: 'This account has no faculty profile. Create a faculty account instead.' });
    store.platform.prepare('UPDATE accounts SET role = ? WHERE id = ?').run(role, acc.id);
    endAllSessions(store, acc.id);
    store.audit({ actorId: req.account!.id, actorName: req.account!.name, action: `Role changed to ${role}`, target: acc.email, institutionId: acc.institution_id });
    res.json({ ok: true });
  });

  app.post('/api/office/users/:id/reset-password', office, (req, res) => {
    const acc = ownAccount(req);
    const temp = randomPassword();
    store.platform.prepare('UPDATE accounts SET password_hash = ? WHERE id = ?').run(hashPassword(temp), acc.id);
    endAllSessions(store, acc.id);
    store.audit({ actorId: req.account!.id, actorName: req.account!.name, action: 'Password reset', target: acc.email, institutionId: acc.institution_id });
    res.json({ temporaryPassword: temp });
  });

  app.get('/api/office/audit', office, (req, res) => {
    res.json(store.platform.prepare('SELECT * FROM audit WHERE institution_id = ? ORDER BY id DESC LIMIT 500').all(req.institutionId));
  });

  // ---------- public: institutional enquiries (Talk to Our Team) ----------

  const enquiryByIp = new Throttle(5, 60 * 60_000);
  app.post('/api/enquiries', async (req, res) => {
    const ip = req.ip ?? '';
    if (enquiryByIp.blocked(ip)) return res.status(429).json({ error: 'Too many enquiries from this connection. Please try again later or email corporate@mentoredge.co.in.' });
    const b = req.body ?? {};
    if (s(b.website, 200)) return res.json({ ok: true }); // hidden field: only automated spam fills it in
    const e = {
      institutionName: s(b.institutionName, 200), institutionType: s(b.institutionType, 80), country: s(b.country, 80), state: s(b.state, 80), city: s(b.city, 80),
      contactName: s(b.contactName, 200), designation: s(b.designation, 120), email: s(b.email, 200).toLowerCase(), phone: s(b.phone, 30),
      facultyCount: s(b.facultyCount, 40), interest: s(b.interest, 120), message: s(b.message, 3000),
    };
    const missing = (Object.entries({ institutionName: 'Organisation name', institutionType: 'Organisation type', contactName: 'Contact name', email: 'Work email', country: 'Country', state: 'State', city: 'City', facultyCount: 'Approximate number of faculty', interest: 'Area of interest' }) as [keyof typeof e, string][])
      .filter(([k]) => !e[k]).map(([, l]) => l);
    if (missing.length) return res.status(400).json({ error: `Please fill in: ${missing.join(', ')}.` });
    if (!EMAIL.test(e.email)) return res.status(400).json({ error: 'Enter a valid work email address.' });
    if (e.phone && !/^[+\d][\d\s()-]{6,}$/.test(e.phone)) return res.status(400).json({ error: 'Enter a valid phone number.' });
    if (b.consent !== 'yes' && b.consent !== true) return res.status(400).json({ error: 'Please agree that we may contact you about this enquiry.' });
    enquiryByIp.fail(ip);
    const id = Number(store.platform.prepare('INSERT INTO enquiries (at, data) VALUES (?, ?)').run(new Date().toISOString(), JSON.stringify(e)).lastInsertRowid);
    const sent = await (opts.mailer ?? defaultMailer)(enquiryEmail(e));
    store.platform.prepare('UPDATE enquiries SET delivered = ?, delivery_note = ? WHERE id = ?').run(sent.ok ? 1 : 0, sent.note, id);
    res.json({ ok: true });
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

/** Account as the Office of Research sees it: identity and request details, never the password hash. */
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
