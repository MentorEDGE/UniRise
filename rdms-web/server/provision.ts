/**
 * UniRise team tool (server command line). After an institution is onboarded, UniRise provisions its workspace and
 * its Office of Research here; the Office of Research then creates faculty and Top-Level Management accounts in the app.
 *
 *   npm run provision -- institution <id> "<Institution name>" <email-domain> "<Dept 1; Dept 2; ...>"
 *       creates the institution and its own, empty database
 *   npm run provision -- office <institution-id> <email> "<Full name>"
 *       creates an Office of Research account for that institution and prints a one-time password
 *   npm run provision -- reset <office-email>        new one-time password for an Office of Research account
 *   npm run provision -- suspend <institution-id>    suspends an institution (everyone is signed out)
 *   npm run provision -- activate <institution-id>
 *   npm run provision -- list
 *   npm run provision -- enquiries                   institutional enquiries from the website (and whether they were emailed)
 */
import crypto from 'node:crypto';
import path from 'node:path';
import { emptyInstitution } from '../src/lib/seed';
import { hashPassword, randomPassword } from './auth';
import { Storage } from './storage';

const [cmd, a, b, c, d] = process.argv.slice(2);
const store = new Storage(path.resolve(process.env.RDMS_DATA_DIR ?? 'data'));
const fail = (m: string): never => { console.error(m); store.close(); process.exit(1); };
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const now = () => new Date().toISOString();

if (cmd === 'institution') {
  if (!a || !/^[a-z0-9-]{2,40}$/.test(a) || !b || !c || !d) fail('Usage: npm run provision -- institution <id> "<Institution name>" <email-domain> "<Dept 1; Dept 2>"');
  if (store.institution(a)) fail(`Institution ${a} already exists.`);
  const departments = d.split(';').map((x) => x.trim()).filter(Boolean);
  if (!departments.length) fail('Give at least one department.');
  store.createInstitution({ id: a, slug: a, name: b, tagline: 'Faculty Research & Development Portal', emailDomain: c.toLowerCase().replace(/^@/, ''), status: 'active', createdAt: now() }, emptyInstitution(b, 'Faculty Research & Development Portal', departments));
  store.audit({ actorName: 'UniRise provisioning', action: 'Institution provisioned', target: b, institutionId: a, detail: departments.join('; ') });
  console.log(`Institution ${b} (${a}) created with its own database. Next: npm run provision -- office ${a} <email> "<Full name>"`);
} else if (cmd === 'office') {
  const inst = store.institution(a ?? '');
  if (!inst) fail('Usage: npm run provision -- office <institution-id> <email> "<Full name>"  (institution not found)');
  if (!b || !EMAIL.test(b)) fail('Give a valid email address.');
  if (store.platform.prepare('SELECT 1 FROM accounts WHERE email = ?').get(b)) fail('An account with that email already exists.');
  const pw = randomPassword();
  store.platform.prepare(`INSERT INTO accounts (id, email, password_hash, role, institution_id, status, name, designation, requested_at, reviewed_by, reviewed_at, affiliation_verified)
    VALUES (?, ?, ?, 'office', ?, 'active', ?, 'Office of Research', ?, 'UniRise provisioning', ?, 1)`)
    .run(`acc_${crypto.randomBytes(8).toString('hex')}`, b.toLowerCase(), hashPassword(pw), inst!.id, c || `Office of Research, ${inst!.name}`, now(), now());
  store.audit({ actorName: 'UniRise provisioning', action: 'Office of Research account created', target: b, institutionId: inst!.id });
  console.log(`Office of Research account ${b} created for ${inst!.name}. One-time password: ${pw}`);
} else if (cmd === 'reset') {
  const row = store.platform.prepare("SELECT id, institution_id FROM accounts WHERE email = ? AND role = 'office'").get(a ?? '') as { id: string; institution_id: string } | undefined;
  if (!row) fail('No Office of Research account with that email.');
  const pw = randomPassword();
  store.platform.prepare('UPDATE accounts SET password_hash = ? WHERE id = ?').run(hashPassword(pw), row!.id);
  store.platform.prepare('DELETE FROM sessions WHERE account_id = ?').run(row!.id);
  store.audit({ actorName: 'UniRise provisioning', action: 'Office of Research password reset', target: a, institutionId: row!.institution_id });
  console.log(`New one-time password for ${a}: ${pw}`);
} else if (cmd === 'suspend' || cmd === 'activate') {
  const inst = store.institution(a ?? '');
  if (!inst) fail('Institution not found.');
  store.platform.prepare('UPDATE institutions SET status = ? WHERE id = ?').run(cmd === 'suspend' ? 'suspended' : 'active', inst!.id);
  if (cmd === 'suspend') store.platform.prepare('DELETE FROM sessions WHERE account_id IN (SELECT id FROM accounts WHERE institution_id = ?)').run(inst!.id);
  store.audit({ actorName: 'UniRise provisioning', action: `Institution ${cmd === 'suspend' ? 'suspended' : 'reactivated'}`, target: inst!.name, institutionId: inst!.id });
  console.log(`${inst!.name} ${cmd === 'suspend' ? 'suspended' : 'reactivated'}.`);
} else if (cmd === 'list') {
  console.table(store.institutions().map((i) => ({ id: i.id, name: i.name, status: i.status, office: (store.platform.prepare("SELECT group_concat(email, ', ') e FROM accounts WHERE institution_id = ? AND role = 'office'").get(i.id) as { e: string | null }).e ?? '—' })));
} else if (cmd === 'enquiries') {
  console.table((store.platform.prepare('SELECT id, at, data, delivered, delivery_note FROM enquiries ORDER BY id DESC LIMIT 50').all() as { id: number; at: string; data: string; delivered: number; delivery_note: string }[])
    .map((r) => { const e = JSON.parse(r.data); return { id: r.id, at: r.at.slice(0, 16), institution: e.institutionName, contact: `${e.contactName} <${e.email}>`, emailed: r.delivered ? 'yes' : `no (${r.delivery_note})` }; }));
} else {
  fail('Usage: npm run provision -- institution | office | reset | suspend | activate | list | enquiries   (see server/provision.ts)');
}
store.close();
