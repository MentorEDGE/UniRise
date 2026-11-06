import crypto from 'node:crypto';
import type { Storage } from './storage';
import type { AccountRow } from './storage';

// ---------- passwords (scrypt, per-password salt) ----------

const N = 16384, R = 8, P = 1, LEN = 64;

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(password, salt, LEN, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [alg, n, r, p, salt, key] = stored.split('$');
  if (alg !== 'scrypt') return false;
  const expected = Buffer.from(key, 'base64');
  const actual = crypto.scryptSync(password, Buffer.from(salt, 'base64'), expected.length, { N: Number(n), r: Number(r), p: Number(p) });
  return crypto.timingSafeEqual(actual, expected);
}

/** Spend the same time on unknown emails as on known ones, so timing does not reveal which accounts exist. */
const DUMMY = hashPassword(crypto.randomBytes(12).toString('hex'));
export const burnPasswordCheck = (password: string) => { verifyPassword(password, DUMMY); };

export function passwordProblem(pw: string): string | null {
  if (pw.length < 8) return 'Use at least 8 characters.';
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return 'Use letters and at least one number.';
  return null;
}

export const randomPassword = () => crypto.randomBytes(9).toString('base64url');

// ---------- sessions ----------

export const SESSION_COOKIE = 'rdms_sid';
const USER_IDLE_MS = 8 * 3600_000;
const ADMIN_IDLE_MS = 30 * 60_000;
const ABSOLUTE_MS = 12 * 3600_000;
const sha = (t: string) => crypto.createHash('sha256').update(t).digest('hex');

export function createSession(store: Storage, accountId: string, admin: boolean): string {
  const token = crypto.randomBytes(32).toString('base64url');
  const t = Date.now();
  store.platform.prepare('INSERT INTO sessions (token_hash, account_id, created_at, last_seen, admin) VALUES (?,?,?,?,?)').run(sha(token), accountId, t, t, admin ? 1 : 0);
  return token;
}

/** Returns the account for a valid session (and slides its idle timeout), or null. */
export function readSession(store: Storage, token: string | undefined): AccountRow | null {
  if (!token) return null;
  const s = store.platform.prepare('SELECT * FROM sessions WHERE token_hash = ?').get(sha(token)) as { token_hash: string; account_id: string; created_at: number; last_seen: number; admin: number } | undefined;
  if (!s) return null;
  const t = Date.now();
  const idle = s.admin ? ADMIN_IDLE_MS : USER_IDLE_MS;
  if (t - s.last_seen > idle || t - s.created_at > ABSOLUTE_MS) { endSession(store, token); return null; }
  const acc = store.platform.prepare('SELECT * FROM accounts WHERE id = ?').get(s.account_id) as AccountRow | undefined;
  if (!acc || acc.status !== 'active') { endSession(store, token); return null; }
  // An Office of Research session uses the shorter timeout; the flag must match the account's role.
  if ((acc.role === 'office') !== (s.admin === 1)) { endSession(store, token); return null; }
  store.platform.prepare('UPDATE sessions SET last_seen = ? WHERE token_hash = ?').run(t, s.token_hash);
  return acc;
}

export function endSession(store: Storage, token: string) {
  store.platform.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha(token));
}
export function endAllSessions(store: Storage, accountId: string) {
  store.platform.prepare('DELETE FROM sessions WHERE account_id = ?').run(accountId);
}

// ---------- login throttling ----------

/** 5 failed attempts per email (or 20 per IP) lock that key for 15 minutes. In memory: fine for one server process. */
export class Throttle {
  private fails = new Map<string, { n: number; until: number }>();
  constructor(private limit: number, private windowMs = 15 * 60_000) {}
  blocked(key: string) {
    const f = this.fails.get(key);
    if (!f) return false;
    if (Date.now() > f.until) { this.fails.delete(key); return false; }
    return f.n >= this.limit;
  }
  fail(key: string) {
    const f = this.fails.get(key);
    const until = Date.now() + this.windowMs;
    this.fails.set(key, f && Date.now() <= f.until ? { n: f.n + 1, until } : { n: 1, until });
  }
  clear(key: string) { this.fails.delete(key); }
}
