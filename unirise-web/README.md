# UniRise RMS – Web frontend

React 18 + TypeScript + Vite + Tailwind. Styled with the design tokens of https://mentoredge.co.in/unirise
(violet palette, Figtree, `rounded-2xl` cards, translucent sticky header, light/dark themes). Tokens and global
behaviours in `src/index.css` mirror `MentorEDGE-Web/app/globals.css`; keep them in sync with that file.
Architecture: `docs/RMS_FRONTEND_ARCHITECTURE.md`.

## Run
```bash
npm install
cp .env.example .env     # VITE_USE_MOCK=true runs on built-in sample data
npm run dev              # http://localhost:5173  (pick a demo role on the sign-in page)
npm run build            # type-check + production build into dist/
```

## Connect to the Spring Boot API
Set `VITE_USE_MOCK=false` and `RMS_API_URL=http://localhost:8080`; `/api` is proxied in dev and served from the same
origin in production. `src/lib/api.ts` maps screens to the TRD §5 endpoints.

Endpoints that exist today: departments, researchers, publications (+ `/import?doi=`), awards, `/reports/*`.
**Not built yet (called by the UI, will return errors until added):** `/me`, `/auth/login`, `/auth/logout`,
`/claims` (review queue), publication list filters (`q`, `year`, `type`, `state`, `departmentId`, `sort`),
the `{items,total,page,size}` page shape, and the org-tree and progress endpoints: `/org-units`, `/milestones`,
`/relationships/mentees`, `/reports/units/{id}` (TRD §4–§5). Settings tab data is static sample data.

## Demo roles
Mock mode offers eight sign-ins: Research Admin, Executive (Pro-VC), Dean (school), HoD (department), Supervisor,
Researcher, PhD scholar and Viewer. Scope follows the org tree: a Dean sees their school's departments, a HoD one
department, a Supervisor their own work and mentees. Meeting logs are visible only to the scholar and the named supervisor.
The mock keeps one role per user; the spec allows several role grants per person.

Not yet built from FRONTEND_SPEC v0.2: role grants and access-review screen (§4.13), the drill-down audit log, moving a
unit to a new parent, period selector and snapshots on Units, and the Phase 2 email one-time-link sign-in.

## Layout
```
src/app/         providers (theme, auth, query), router
src/components/  ui/ (Button, Card, Table, Dialog, Toast…) and layout/ (AppShell, PageHeader)
src/features/    auth, dashboard, publications, people, awards, review, reports, settings,
                 organisation, units, progress (scholar), mentees (supervisor)
src/lib/         api (mock + real), http client, types, utils
src/mock/        seed data used when VITE_USE_MOCK=true
```
Role hiding in the UI is a convenience; the server must enforce access and tenant isolation.
