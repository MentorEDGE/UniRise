/** npm run seed — deletes ALL data in the data directory and recreates the demo platform. */
import fs from 'node:fs';
import path from 'node:path';
import { DEMO_PASSWORDS, seedDemo } from './demo';
import { Storage } from './storage';

const dir = path.resolve(process.env.RDMS_DATA_DIR ?? 'data');
fs.rmSync(dir, { recursive: true, force: true });
const store = new Storage(dir);
seedDemo(store);
store.close();
console.log(`Demo platform recreated in ${dir}`);
console.log(`  Management: director@abc.edu.in, vc@xyz.ac.in / ${DEMO_PASSWORDS.management}`);
console.log(`  Faculty:    e.g. faculty.a@abc.edu.in / ${DEMO_PASSWORDS.faculty}`);
console.log(`  Office of Research: office@abc.edu.in, office@xyz.ac.in / ${DEMO_PASSWORDS.office}`);
