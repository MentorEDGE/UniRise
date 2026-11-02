# RMS – Frontend Specification

Status: Draft v0.3 · Companion to PRD.md, TRD.md and ACCESS_AND_VISIBILITY_MODEL.md · Last updated: 2026-11-02
Scope: web UI for Phases 2–3. Only the API in TRD §5 exists today; endpoints marked *(planned)* must be built first.

## 1. Principles
1. **Confirm, don't type.** Researchers mostly review suggested publications; manual entry is the fallback.
2. **Trust is visible.** Every publication shows its source and verification state.
3. **Reports first for admins.** The research office's main job is getting a correct report out; make that two clicks from the home page.
4. **Tenant is invisible.** The UI never shows or accepts a tenant id; scoping is entirely server-side.

## 2. Tech choices
- SPA: React 18 + TypeScript + Vite, served as static files behind the same domain as the API (avoids CORS; allows cookie sessions).
- Routing: React Router. Server state: TanStack Query (caching, pagination, retries). Forms: React Hook Form + Zod, mirroring server validation (ORCID `\d{4}-\d{4}-\d{4}-\d{3}[\dX]`, DOI `10.\d{4,9}/\S+`).
- UI kit: one accessible component library (e.g. Radix/shadcn) with design tokens; charts via a single library (Recharts).
- API client generated from the OpenAPI document (TRD §5) so types cannot drift.
- Tests: Vitest + Testing Library for components; Playwright for the critical flows in §8; axe-core in CI for accessibility.
- Alternative if the team prefers one deployable: server-rendered Thymeleaf pages. The screens and flows below still apply.

## 3. Roles and navigation
| Role | Sees |
|---|---|
| Research Admin | Everything in the tenant |
| Executive (VC, Pro-VC, Registrar) | University-wide dashboards and rollups across institutions; named drill-down is logged and excludes confidential data |
| Dean | Rollups and comparison for the school's departments; people and publications in scope (edits limited) |
| HoD | Department rollup, per-faculty outputs, scholars by stage, who is overdue |
| Supervisor | Own record plus each mentee's progress, milestones and meeting logs |
| Researcher / Scholar | Own profile, claims, publications and awards; scholars also see their own milestones and feedback |
| Viewer | Read-only dashboard and reports |
| IT Admin | Users, roles, SSO and audit log; no research content |
| Guest | One narrow, time-limited item or report |

Navigation (left rail, collapses to a bottom bar on mobile): Home · Publications · People · Awards · Reports · Review queue (admin/researcher) · My progress (scholar) · My mentees (supervisor) · Organisation (admin) · Settings (admin).
Items a role cannot use are hidden, and routes are guarded; the server remains the authority.

## 4. Screens

### 4.1 Sign in
SSO button per tenant (OIDC in Phase 2, SAML in Phase 3); no local password form. Sandbox and demo tenants may use an invitation email link. Error states: unknown tenant, user not provisioned, SSO failure with a retry link.

### 4.2 Home dashboard
- Tiles from `GET /api/reports/summary` (departments, researchers, publications, awards).
- Chart: publications by year (`publications-by-year`).
- List: top researchers (`top-researchers`).
- Table: departments with publications, awards, funding total (`reports/departments`).
- Admin-only card: "N suggestions awaiting review" linking to the Review queue *(planned)*.
- Empty state for a new tenant: guided checklist (add departments → import staff → connect ORCID → import first publications).

### 4.3 Publications
- List: title, year, venue, type, DOI link, authors, verification badge (Verified / Suggested / Unverified), source. Search, filter (year range, department, type, state), sort, pagination (page size ≤ 200).
- Detail/edit: all fields; author picker (typeahead over researchers, sends `authorIds`); DOI field with "Fetch details" calling `POST /api/publications/import`. A 409 shows "Already in your records" with a link to the existing item; a 502 shows "Couldn't reach Crossref, try again".
- Add: choose "Import by DOI" (default) or "Enter manually".
- Delete: confirm dialog stating the item will be removed from reports.

### 4.4 People
- Researcher list: name, department, title, ORCID (linked), publication count. Filters by department.
- Profile page: details, ORCID connection status, publications tab, awards tab, claims tab, supervision tab (mentees, supervisors, backup supervisor).
- Create/edit form with ORCID format validation and department select. Bulk CSV import with a preview and per-row errors before commit *(planned)*.
- Organisation: tree of institution → school → department → group with inline create/rename/move; delete is blocked with a message (409) when people or child units still reference it.

### 4.5 Awards
List and form: title, funder, amount, start/end year, principal investigator (researcher picker). Validation: end ≥ start; amount ≥ 0 with currency shown from tenant settings *(planned)*.

### 4.6 Review queue *(planned, Phase 2)*
Card list of suggested authorship matches: publication metadata, the researcher it would attach to, match reason and score, source link. Actions: Confirm, Not mine, Skip; keyboard shortcuts (Y / N / S); undo toast. Admin view adds filters by department and an "override" action. Researchers see only their own queue.

### 4.6a Duplicates *(planned)*
Side-by-side comparison of two probable duplicate publications, choose the survivor, merge preview, confirm.

### 4.7 Reports
- Report list: built-in reports (summary, by year, top researchers, departments; later annual faculty report, accreditation/ranking templates).
- Report view: filters (date range, department), table + chart, "Export CSV" and "Export PDF" *(planned; async job with a progress state and download link)*.
- Saved report definitions *(planned)*.
- Every report page states what it counts (e.g. "verified publications only") and when data was last refreshed.

### 4.8 Settings (admin) *(planned)*
Users and roles, SSO setup and status, tenant settings (logo, accent colour, currency, fiscal year, classification lists), CSV import of people and org structure with preview, ORCID/OpenAlex harvest status and last run, API keys (create, rotate, revoke; key shown once with a copy button), audit log viewer.

### 4.9 Platform admin (internal)
Separate internal console, never exposed to tenant users: create a sandbox or pilot tenant (shows the API key once), change its status, suspend, export and delete a tenant (each with confirmation), see active researcher counts, and open logged support access.

### 4.10 Scholar progress *(planned, Phase 2)*
Timeline of stages (registration, coursework, proposal, progress reviews, thesis submission, viva) with due dates, status, approvals and feedback addressed to the scholar. A "next due" card on Home. A scholar sees only their own data.

### 4.11 Supervisor view *(planned, Phase 2)*
Mentee table: stage, next milestone, overdue flag, last meeting date. Mentee detail: milestones, publications, meeting log (per the record's sensitivity). Own supervision load and graduated scholars. Backup supervisor assignment, and a reassignment prompt when a supervisor's appointment ends.

### 4.12 Unit and executive dashboards *(planned)*
Scope picker over the org tree the viewer is allowed to see; period selector. Tiles, trends, comparison across child units, scholars by stage, overdue counts. Closed periods show their snapshot date; open ones show "as of". Drilling down to a named person shows a notice that the access is logged. Confidential data never appears. A person sees their own rank only; everyone else sees aggregates.

### 4.13 Roles and access (admin) *(planned)*
Role grants with scope and validity dates, delegation (acting HoD), a periodic access-review list, and a view of the break-glass and drill-down log.

## 5. Cross-cutting UI behaviour
- **Loading:** skeletons for lists/charts; buttons disable while submitting.
- **Errors:** 401 → redirect to sign in preserving the target route; 403 → "You don't have access" page; 404 → not-found page; 400 → field-level messages (server `message` is intentionally empty, so the client maps its own field validation and shows a generic message for unexpected 400s); 5xx/network → retry banner. No stack traces or raw server text.
- **Empty states:** every list explains what belongs there and offers the primary action.
- **Concurrency:** PUT replaces the whole record; the form warns if the record changed since it was opened *(requires a version field, planned)*.
- **Pagination:** server-side; preserve filters and page in the URL so views are shareable.
- **Dates/numbers:** locale-aware; funding shown with the tenant currency.
- **Sensitive data:** the API key is displayed once, never persisted in storage or logs; no personal data in URLs or analytics events.
- **Reminders:** milestone reminders go to the scholar and the supervisor and escalate after a set number of days; shown in-app and by email, with the reason stated.
- **As of:** every dashboard and report shows when its data was last refreshed and, for closed periods, the snapshot date.

## 6. Accessibility and responsiveness
- WCAG 2.1 AA: keyboard operable everywhere, visible focus, labelled form controls, error text linked via `aria-describedby`, colour never the only signal (badges have text/icons), charts have a table alternative.
- Contrast ≥ 4.5:1 for text; respects reduced-motion.
- Breakpoints: mobile ≥ 360 px (single column, bottom nav), tablet, desktop ≥ 1024 px. Tables become card lists on mobile.
- i18n-ready: all strings externalised, English first; right-to-left support deferred.

## 7. Security (frontend)
- Auth via HttpOnly, Secure, SameSite cookies (no tokens in localStorage); CSRF token on state-changing requests.
- Strict CSP, no inline scripts; sanitise any rendered external text (titles from Crossref are untrusted and rendered as plain text, never HTML).
- Links to DOI/ORCID use `rel="noopener noreferrer"`; only `https://doi.org/` and `https://orcid.org/` hosts are generated from stored values.
- Role-based hiding is a convenience only; never rely on it for protection.

## 8. Critical flows to test end to end
1. Admin creates departments, adds a researcher, imports a publication by DOI, links authors, sees it in the department report.
2. Researcher signs in, reviews three suggestions (confirm, reject, skip) and sees the counts change.
3. Cross-tenant check: a user from tenant B cannot open a tenant A record by URL (404).
4. Duplicate DOI import shows the 409 message with a link.
5. Dean sees only their department's data.
6. Report export completes and the file matches on-screen figures.
7. A scholar's milestone becomes overdue: the scholar and supervisor get the reminder and the supervisor view flags it.
8. A HoD or Dean cannot open another department's data or any confidential meeting log; an Executive's drill-down to a named person is recorded in the audit log.
9. A supervisor's appointment ends: the backup supervisor sees the scholars and an admin can reassign them.
10. A paper by an author with two appointments counts for both departments but once in the university total.

## 9. Delivery plan
| Step | Deliverable | Depends on |
|---|---|---|
| F1 | App shell, sign-in, routing, API client, error/empty patterns | Per-user auth (TRD §3) |
| F2 | Dashboard, Publications, People, Awards (all use existing endpoints) | MVP API |
| F3 | Reports page with filters and charts | MVP API |
| F3b | Org tree, role grants, scholar timeline, supervisor view, unit dashboards | Org tree, role grant, supervision and milestone APIs (TRD §4–§5) |
| F4 | Review queue and duplicates | Claims and harvest (TRD §6) |
| F5 | CSV/PDF export, Settings, audit log | Export jobs, audit log |
| F6 | Public profile site (optional, indexable, server-rendered) | Public API |

## 10. Open questions
- SPA versus server-rendered pages for the first release? (SPA chosen in RMS_FRONTEND_ARCHITECTURE.md; confirm.)
- Branding per tenant: logo and one accent colour (RMS_FRONTEND_ARCHITECTURE.md, decision F6); confirm.
- Can executives see named individuals? Default: yes, through a logged drill-down that excludes confidential data (ACCESS_AND_VISIBILITY_MODEL.md, decision 4).
- Languages required by the pilot customer?
- Should researchers be able to edit their own publications' metadata, or only claim/reject?
