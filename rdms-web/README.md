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
On first start the server creates the demo platform in `data/` and prints the Office of Research password **once**.
`npm run seed` deletes everything in `data/` and recreates the demo (and prints a new Office of Research password).

| Sign in at | Account | Password |
|---|---|---|
| `/#/login` | `director@sit.edu.in`, `dean@sit.edu.in` (Sample Institute of Technology, management) | `Admin@1234` |
| `/#/login` | `vc@greenfield.ac.in`, `registrar@greenfield.ac.in` (Greenfield University, management) | `Admin@1234` |
| `/#/login` | any faculty email, e.g. `anita.rao@sit.edu.in` | `Faculty@123` |
| `/#/admin` | `research.office@unirise.platform` (Office of Research) | printed by the server on first start |

Office of Research accounts are created only on the server: `npm run admin -- create <email> "<Full name>"`,
`npm run admin -- reset <email>`, `npm run admin -- list`. Each prints a one-time password.

## Roles
| Role | Level | Can |
|---|---|---|
| **Office of Research** | Platform | Approve or reject access requests, assign institution and role, confirm affiliation, activate / suspend / deactivate accounts, reset passwords, change roles, add and suspend institutions, read the audit log. **Cannot read any institution's research data.** Separate sign-in route (`/#/admin`), not shown on the public pages; 30-minute idle timeout. |
| **Top-Level Management** | Institution | Everything inside its own institution: dashboard (departments, faculty, biodata, FDPs, conferences, honours & awards), analytics, approvals, faculty directory and profiles, all reports, settings, notices. |
| **Faculty** | Institution | Own profile (biodata and CV), publications, grants, seed money, FDPs, conferences, honours & awards, own statistics and reports. Sees colleagues' **approved publications** and directory entries only; never their biodata, FDPs, conferences, honours, grants or contact details. |

**Access flow:** someone requests access at `/#/register` (institution, role, details) → the request is pending →
The Office of Research checks it (the email domain is compared with the institution's; a mismatch is flagged) and must tick
"affiliation verified" to approve → only then can the person sign in, and they land on their role's dashboard.
Faculty approval links the account to the faculty profile with that employee code, or creates the profile.
Management can add faculty profiles in advance; the person still requests access to sign in.

## How data is kept apart
Following `rms-docs/MULTI_TENANCY_DESIGN.md`, at small scale:
- `data/platform.sqlite` (control plane): institutions, accounts (scrypt password hashes), sessions (hashed tokens), audit log. No research data.
- `data/tenants/<institution>.sqlite`: **one database per institution** with its departments, faculty, biodata, publications, grants, seed money, FDPs, conferences, honours & awards, notices and settings.
- The server picks the institution database **only from the signed-in account**. Nothing in the request can choose it; an id from another institution is a plain 404.
- Every permission rule runs on the server (`src/lib/domain.ts`), which also whitelists fields: a client cannot approve its own entry, change its owner, or set sanctioned amounts. The browser receives only the slice its role may see (`scopeFor`), so analytics for faculty are computed from their own records only.
- Sessions: HttpOnly, SameSite=Strict cookie (Secure in production); every state-changing call needs an `X-RDMS` header (CSRF); 5 failed sign-ins lock an email for 15 minutes; suspending a user or institution ends their sessions immediately.

## Tests
`server/api.test.ts` runs the real API on a temporary data directory: institution isolation (data, foreign ids, the client cannot pick the institution, one database file each), faculty privacy, Office of Research separation (cannot use the regular sign-in, cannot read data), registration → approval → sign-in, rejection, suspension of users and institutions, CSRF header, login lockout, persistence across restart. `src/lib/logic.test.ts` covers the rules, analytics counting, reports and CSV.

## Not built yet
- **Email:** registration and approval notices, password reset by email. The Office of Research hands over temporary passwords.
- **File uploads:** only file names are stored. PDFs and certificates need object storage with virus scanning.
- **SSO** (SAML/OIDC) per institution, and two-factor sign-in for the Office of Research.
- **Scale-out:** SQLite with one server process (login throttling and the tenant cache live in memory). The design in `rms-docs` moves this to PostgreSQL per tenant behind a tenant router.
- **Backups and export** per institution, and break-glass support access.
- React Router has two moderate advisories (`npm audit --omit=dev`) fixed only in v7; neither applies to how this app uses it, but upgrade when convenient.

## Layout
```
server/         app.ts (API and permission checks), storage.ts (platform DB + one DB per institution), auth.ts, demo.ts, seed.ts, admin.ts (Office of Research CLI)
src/lib/        domain.ts (rules, shared with the server), store.ts (API client), types, seed (sample data), analytics, reports, entities, csv
src/components/ Layout (header, menu bar), ui, charts, Logo
src/pages/      admin/ (Office of Research console), faculty/, mgmt/, shared/ (views, biodata, reports, settings, sign-in, request access)
```
