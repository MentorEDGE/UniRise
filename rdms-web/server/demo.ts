import crypto from 'node:crypto';
import { createSeed, DEFAULT_SEED } from '../src/lib/seed';
import type { SeedOptions } from '../src/lib/seed';
import type { Institution } from '../src/lib/types';
import { hashPassword } from './auth';
import type { Storage } from './storage';

export const DEMO_PASSWORDS = { management: 'Admin@1234', faculty: 'Faculty@123', office: 'Office@1234' };

interface DemoInstitution { inst: Omit<Institution, 'createdAt' | 'status'>; seed: SeedOptions; office: { name: string; email: string }; management: { name: string; designation: string; email: string }[] }

export const DEMO_INSTITUTIONS: DemoInstitution[] = [
  {
    inst: { id: 'abc', slug: 'abc', name: 'ABC Institute of Technology', tagline: 'Faculty Research & Development Portal', emailDomain: 'abc.edu.in' },
    seed: DEFAULT_SEED,
    office: { name: 'Office of Research, ABC', email: 'office@abc.edu.in' },
    management: [
      { name: 'Director, ABC', designation: 'Director', email: 'director@abc.edu.in' },
      { name: 'Dean (Research), ABC', designation: 'Dean (Research)', email: 'dean@abc.edu.in' },
    ],
  },
  {
    inst: { id: 'xyz', slug: 'xyz', name: 'XYZ University', tagline: 'Research & Faculty Development Office', emailDomain: 'xyz.ac.in' },
    seed: {
      name: 'XYZ University', tagline: 'Research & Faculty Development Office', emailDomain: 'xyz.ac.in', seed: 777,
      departments: ['Physics', 'Chemistry', 'Mathematics', 'Commerce', 'English Literature', 'Computer Science & Engineering'], sizes: [5, 5, 4, 6, 4, 6],
      reviewerName: 'Office of Research',
    },
    office: { name: 'Office of Research, XYZ', email: 'office@xyz.ac.in' },
    management: [
      { name: 'Vice-Chancellor, XYZ', designation: 'Vice-Chancellor', email: 'vc@xyz.ac.in' },
      { name: 'Registrar, XYZ', designation: 'Registrar', email: 'registrar@xyz.ac.in' },
    ],
  },
];

/**
 * Creates the demo platform: two institutions, each with its own database, its Office of Research, its management
 * and faculty accounts. Accounts are never self-registered: in real use UniRise provisions the institution and its
 * Office of Research (npm run provision), and the Office of Research creates everyone else. `small` keeps tests fast.
 */
export function seedDemo(store: Storage, opts: { small?: boolean } = {}) {
  const now = new Date().toISOString();
  const insert = store.platform.prepare(`INSERT INTO accounts (id, email, password_hash, role, institution_id, faculty_id, status, name, title, designation, department, employee_code, request_note, requested_at, reviewed_by, reviewed_at, affiliation_verified)
    VALUES (@id, @email, @hash, @role, @inst, @fac, 'active', @name, @title, @designation, @department, @code, '', @at, @by, @at, 1)`);
  const id = () => `acc_${crypto.randomBytes(8).toString('hex')}`;
  // Hash each demo password once: the demo accounts share passwords anyway, and this keeps seeding quick.
  const mgmtHash = hashPassword(DEMO_PASSWORDS.management);
  const facHash = hashPassword(DEMO_PASSWORDS.faculty);
  const officeHash = hashPassword(DEMO_PASSWORDS.office);

  for (const d of DEMO_INSTITUTIONS) {
    const seed = opts.small ? { ...d.seed, sizes: d.seed.sizes.map(() => 2) } : d.seed;
    const data = createSeed(seed);
    store.createInstitution({ ...d.inst, status: 'active', createdAt: now }, data);
    insert.run({ id: id(), email: d.office.email, hash: officeHash, role: 'office', inst: d.inst.id, fac: null, name: d.office.name, title: '', designation: 'Office of Research', department: '', code: '', at: now, by: 'UniRise provisioning' });
    for (const m of d.management) {
      insert.run({ id: id(), email: m.email, hash: mgmtHash, role: 'management', inst: d.inst.id, fac: null, name: m.name, title: '', designation: m.designation, department: '', code: '', at: now, by: d.office.name });
    }
    for (const f of data.faculty) {
      insert.run({ id: id(), email: f.email, hash: facHash, role: 'faculty', inst: d.inst.id, fac: f.id, name: f.name, title: f.title, designation: f.designation, department: f.department, code: f.id, at: now, by: d.office.name });
    }
  }
  store.audit({ actorName: 'UniRise provisioning', action: 'Demo platform created', detail: DEMO_INSTITUTIONS.map((d) => d.inst.name).join(', ') });
}
