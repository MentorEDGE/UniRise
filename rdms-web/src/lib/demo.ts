import { DEFAULT_SEED } from './seed';
import type { SeedOptions } from './seed';
import type { Institution } from './types';

/**
 * The sample institutions (ABC Institute of Technology, XYZ University with three schools) and their demo accounts, as
 * loaded into a Java API with scripts/load-demo.sh. Every demo account uses one demo password (decided 2026-11-17).
 */
export const DEMO_PASSWORD = 'Unirise123';

export interface DemoInstitution { inst: Omit<Institution, 'createdAt' | 'status'>; seed: SeedOptions; office: { name: string; email: string }; management: { name: string; designation: string; email: string }[] }

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
      schools: [
        { name: 'School of Sciences', departments: ['Physics', 'Chemistry', 'Mathematics'] },
        { name: 'School of Commerce & Humanities', departments: ['Commerce', 'English Literature'] },
        { name: 'School of Engineering', departments: ['Computer Science & Engineering'] },
      ],
      reviewerName: 'Office of Research',
    },
    office: { name: 'Office of Research, XYZ', email: 'office@xyz.ac.in' },
    management: [
      { name: 'Vice-Chancellor, XYZ', designation: 'Vice-Chancellor', email: 'vc@xyz.ac.in' },
      { name: 'Registrar, XYZ', designation: 'Registrar', email: 'registrar@xyz.ac.in' },
    ],
  },
];
