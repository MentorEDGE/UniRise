/**
 * IT Admin accounts are created here, on the server, never through public registration.
 *   npm run admin -- create <email> "<Full name>"   creates an IT Admin and prints a one-time password
 *   npm run admin -- reset <email>                  sets a new one-time password for an IT Admin
 *   npm run admin -- list
 * Stop the server first or run it against the same data directory (SQLite handles the lock).
 */
import crypto from 'node:crypto';
import path from 'node:path';
import { hashPassword, randomPassword } from './auth';
import { Storage } from './storage';

const [cmd, email, name] = process.argv.slice(2);
const store = new Storage(path.resolve(process.env.RDMS_DATA_DIR ?? 'data'));
const fail = (m: string) => { console.error(m); process.exit(1); };

if (cmd === 'list') {
  console.table(store.platform.prepare("SELECT email, name, status FROM accounts WHERE role = 'it_admin'").all());
} else if (cmd === 'create') {
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail('Usage: npm run admin -- create <email> "<Full name>"');
  if (store.platform.prepare('SELECT 1 FROM accounts WHERE email = ?').get(email)) fail('An account with that email already exists.');
  const pw = randomPassword();
  store.platform.prepare(`INSERT INTO accounts (id, email, password_hash, role, institution_id, status, name, designation, requested_at, reviewed_by, reviewed_at, affiliation_verified)
    VALUES (?, ?, ?, 'it_admin', NULL, 'active', ?, 'Platform IT Administrator', ?, 'Server CLI', ?, 1)`)
    .run(`acc_${crypto.randomBytes(8).toString('hex')}`, email.toLowerCase(), hashPassword(pw), name || 'IT Admin', new Date().toISOString(), new Date().toISOString());
  store.audit({ actorName: 'Server CLI', action: 'IT Admin created', target: email });
  console.log(`IT Admin ${email} created. One-time password: ${pw}`);
} else if (cmd === 'reset') {
  const row = store.platform.prepare("SELECT id FROM accounts WHERE email = ? AND role = 'it_admin'").get(email) as { id: string } | undefined;
  if (!row) fail('No IT Admin with that email.');
  const pw = randomPassword();
  store.platform.prepare('UPDATE accounts SET password_hash = ? WHERE id = ?').run(hashPassword(pw), row!.id);
  store.platform.prepare('DELETE FROM sessions WHERE account_id = ?').run(row!.id);
  store.audit({ actorName: 'Server CLI', action: 'IT Admin password reset', target: email });
  console.log(`New one-time password for ${email}: ${pw}`);
} else {
  fail('Usage: npm run admin -- create <email> "<Full name>" | reset <email> | list');
}
store.close();
