# UniRise RMS – multi-institution Research Data Management System

One UniRise platform serving many colleges and universities. Each institution signs in to its own environment, sees
its own name next to the UniRise brand, and works only with its own data. This folder is the website (React, Vite,
TypeScript). The backend is the Java API in `../unirise-api`; the old Node/SQLite prototype server was removed on
2026-11-17 and its API tests were ported to the Java test suite.

> **Location:** this project lives in `~/Projects/rdms-web`, outside iCloud Drive. Do not move it into Desktop or
> Documents while iCloud's "Optimize Mac Storage" is on: offloaded files make npm and Vite fail with `ETIMEDOUT`.

## Where it runs
- **Dev site:** https://dev-unirise.mentoredge.co.in (Hostinger, published from the `dev` branch). It calls the Java API
  at https://api.dev-unirise.mentoredge.co.in (AWS) — see `src/lib/store.ts` (`KNOWN_APIS`).
- **Demo accounts:** every sample account uses the demo password **`Unirise123`**.

| Account | Role |
|---|---|
| `office@abc.edu.in`, `office@xyz.ac.in` | Office of Research of each institution |
| `director@abc.edu.in`, `dean@abc.edu.in`, `vc@xyz.ac.in`, `registrar@xyz.ac.in` | Top-Level Management |
| any faculty email, e.g. `john.doe@abc.edu.in`, `jane.doe@xyz.ac.in` | Faculty |

## Run on your own machine
Needs Node 20, Java 21 and Docker (Colima on a Mac).

```bash
# 1. a database (any PostgreSQL 16 works)
docker run -d --name unirise-local-pg -e POSTGRES_DB=unirise -e POSTGRES_USER=unirise \
  -e POSTGRES_PASSWORD=local-dev-only -p 127.0.0.1:55432:5432 postgres:16

# 2. the API (in ../unirise-api)
./mvnw -q -DskipTests package
CONTROL_DB_URL=jdbc:postgresql://127.0.0.1:55432/unirise CONTROL_DB_USER=unirise RMS_DB_PASSWORD=local-dev-only \
TENANT_DB_HOST=127.0.0.1 TENANT_DB_PORT=55432 RMS_ADMIN_KEY=local-admin-key SESSION_SECURE_COOKIE=false \
SERVER_PORT=8181 java -jar target/unirise-api-0.0.1-SNAPSHOT.jar

# 3. the sample institutions (here)
npm install
RMS_ADMIN_KEY=local-admin-key scripts/load-demo.sh http://127.0.0.1:8181

# 4. the website: http://localhost:5180 (Vite forwards /api to the API; API=... to point elsewhere)
npm run dev
```
Locally there is no S3 bucket or email: file fields keep the file name only, and enquiries are stored without being
emailed. Both work on AWS.

Other commands: `npm test` (rules, analytics, reports, CSV), `npm run build` (type-check and build into `dist/`),
`node scripts/api-proxy.mjs` (serves `dist/` and forwards `/api` to `API`, default `http://127.0.0.1:8181`, on port 8201).

## Sample data
- `scripts/load-demo.sh <api address>`: creates the two sample institutions on a Java API (operator key in
  `RMS_ADMIN_KEY`) and loads them; every account gets the demo password, or with `RANDOM_PASSWORD=1` one new random
  password printed once. An institution that already exists is refused and left as it is. For AWS dev:

  ```bash
  RMS_ADMIN_KEY="$(aws secretsmanager get-secret-value --region ap-south-1 --secret-id unirise/dev/admin-key \
    --query SecretString --output text)" scripts/load-demo.sh https://api.dev-unirise.mentoredge.co.in
  ```
- `npm run demo:export -- [--small] [--random-password] > demo.json`: the same data as JSON, for the API's
  `POST /api/platform/tenants/{slug}/demo-data`. ABC Institute of Technology has departments only; XYZ University has
  three schools. Names are placeholders (John Doe, Jane Doe, …), defined in `src/lib/seed.ts` and `src/lib/demo.ts`.

## Onboarding a new institution
1. The institution fills in **Talk to Our Team** (`/#/talk-to-our-team`). The API stores the enquiry and emails it to
   corporate@mentoredge.co.in, with Reply-To the person who enquired.
2. The UniRise team provisions it with the operator API (`POST /api/platform/tenants`, see `../unirise-api/README.md`);
   it gets its own database and its first Office of Research account.
3. The Office of Research creates faculty and Top-Level Management accounts under **User Management → Users → + Add
   user**; each gets a temporary password to hand over.
4. Faculty maintain their profiles and submit entries; the Office of Research approves them; management sees approved data.

## Roles
| Role | Can |
|---|---|
| **Faculty** | Only their own profile and records: profile updates, the seven record types (publications, grants and fellowships, seed money, FDPs, conferences, honours and awards, intellectual property), files, collaborations, own performance and targets, CV, submission history. Every entry and profile change waits for the Office of Research. Colleagues appear only as name and department, for picking co-authors. |
| **Top-Level Management** | Read-only view of the institution: dashboard, Find Profiles, profiles, record views and reports, Research Networks, analytics. Approved records of current faculty only. |
| **Office of Research** | Dashboard with the approval queue; Approval (review, return for correction, reject, grant outcomes); User Management and audit log; official faculty details and former faculty; Institution (name, record types, schools, departments), Targets & Scoring, Notices. Everything management sees. 30-minute idle timeout. |

Former faculty (retired, resigned, transferred) stay in the database but count in no figure, chart, report or ranking.

## Layout
```
src/lib/        store.ts (API client, uploads), domain.ts (record rules, also the reference for the Java API), types,
                seed.ts and demo.ts (sample data), analytics (incl. forAnalysis), reports, org.ts (schools), entities, csv
src/components/ Layout (header, menu bar), ui (incl. the file picker), charts, Logo
src/pages/      admin/ (Office of Research console), office/ (dashboard, settings), faculty/, mgmt/, shared/
scripts/        load-demo.sh, export-demo.ts, api-proxy.mjs
public/         images, .htaccess (Hostinger: the page itself is never cached)
```
See `../rms-docs/RDMS_WEB_FEATURES.md` for every feature and `../rms-docs/BACKEND_PLAN.md` for what is built and what is left.
