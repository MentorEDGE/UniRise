import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { createApp } from './app';
import { DEMO_PASSWORDS, seedDemo } from './demo';
import { Storage } from './storage';

const production = process.env.NODE_ENV === 'production';
const dir = path.resolve(process.env.RDMS_DATA_DIR ?? 'data');
const port = Number(process.env.PORT ?? (production ? 8080 : 5190));
const host = process.env.HOST ?? '127.0.0.1';

const store = new Storage(dir);
if (!store.institutions().length) {
  const { adminEmail, adminPassword } = seedDemo(store);
  console.log(`\nCreated the demo platform in ${dir}`);
  console.log(`  Management:  director@sit.edu.in, vc@greenfield.ac.in  /  ${DEMO_PASSWORDS.management}`);
  console.log(`  Faculty:     e.g. anita.rao@sit.edu.in  /  ${DEMO_PASSWORDS.faculty}`);
  console.log(`  IT Admin:    ${adminEmail}  /  ${adminPassword}   (sign in at /#/admin; shown only now)\n`);
}

const app = createApp(store, { secureCookies: production });
const dist = path.resolve('dist');
if (production && fs.existsSync(dist)) {
  app.use((_req, res, next) => {
    res.set('Content-Security-Policy', "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    next();
  });
  app.use(express.static(dist, { index: 'index.html' }));
  app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

app.listen(port, host, () => console.log(`RDMS API listening on http://${host}:${port}${production ? '' : ' (open the app at http://localhost:5180)'}`));
