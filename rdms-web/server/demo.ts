import crypto from 'node:crypto';
import { createSeed, DEFAULT_SEED } from '../src/lib/seed';
import type { SeedOptions } from '../src/lib/seed';
import type { Institution } from '../src/lib/types';
import { hashPassword, randomPassword } from './auth';
import type { Storage } from './storage';

export const DEMO_PASSWORDS = { management: 'Admin@1234', faculty: 'Faculty@123' };

interface DemoInstitution { inst: Omit<Institution, 'createdAt' | 'status'>; seed: SeedOptions; management: { name: string; designation: string; email: string }[] }

export const DEMO_INSTITUTIONS: DemoInstitution[] = [
  {
    inst: { id: 'sit', slug: 'sit', name: 'Sample Institute of Technology', tagline: 'Faculty Research & Development Portal', emailDomain: 'sit.edu.in' },
    seed: DEFAULT_SEED,
    management: [
      { name: 'Prof. R. Venkatesh', designation: 'Director', email: 'director@sit.edu.in' },
      { name: 'Dr. S. Mehta', designation: 'Dean (Research)', email: 'dean@sit.edu.in' },
    ],
  },
  {
    inst: { id: 'greenfield', slug: 'greenfield', name: 'Greenfield University', tagline: 'Research & Faculty Development Office', emailDomain: 'greenfield.ac.in' },
    seed: {
      name: 'Greenfield University', tagline: 'Research & Faculty Development Office', emailDomain: 'greenfield.ac.in', seed: 777,
      departments: ['Physics', 'Chemistry', 'Mathematics', 'Commerce', 'English Literature', 'Computer Science & Engineering'], sizes: [5, 5, 4, 6, 4, 6],
      reviewerName: 'Dr. K. Fernandes',
    },
    management: [
      { name: 'Prof. A. Iyengar', designation: 'Vice-Chancellor', email: 'vc@greenfield.ac.in' },
      { name: 'Dr. K. Fernandes', designation: 'Registrar', email: 'registrar@greenfield.ac.in' },
    ],
  },
];

/**
 * Creates the demo platform: two institutions, each with its own database, their management and faculty accounts,
 * a few pending access requests, and one Office of Research account with a random password (returned, never stored in clear).
 * `small` keeps tests fast.
 */
export function seedDemo(store: Storage, opts: { small?: boolean; adminEmail?: string; adminPassword?: string } = {}) {
  const now = new Date().toISOString();
  const insert = store.platform.prepare(`INSERT INTO accounts (id, email, password_hash, role, institution_id, faculty_id, status, name, title, designation, department, employee_code, request_note, requested_at, reviewed_by, reviewed_at, affiliation_verified)
    VALUES (@id, @email, @hash, @role, @inst, @fac, @status, @name, @title, @designation, @department, @code, @note, @at, @by, @at2, @verified)`);
  const id = () => `acc_${crypto.randomBytes(8).toString('hex')}`;
  // Hash each demo password once: the demo accounts share passwords anyway, and this keeps seeding quick.
  const mgmtHash = hashPassword(DEMO_PASSWORDS.management);
  const facHash = hashPassword(DEMO_PASSWORDS.faculty);

  for (const d of DEMO_INSTITUTIONS) {
    const seed = opts.small ? { ...d.seed, sizes: d.seed.sizes.map(() => 2) } : d.seed;
    const data = createSeed(seed);
    store.createInstitution({ ...d.inst, status: 'active', createdAt: now }, data);
    for (const m of d.management) {
      insert.run({ id: id(), email: m.email, hash: mgmtHash, role: 'management', inst: d.inst.id, fac: null, status: 'active', name: m.name, title: '', designation: m.designation, department: '', code: '', note: '', at: now, by: 'Platform setup', at2: now, verified: 1 });
    }
    // Every faculty member has an account except the last one of each institution, who has a pending request instead.
    data.faculty.forEach((f, i) => {
      const last = i === data.faculty.length - 1;
      insert.run({
        id: id(), email: f.email, hash: facHash, role: 'faculty', inst: d.inst.id, fac: last ? null : f.id, status: last ? 'pending' : 'active',
        name: f.name, title: f.title, designation: f.designation, department: f.department, code: f.id, note: last ? 'Joined last semester; profile already created by the department.' : '',
        at: now, by: last ? null : 'Platform setup', at2: last ? null : now, verified: last ? 0 : 1,
      });
    });
  }
  // Requests that need judgement: a new faculty member, one from a personal email, and a management request.
  const pending = [
    { email: 'neha.kapoor@sit.edu.in', role: 'faculty', inst: 'sit', name: 'Neha Kapoor', title: 'Dr.', designation: 'Assistant Professor', department: 'Computer Science & Engineering', code: 'EMP2001', note: 'New joinee, Nov 2026.' },
    { email: 'arjun.physics@gmail.com', role: 'faculty', inst: 'greenfield', name: 'Arjun Menon', title: 'Dr.', designation: 'Assistant Professor', department: 'Physics', code: 'EMP1101', note: 'Using personal email until IT issues an institutional one.' },
    { email: 'iqac@greenfield.ac.in', role: 'management', inst: 'greenfield', name: 'P. Sharma', title: 'Dr.', designation: 'IQAC Coordinator', department: '', code: '', note: 'Needs institution-wide reports for NAAC.' },
  ];
  for (const p of pending) {
    insert.run({ id: id(), email: p.email, hash: facHash, role: p.role, inst: p.inst, fac: null, status: 'pending', name: p.name, title: p.title, designation: p.designation, department: p.department, code: p.code, note: p.note, at: now, by: null, at2: null, verified: 0 });
  }

  const adminEmail = opts.adminEmail ?? 'research.office@unirise.platform';
  const adminPassword = opts.adminPassword ?? randomPassword();
  insert.run({ id: id(), email: adminEmail, hash: hashPassword(adminPassword), role: 'it_admin', inst: null, fac: null, status: 'active', name: 'UniRise Office of Research', title: '', designation: 'Office of Research', department: '', code: '', note: '', at: now, by: 'Platform setup', at2: now, verified: 1 });
  store.audit({ actorName: 'Platform setup', action: 'Demo platform created', detail: DEMO_INSTITUTIONS.map((d) => d.inst.name).join(', ') });
  return { adminEmail, adminPassword };
}
