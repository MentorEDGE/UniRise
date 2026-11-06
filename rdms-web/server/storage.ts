/**
 * Storage. Follows ../rms-docs/MULTI_TENANCY_DESIGN.md at small scale:
 *  - platform.sqlite (control plane): institutions, accounts, sessions, audit log. No research data.
 *  - tenants/<institution id>.sqlite: one database per institution, holding only that institution's records.
 * A tenant database is opened only through `tenant(institutionId)`, and the institution id always comes from the
 * signed-in account, never from the request.
 */
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import type { DB, Institution } from '../src/lib/types';
import { AWARD_WEIGHT_DEFAULTS } from '../src/lib/types';
import { normalizeBiodata } from '../src/lib/domain';

export interface AccountRow {
  id: string; email: string; password_hash: string; role: 'office' | 'management' | 'faculty'; institution_id: string | null; faculty_id: string | null;
  status: 'pending' | 'active' | 'rejected' | 'suspended' | 'deactivated'; name: string; title: string; designation: string; department: string;
  employee_code: string; request_note: string; requested_at: string; reviewed_by: string | null; reviewed_at: string | null; review_note: string;
  affiliation_verified: number;
}

const COLLECTIONS = ['faculty', 'biodata', 'publications', 'grants', 'seedMoney', 'fdps', 'conferences', 'awards', 'profileChanges', 'notices'] as const;
const keyOf = (c: (typeof COLLECTIONS)[number], row: Record<string, unknown>) => String(c === 'biodata' ? row.facultyId : row.id);

export class Storage {
  readonly platform: Database.Database;
  private tenants = new Map<string, { conn: Database.Database; data: DB }>();

  constructor(readonly dir: string) {
    fs.mkdirSync(path.join(dir, 'tenants'), { recursive: true });
    this.platform = new Database(path.join(dir, 'platform.sqlite'));
    this.platform.pragma('journal_mode = WAL');
    this.platform.pragma('foreign_keys = ON');
    this.migrateAccounts();
    this.platform.exec(`
      CREATE TABLE IF NOT EXISTS institutions (
        id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL, tagline TEXT NOT NULL DEFAULT '',
        email_domain TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE, password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('office','management','faculty')),
        institution_id TEXT REFERENCES institutions(id), faculty_id TEXT,
        status TEXT NOT NULL CHECK (status IN ('pending','active','rejected','suspended','deactivated')),
        name TEXT NOT NULL, title TEXT NOT NULL DEFAULT '', designation TEXT NOT NULL DEFAULT '', department TEXT NOT NULL DEFAULT '',
        employee_code TEXT NOT NULL DEFAULT '', request_note TEXT NOT NULL DEFAULT '', requested_at TEXT NOT NULL,
        reviewed_by TEXT, reviewed_at TEXT, review_note TEXT NOT NULL DEFAULT '', affiliation_verified INTEGER NOT NULL DEFAULT 0,
        CHECK (institution_id IS NOT NULL));
      CREATE UNIQUE INDEX IF NOT EXISTS one_account_per_profile ON accounts(institution_id, faculty_id) WHERE faculty_id IS NOT NULL AND status IN ('active','suspended');
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL, last_seen INTEGER NOT NULL, admin INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS enquiries (
        id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, data TEXT NOT NULL, delivered INTEGER NOT NULL DEFAULT 0, delivery_note TEXT NOT NULL DEFAULT '');
      CREATE TABLE IF NOT EXISTS audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, actor_id TEXT, actor_name TEXT, action TEXT NOT NULL,
        target TEXT, institution_id TEXT, detail TEXT NOT NULL DEFAULT '');
    `);
  }

  /**
   * Earlier versions had one platform-level Office of Research ('it_admin', no institution). The Office of Research
   * now belongs to an institution. Old platform-level accounts are removed (UniRise provisions each institution's
   * Office of Research with `npm run provision`); every other account and all research data are kept.
   */
  private migrateAccounts() {
    const row = this.platform.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'accounts'").get() as { sql: string } | undefined;
    if (!row || !row.sql.includes('it_admin')) return;
    this.platform.exec(`
      PRAGMA foreign_keys = OFF;
      BEGIN;
      DELETE FROM sessions WHERE account_id IN (SELECT id FROM accounts WHERE role = 'it_admin');
      DELETE FROM accounts WHERE role = 'it_admin';
      ALTER TABLE accounts RENAME TO accounts_old;
      CREATE TABLE accounts (
        id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE, password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('office','management','faculty')),
        institution_id TEXT REFERENCES institutions(id), faculty_id TEXT,
        status TEXT NOT NULL CHECK (status IN ('pending','active','rejected','suspended','deactivated')),
        name TEXT NOT NULL, title TEXT NOT NULL DEFAULT '', designation TEXT NOT NULL DEFAULT '', department TEXT NOT NULL DEFAULT '',
        employee_code TEXT NOT NULL DEFAULT '', request_note TEXT NOT NULL DEFAULT '', requested_at TEXT NOT NULL,
        reviewed_by TEXT, reviewed_at TEXT, review_note TEXT NOT NULL DEFAULT '', affiliation_verified INTEGER NOT NULL DEFAULT 0,
        CHECK (institution_id IS NOT NULL));
      INSERT INTO accounts SELECT * FROM accounts_old;
      DROP TABLE accounts_old;
      DROP INDEX IF EXISTS one_account_per_profile;
      COMMIT;
      PRAGMA foreign_keys = ON;
    `);
  }

  // ---------- institutions ----------

  institutions(): Institution[] {
    return (this.platform.prepare('SELECT * FROM institutions ORDER BY name').all() as Record<string, string>[]).map(toInstitution);
  }
  institution(id: string): Institution | undefined {
    const r = this.platform.prepare('SELECT * FROM institutions WHERE id = ?').get(id) as Record<string, string> | undefined;
    return r && toInstitution(r);
  }

  /** Registers an institution and creates its own database with the given starting data. */
  createInstitution(inst: Institution, data: DB) {
    this.platform.prepare('INSERT INTO institutions (id, slug, name, tagline, email_domain, status, created_at) VALUES (?,?,?,?,?,?,?)')
      .run(inst.id, inst.slug, inst.name, inst.tagline, inst.emailDomain, inst.status, inst.createdAt);
    const conn = this.open(inst.id, true);
    this.writeAll(conn, data);
    this.tenants.set(inst.id, { conn, data });
  }

  // ---------- tenant databases ----------

  private file(institutionId: string) {
    if (!/^[a-z0-9-]{2,40}$/.test(institutionId)) throw new Error('Bad institution id');
    return path.join(this.dir, 'tenants', `${institutionId}.sqlite`);
  }
  private open(institutionId: string, create = false) {
    const file = this.file(institutionId);
    if (!create && !fs.existsSync(file)) throw new Error(`Database for ${institutionId} is missing`);
    const conn = new Database(file);
    conn.pragma('journal_mode = WAL');
    conn.exec(`CREATE TABLE IF NOT EXISTS entities (collection TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (collection, id));
               CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
    return conn;
  }
  private writeAll(conn: Database.Database, data: DB) {
    conn.transaction(() => {
      conn.exec('DELETE FROM entities; DELETE FROM kv;');
      const put = conn.prepare('INSERT INTO entities (collection, id, data) VALUES (?,?,?)');
      for (const c of COLLECTIONS) for (const row of data[c] as unknown as Record<string, unknown>[]) put.run(c, keyOf(c, row), JSON.stringify(row));
      const kv = conn.prepare('INSERT INTO kv (key, value) VALUES (?,?)');
      kv.run('settings', JSON.stringify(data.settings)); kv.run('seq', String(data.seq)); kv.run('version', String(data.version));
    })();
  }

  /** The institution's data (cached in memory; this process is the only writer). */
  tenant(institutionId: string): DB {
    let t = this.tenants.get(institutionId);
    if (!t) {
      const conn = this.open(institutionId);
      const data = { version: 1, seq: 0, settings: {} } as unknown as DB;
      for (const c of COLLECTIONS) (data[c] as unknown[]) = [];
      for (const row of conn.prepare('SELECT collection, data FROM entities ORDER BY rowid').all() as { collection: (typeof COLLECTIONS)[number]; data: string }[]) {
        (data[row.collection] as unknown[]).push(JSON.parse(row.data));
      }
      for (const row of conn.prepare('SELECT key, value FROM kv').all() as { key: string; value: string }[]) {
        if (row.key === 'settings') data.settings = JSON.parse(row.value);
        else if (row.key === 'seq') data.seq = Number(row.value);
        else if (row.key === 'version') data.version = Number(row.value);
      }
      // Institutions created before Honours & Awards existed get the default award weights.
      if (data.settings.weights) data.settings.weights = { ...AWARD_WEIGHT_DEFAULTS, ...data.settings.weights };
      // Profiles stored before the researcher-profile fields existed get empty values (never invented ones).
      data.biodata = data.biodata.map(normalizeBiodata);
      t = { conn, data };
      this.tenants.set(institutionId, t);
    }
    return t.data;
  }

  /**
   * Runs `fn` on a copy of the institution's data and saves only what changed, in one transaction.
   * If `fn` throws, nothing is saved.
   */
  mutateTenant<T>(institutionId: string, fn: (db: DB) => T): T {
    const before = this.tenant(institutionId);
    const t = this.tenants.get(institutionId)!;
    const next = structuredClone(before);
    const result = fn(next);
    t.conn.transaction(() => {
      const put = t.conn.prepare('INSERT INTO entities (collection, id, data) VALUES (?,?,?) ON CONFLICT(collection, id) DO UPDATE SET data = excluded.data');
      const del = t.conn.prepare('DELETE FROM entities WHERE collection = ? AND id = ?');
      for (const c of COLLECTIONS) {
        const old = new Map((before[c] as unknown as Record<string, unknown>[]).map((r) => [keyOf(c, r), JSON.stringify(r)]));
        const seen = new Set<string>();
        for (const row of next[c] as unknown as Record<string, unknown>[]) {
          const k = keyOf(c, row); const json = JSON.stringify(row);
          seen.add(k);
          if (old.get(k) !== json) put.run(c, k, json);
        }
        for (const k of old.keys()) if (!seen.has(k)) del.run(c, k);
      }
      const kv = t.conn.prepare('INSERT INTO kv (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
      kv.run('settings', JSON.stringify(next.settings)); kv.run('seq', String(next.seq));
    })();
    t.data = next;
    return result;
  }

  // ---------- audit ----------

  audit(e: { actorId?: string; actorName?: string; action: string; target?: string; institutionId?: string | null; detail?: string }) {
    this.platform.prepare('INSERT INTO audit (at, actor_id, actor_name, action, target, institution_id, detail) VALUES (?,?,?,?,?,?,?)')
      .run(new Date().toISOString(), e.actorId ?? null, e.actorName ?? null, e.action, e.target ?? null, e.institutionId ?? null, e.detail ?? '');
  }

  close() {
    for (const t of this.tenants.values()) t.conn.close();
    this.tenants.clear();
    this.platform.close();
  }
}

const toInstitution = (r: Record<string, string>): Institution => ({ id: r.id, slug: r.slug, name: r.name, tagline: r.tagline, emailDomain: r.email_domain, status: r.status as Institution['status'], createdAt: r.created_at });
