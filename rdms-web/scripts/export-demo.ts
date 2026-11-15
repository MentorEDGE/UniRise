/**
 * Exports the sample institutions (data in the UI's DB shape, and their demo accounts with passwords) for the Java
 * backend's demo-data endpoint: POST /api/platform/tenants/{slug}/demo-data with body { db, accounts }.
 * Usage: npx tsx scripts/export-demo.ts [--small] > demo.json
 */
import { createSeed } from '../src/lib/seed';
import { DEMO_INSTITUTIONS, DEMO_PASSWORDS } from '../server/demo';

const small = process.argv.includes('--small');
const out = DEMO_INSTITUTIONS.map((d) => {
  const seed = small ? { ...d.seed, sizes: d.seed.sizes.map(() => 2) } : d.seed;
  const db = createSeed(seed);
  const accounts = [
    { email: d.office.email, password: DEMO_PASSWORDS.office, role: 'office', name: d.office.name, designation: 'Office of Research' },
    ...d.management.map((m) => ({ email: m.email, password: DEMO_PASSWORDS.management, role: 'management', name: m.name, designation: m.designation })),
    ...db.faculty.map((f) => ({ email: f.email, password: DEMO_PASSWORDS.faculty, role: 'faculty', name: f.name, title: f.title, designation: f.designation, department: f.department, facultyId: f.id, status: f.active ? 'active' : 'deactivated' })),
  ];
  return { slug: d.inst.slug, name: d.inst.name, db, accounts };
});
process.stdout.write(JSON.stringify(out));
