# UniRise RMS – Web frontend

React 18 + TypeScript + Vite + Tailwind. Styled with the design tokens of https://mentoredge.co.in/unirise
(violet palette, Figtree, `rounded-2xl` cards, translucent sticky header, light/dark themes). Tokens and global
behaviours in `src/index.css` mirror `MentorEDGE-Web/app/globals.css`; keep them in sync with that file.
Architecture: `docs/RMS_FRONTEND_ARCHITECTURE.md`. Requirements: `../rms-docs/`.

## Run
```bash
npm install
cp .env.example .env     # VITE_USE_MOCK=true runs on built-in sample data (default)
npm run dev              # http://localhost:5173  (pick a demo role on the sign-in page)
npm test                 # Vitest: access rules and the logic of every feature area
npm run build            # type-check + production build into dist/
```
Sample data lives in memory, so edits reset when the page reloads. Everything shown in this mode is sample data.

## Status against the RMS docs
The frontend now covers the screens and rules in PRD R3 to R41 that do not need a server, running on sample data.
Every call has a sample-data version (`src/mock/ext/*.ts` and `src/lib/api.ts`) and a matching HTTP version that targets
the planned endpoints in TRD §5. The backend comes later; until then the HTTP versions are untested.

| Area | What is in the UI |
|---|---|
| Entry modules (R37-R41) | Publication entry by type with outside, ex-faculty and ex-student authors and PDF choice; five-step grant wizard; seed money with the quarterly window; 19 publication and grant reports; find a researcher by ID. Approve, rework, revision, reject. |
| People and structure (R7, R8, R23, R24) | CSV import of people and org units with preview and per-row errors (safe to re-run); mark someone as left; org tree with move; assign, end and reassign supervisors (primary, co, backup) and a reassignment prompt when a supervisor has left; profile tabs for claims, supervision and appointments (joint appointments); ORCID connect and public-profile consent. |
| Progress (R25, R26) | Milestones: add, edit, mark done, approve with feedback. Meeting logs (scholar and named supervisor only). Reminders with escalation to the HoD, shown in the app with the reason. Role-based Home with a "next due" card, and "your standing" instead of a leaderboard for researchers. |
| Data quality (R11-R14, R30) | Duplicates screen with side-by-side merge; disputes (raise, resolve, audit); open-access and funder-mandate fields, badge and filter; review queue with admin override, department filter and undo; version-conflict warning on publication edits; harvest status with a sample "run now". |
| Access (R3, R5, R27) | Roles and access: grants with validity dates, acting and delegated roles, access review; Guest (time-limited, one item) and IT admin (no research content); audit log and access log with filters and CSV export; named drill-downs by executives and deans are logged and noticed. |
| Tenant and platform (R2, R4, R22, R32-R36) | Tenant settings (logo text, accent colour with contrast check, currency, fiscal year, escalation days); classification lists with validity dates; API keys (shown once, rotate, revoke) and webhooks; SSO status; platform console (create sandbox or pilot, convert, suspend, export, delete with typed confirmation, support access, monthly active researchers); public profile site; sandbox email-link sign-in. |
| Reporting (R14, R16, R18-R20, R28, R29) | Saved reports; export jobs with progress; annual faculty report and an accreditation summary (sample format); analytics (collaboration, trends, benchmark, open-access); period close with frozen snapshots; counting by appointment on the publication date; projects with restricted confidential projects; print stylesheet. |

## Not built
- **Languages (i18n):** strings are written in the components. Translation files are not set up.
- **Server-side behaviour:** real email delivery, real PDF generation (PDF is the browser's print view), real uploads (only file names are kept), real OIDC/SAML sign-in, virus scanning, and everything else that needs a backend.
- **Sample harvest:** "Run harvest" re-uses existing sample records; it does not call ORCID, OpenAlex or Crossref.
- **Accreditation format:** the accreditation summary is a sample layout until the first customer defines theirs (PRD open question).
- **PRD R42:** Grant Call, Incentive Point, Journal Entry, APC, IPR, Approval inbox, PAS, Conference and global Search. The source names them without describing them.
- **Not wired to a backend:** the HTTP versions of the calls have not been run against a server.

## Connect to a backend later
Set `VITE_USE_MOCK=false` and `RMS_API_URL=http://localhost:8080`; `/api` is proxied in dev and served from the same origin in
production. The planned endpoints are listed in `../rms-docs/TRD.md` §5 and are called from `src/lib/api.ts` and `src/mock/ext/*.ts`
(each file's `real` object). The default is sample-data mode, so a production build must set `VITE_USE_MOCK=false` explicitly.

## Demo roles
Mock mode offers: Research Admin, Executive (Pro-VC), Dean, HoD, Acting HoD, Supervisor, Researcher, PhD scholar, Viewer,
IT administrator, External examiner (guest) and Platform operator. Scope follows the org tree and the rules in
`../rms-docs/ACCESS_AND_VISIBILITY_MODEL.md`: a researcher sees only their own record, a supervisor their mentees, a HoD or dean
their unit. Role hiding in the UI is a convenience; the mock functions enforce the rules themselves, as a server must.

## Layout
```
src/app/         providers (theme, auth, tenant theme, query), router
src/components/  ui/ (Button, Card, Table, Dialog, Toast…) and layout/ (AppShell, PageHeader)
src/features/    auth, dashboard, publications, people, awards, review, reports, settings, organisation, units,
                 progress, mentees, duplicates, access, platform, public, projects, grants, seedmoney, lookup
src/lib/         api (merges the feature slices), http client, types, utils
src/mock/        seed data, shared helpers (scope, audit, access log), ext/ (one file per feature area, with tests)
```
