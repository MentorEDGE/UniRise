/** npm run seed — deletes ALL data in the data directory and recreates the demo platform. */
import fs from 'node:fs';
import path from 'node:path';
import { DEMO_PASSWORDS, seedDemo } from './demo';
import { Storage } from './storage';

const dir = path.resolve(process.env.RDMS_DATA_DIR ?? 'data');
fs.rmSync(dir, { recursive: true, force: true });
const store = new Storage(dir);
const { adminEmail, adminPassword } = seedDemo(store);
store.close();
console.log(`Demo platform recreated in ${dir}`);
console.log(`  Management: director@sit.edu.in, vc@greenfield.ac.in / ${DEMO_PASSWORDS.management}`);
console.log(`  Faculty:    e.g. anita.rao@sit.edu.in / ${DEMO_PASSWORDS.faculty}`);
console.log(`  Office of Research:   ${adminEmail} / ${adminPassword}   (sign in at /#/admin; shown only now)`);
