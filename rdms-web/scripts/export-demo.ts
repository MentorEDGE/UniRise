/**
 * Exports the sample institutions (data in the UI's DB shape, and their demo accounts with passwords) for the Java
 * backend's demo-data endpoint: POST /api/platform/tenants/{slug}/demo-data with body { db, accounts }.
 * Usage: npx tsx scripts/export-demo.ts [--small] [--random-passwords] > demo.json
 *
 * By default the accounts get the demo passwords printed in the README: fine on your own machine, never for a server
 * others can reach. For any shared or public server use --random-passwords: each role gets a new random password,
 * printed once to the terminal (stderr) and never written into demo.json's neighbours or the repo.
 */
import { randomBytes } from 'node:crypto';
import { createSeed } from '../src/lib/seed';
import { DEMO_INSTITUTIONS, DEMO_PASSWORDS } from '../server/demo';

const small = process.argv.includes('--small');
// 16 characters from an unambiguous alphabet, with a digit so it meets the API's password rule.
const random = () => { const a = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'; return [...randomBytes(15)].map((b) => a[b % a.length]).join('') + String(randomBytes(1)[0] % 10); };
const passwords = process.argv.includes('--random-passwords') ? { office: random(), management: random(), faculty: random() } : DEMO_PASSWORDS;
if (passwords !== DEMO_PASSWORDS) process.stderr.write(`Demo passwords for this load (keep them private):\n  Office of Research: ${passwords.office}\n  Management:         ${passwords.management}\n  Faculty:            ${passwords.faculty}\n`);
const out = DEMO_INSTITUTIONS.map((d) => {
  const seed = small ? { ...d.seed, sizes: d.seed.sizes.map(() => 2) } : d.seed;
  const db = createSeed(seed);
  const accounts = [
    { email: d.office.email, password: passwords.office, role: 'office', name: d.office.name, designation: 'Office of Research' },
    ...d.management.map((m) => ({ email: m.email, password: passwords.management, role: 'management', name: m.name, designation: m.designation })),
    ...db.faculty.map((f) => ({ email: f.email, password: passwords.faculty, role: 'faculty', name: f.name, title: f.title, designation: f.designation, department: f.department, facultyId: f.id, status: f.active ? 'active' : 'deactivated' })),
  ];
  return { slug: d.inst.slug, name: d.inst.name, db, accounts };
});
process.stdout.write(JSON.stringify(out));
