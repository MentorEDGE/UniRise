# UniRise RMS – multi-institution Research Data Management System

One UniRise platform serving many colleges and universities. Each institution signs in to its own environment, sees
its own name next to the UniRise brand, and works only with its own data. It keeps the classic RMS layout (header
band, dropdown menu bar, form panels, link-list reports) with the UniRise visual identity and introduction page.

> **Location:** this project lives in `~/Projects/rdms-web`, outside iCloud Drive. Do not move it into Desktop or
> Documents while iCloud's "Optimize Mac Storage" is on: offloaded files make npm, Vite and SQLite fail with `ETIMEDOUT`.

## Run
```bash
npm install
npm run dev        # API on 127.0.0.1:5190 + web on http://localhost:5180
npm test           # rule tests + HTTP API tests (isolation, roles, approvals, sessions)
npm run build      # type-check and build the web app into dist/
npm start          # production: one server on :8080 serving the API and dist/ (secure cookies; put HTTPS in front)
```
On first start the server creates the demo platform in `data/` (two institutions, each with its own database).
`npm run seed` deletes everything in `data/` and recreates the demo. Everyone signs in at `/#/login`; the role and
institution come from the account. There is no public sign-up.

| Account | Password |
|---|---|
| `office@abc.edu.in`, `office@xyz.ac.in` (Office of Research of each institution) | `Office@1234` |
| `director@abc.edu.in`, `dean@abc.edu.in`, `vc@xyz.ac.in`, `registrar@xyz.ac.in` (Top-Level Management) | `Admin@1234` |
| any faculty email, e.g. `faculty.a@abc.edu.in` | `Faculty@123` |

## Onboarding a new institution
1. The institution fills in **Talk to Our Team** (`/#/talk-to-our-team`). The enquiry is stored and emailed to corporate@mentoredge.co.in.
2. The UniRise team provisions it on the server:
   `npm run provision -- institution <id> "<Name>" <email-domain> "<Dept 1; Dept 2>"` (creates its own database), then
   `npm run provision -- office <id> <email> "<Full name>"` (Office of Research account; prints a one-time password).
   Also: `provision -- reset <office-email>`, `suspend <id>`, `activate <id>`, `list`, `enquiries`.
3. The Office of Research signs in and creates faculty and Top-Level Management accounts under **User Management → Users → + Add user**
   (role, name, institutional email, department, designation, status). Each gets a temporary password to hand over.
4. Faculty maintain their profiles and submit entries; the Office of Research approves them; management sees approved data.

## Roles
| Role | Can |
|---|---|
| **Faculty** | Only their own profile and records: profile updates, publications, grants and fellowships, seed money, FDPs, conferences, honours and awards, collaborations, own metrics and CV, own submission history. Every new entry and every profile change waits for the Office of Research. Cannot see other faculty's profiles or statistics (colleagues appear only as name and department, for picking co-authors). |
| **Top-Level Management** | Read-only view of the institution: Find Profiles (search, SDG filters), full approved profiles with Google Scholar metrics, networks and maps, Research Networks, analytics and reports. Cannot create or edit accounts, profiles or records, approve, or change institution settings, targets or notices. Sees approved data only. |
| **Office of Research** (one or more per institution) | Everything management sees, plus: Approval (entries and profile updates: approve, return for correction, reject, history, grant outcomes), User Management (create, activate, deactivate, reset passwords, change faculty/management role), official faculty details and deactivation, Institution & Departments, Targets & Scoring, Notices, audit log. Only for its own institution. 30-minute idle timeout. |

## Email (enquiries)
Enquiries are always stored (`npm run provision -- enquiries` lists them). To email them, set on the server:
`SMTP_HOST`, `SMTP_PORT` (587), `SMTP_USER`, `SMTP_PASS`, `SMTP_SECURE` (`true` for 465), optionally `MAIL_FROM` and `ENQUIRY_TO`
(default corporate@mentoredge.co.in). Credentials stay on the server; see `server/mail.ts`.

## How data is kept apart
Following `rms-docs/MULTI_TENANCY_DESIGN.md`, at small scale:
- `data/platform.sqlite` (control plane): institutions, accounts (every account belongs to one institution; scrypt password hashes), sessions (hashed tokens), audit log, website enquiries. No research data.
- `data/tenants/<institution>.sqlite`: **one database per institution** with its departments, faculty, biodata, publications, grants, seed money, FDPs, conferences, honours & awards, notices and settings.
- The server picks the institution database **only from the signed-in account**. Nothing in the request can choose it; an id from another institution is a plain 404.
- Every permission rule runs on the server (`src/lib/domain.ts`), which also whitelists fields: a client cannot approve its own entry, change its owner, or set sanctioned amounts. The browser receives only the slice its role may see (`scopeFor`), so analytics for faculty are computed from their own records only.
- Sessions: HttpOnly, SameSite=Strict cookie (Secure in production); every state-changing call needs an `X-RDMS` header (CSRF); 5 failed sign-ins lock an email for 15 minutes; suspending a user or institution ends their sessions immediately.

## Tests
`server/api.test.ts` runs the real API on a temporary data directory: institution isolation (data, foreign ids, the client cannot pick the institution, one database file each), faculty privacy, Office of Research separation (cannot use the regular sign-in, cannot read data), registration → approval → sign-in, rejection, suspension of users and institutions, CSRF header, login lockout, persistence across restart. `src/lib/logic.test.ts` covers the rules, analytics counting, reports and CSV.

## Not built yet
- **Email to users:** account invitations and password reset by email. The Office of Research hands over temporary passwords.
- **File uploads:** only file names are stored. PDFs and certificates need object storage with virus scanning.
- **SSO** (SAML/OIDC) per institution, and two-factor sign-in for the Office of Research.
- **Scale-out:** SQLite with one server process (login throttling and the tenant cache live in memory). The design in `rms-docs` moves this to PostgreSQL per tenant behind a tenant router.
- **Backups and export** per institution, and break-glass support access.
- React Router has two moderate advisories (`npm audit --omit=dev`) fixed only in v7; neither applies to how this app uses it, but upgrade when convenient.

## Layout
```
server/         app.ts (API and permission checks), storage.ts (platform DB + one DB per institution), auth.ts, mail.ts, demo.ts, seed.ts, provision.ts (UniRise CLI)
src/lib/        domain.ts (rules, shared with the server), store.ts (API client), types, seed (sample data), analytics, reports, entities, csv
src/components/ Layout (header, menu bar), ui, charts, Logo
src/pages/      admin/ (Office of Research console), faculty/, mgmt/, shared/ (views, biodata, reports, settings, sign-in, request access)
```
