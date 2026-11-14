# UniRise backend plan

Date: 2026-11-14. Branch `dev` at 649ee73. Sources: `unirise-api/` (code and migrations), `rdms-web/` (server, types, rules, reports), `infra/`, `rms-docs/`, and the decisions recorded on 2026-11-02 to 2026-11-06.

## 1. Where we stand

- `unirise-api` is built and deployed to AWS dev. `https://api.dev-unirise.mentoredge.co.in/actuator/health` returned `UP` on 2026-11-14.
- `rdms-web` is the product frontend (decided 2026-11-06). It still runs on its own Node/SQLite server. **No screen calls `unirise-api` yet.**
- The backend was built for the older model (researcher, scholar, supervisor, HoD, Dean, Executive). The UI uses the final model (Faculty, Top-Level Management, Office of Research). Most of the work below comes from that difference.
- The UI has kept moving since the last feature snapshot: it now has 7 record types and 54 reports. `RDMS_WEB_FEATURES.md` still says 6 and 46.

## 2. Agreed tech stack

| Layer | Choice | State |
|---|---|---|
| Language, framework | Java 21, Spring Boot 4.1.2 (webmvc, security, validation, actuator), Maven wrapper | Built |
| Architecture | One deployable service (modular monolith). Packages `tenancy` and `api` | Built |
| Database | PostgreSQL 16. One control-plane database plus one database per institution (ADR 11) | Built |
| Data access | Routing `DataSource` with `JdbcClient`, LRU connection pools per tenant. No JPA or Hibernate | Built |
| Migrations | Flyway, run in code: control plane at start, tenants by the migrator | Built (control V1-V4, tenant V1-V5) |
| Access rules | One `AccessService` checked on the server for every read and write | Built for the old roles, needs rework |
| Sign-in | Tenant API key, operator key, invitation token to bearer session. Target: OIDC, design deferred | Does not match the UI |
| Tests | JUnit with Testcontainers (real PostgreSQL 16). 36 tests on 2026-11-04 | Built |
| Packaging | Docker image, ARM64, non-root user | Built |
| CI | GitHub Actions: `mvnw verify` and image build. No deploy step | Built |
| Infrastructure as code | OpenTofu under `infra/`, state in an encrypted S3 bucket | Built for dev |
| Hosting | AWS `ap-south-1`: ECS Fargate, private RDS, ALB with ACM certificate, ECR, S3, SES, Secrets Manager | See section 6 |
| Frontend | `rdms-web`: React 18, Vite, TypeScript, React Router 6, Recharts | Built on a prototype server |

Decisions already made that the plan keeps: database per institution, no Hibernate multi-tenancy, three roles only, every institution has its own Office of Research, only the Office of Research approves, Top-Level Management is read-only and sees approved data only, no public sign-up, institutions are provisioned by the UniRise team.

## 3. What the backend has today

| Area | Endpoints | Used by the UI model? |
|---|---|---|
| Platform (operator key) | `POST/GET /api/platform/tenants`, status, export, delete, migrations, usage | Yes. Replaces `npm run provision` |
| Sign-in | `POST /api/auth/invitations`, `POST /api/auth/redeem`, `GET /api/me` | No. UI uses email and password |
| Org and access | `/api/org-units`, `/api/appointments`, `/api/role-grants`, `/api/relationships` | Partly. UI has a flat department list |
| People | `/api/researchers` (list, lookup, get, create) | Partly. UI calls them faculty, keyed by employee code |
| Publications | CRUD, submit, review | Yes, fields differ |
| Grants | CRUD, submit, review | Yes, fields differ |
| Seed money | CRUD, submit, review, window | Yes, window model differs |
| Progress | milestones, meeting logs, reminders, settings | No screen |
| Projects | restricted projects | No screen |
| Periods | create, close, frozen snapshot | No screen |
| Reports | 19 reports (publications and grants), CSV export | UI has 54, computed in the browser |
| Import | CSV onboarding (preview, commit) | No screen, useful for onboarding |

## 4. Gaps between the UI and the backend

Status: **Missing** = nothing in the API. **Partial** = exists but the contract differs.

### 4.1 Cross-cutting

| # | UI behaviour | Backend today | Work |
|---|---|---|---|
| G1 | Three roles: `office`, `management`, `faculty`. Only `office` reviews. Management sees approved data only | `RESEARCH_ADMIN`, `EXECUTIVE`, `DEAN`, `HOD`, `VIEWER`, scoped grants, mentor relationships. HoD/Dean/Executive review | Rework `AccessService` and review authority to the three roles. Partial |
| G2 | Email and password, HttpOnly SameSite=Strict cookie, `X-RDMS` CSRF header, 5 failures lock 15 minutes, idle timeout 8 hours (30 minutes for Office), change password, temporary passwords | API key and invitation bearer token | Missing. Needs the pilot sign-in decision (D1) |
| G3 | One call, `GET /api/data`, returns the whole institution slice for the role. Analytics, reports, networks, maps and Find Profiles are computed in the browser | Per-resource REST, numeric ids, snake-case fields | Contract decision (D2). The only client seam is `rdms-web/src/lib/store.ts` (110 lines) |
| G4 | Status flow Draft, Submitted, Under Review, Changes Requested, Resubmitted, Approved, Rejected. Opening a submission starts the review | `draft, submitted, approved, rework, revision_required, rejected`. Grants use `sanctioned` as the approved state. No "start review" | Partial. Add `under_review`, separate grant outcome from entry status |
| G5 | Display ids `PUB`, `GRT`, `SM`, `FDP`, `CNF`, `AWD` and IP from one counter per institution. Faculty id is the employee code | `BIGSERIAL` ids | Missing. Add a display code column and per-tenant counter |
| G6 | History per record: who, when, action, remark | `review_event` table | Partial. Expose it in the record response |
| G7 | Field whitelist: a client cannot approve its own entry, change owner or set sanctioned amounts | Same intent in controllers | Port `rdms-web/server/api.test.ts` cases as acceptance tests |

### 4.2 Records

| # | Record | Backend today | Work |
|---|---|---|---|
| G8 | Publications: indexing, quartile, impact factor, open access, ERF flag, PDF, author country, 5 types | Has title, DOI, venue, type, year, month, ISSN, category, project ref, authors with kind | Partial. Add columns, align type and author-kind values, duplicate-DOI message |
| G9 | Grants: outcome (Applied, Sanctioned, Not Sanctioned, Completed), sanction date, sanctioned and received amounts, matching grant, enclosures, investigator shares, exactly one PI | Has most proposal fields, investigators and share rule | Partial. Add outcome endpoint for the Office and the missing columns |
| G10 | Seed money: on/off window, ₹1 to ₹5,00,000, reviewer sets sanctioned amount | Dated `seed_window` | Partial. Decide switch or dated cycles (D6) |
| G11 | FDPs | None | Missing: table, rules, API |
| G12 | Conferences | None | Missing |
| G13 | Honours and Awards | None | Missing |
| G14 | Intellectual Property (patent, design, copyright, trademark) | None. `patent` exists only as a publication type | Missing. Added to the UI after the last gap analysis |
| G15 | Credit: owner plus internal co-authors and co-investigators; institution totals count an item once | Author and investigator links exist | Partial. Needed wherever counts are served |

### 4.3 People, profiles and administration

| # | UI behaviour | Backend today | Work |
|---|---|---|---|
| G16 | Biodata and researcher profile: qualifications, experience, memberships, expertise, keywords, SDGs, photo, Google Scholar metrics, highlights, teaching, supervision, engagement, media, links, availability flags | `researcher` has name, email, title, ORCID | Missing. One `biodata` table with JSONB sections is enough |
| G17 | Profile changes wait for Office approval (`POST /api/profile-changes`, start, review). One open request per person | None | Missing. Reuse the entry workflow |
| G18 | Approvals queue across all kinds plus profile updates: views awaiting, review, returned, approved, rejected; counts | Review per record only | Missing: `GET /api/office/approvals`, `/count`, `/start` |
| G19 | User management: list, create faculty or management account, activate, suspend, deactivate with reason, change role, reset password. Sessions end on suspend or role change | Invitations, role grants, create researcher | Partial |
| G20 | Office edits official faculty details and deactivates faculty | `POST /api/researchers` only | Partial. Add update and deactivate |
| G21 | Settings: institution name and tagline, departments (cannot remove one with faculty), academic-year start month, targets, score weights | `tenant_settings` (currency, locale, fiscal year), org tree | Partial. Departments map to `org_unit` rows of type department |
| G22 | Notices: post, delete, shown to faculty | None | Missing |
| G23 | Audit log of every Office action, per institution, readable by the Office | `access_log` for drill-downs, `platform_access_log` | Partial. Add an admin action log |
| G24 | Talk to Our Team enquiry: stored, emailed to corporate, rate-limited, honeypot | None | Missing. Control-plane table plus SES |
| G25 | File uploads: only file names are stored today (PDF, certificates, IP documents, photo as a data URL) | None. S3 uploads bucket exists | Missing. Presigned upload and download |
| G26 | Reports: 54 definitions in 6 groups, list and group modes, CSV and print | 19 SQL reports for publications and grants | See D2. If reports stay in the browser, no port is needed for the pilot |
| G27 | Analytics, scores, target attainment, profile completeness, Research Networks, collaboration and conference maps, Find Profiles with SDG filters | None | No server work if the data slice is served (D2). Server-side only when data size needs it |

### 4.4 Per-institution differences (added 2026-11-14)

Every institution will ask for something different. The answer is one codebase that each institution configures, plus a firm rule for deciding what gets built. Differences are configuration in the institution's own database, never a separate copy of the code.

**The five common kinds of request**

| # | What the institution wants | How to handle it | Example | State |
|---|---|---|---|---|
| G28 | A feature others do not need | **Feature switches** per institution: the code exists for everyone and a setting turns it on. The backend refuses calls to a disabled feature; the UI hides its menus | Seed money or Intellectual Property on for one university, hidden for another | Missing in both |
| G29 | Extra fields on a form | **Custom fields**: the Office of Research defines fields per record type (label, type, required, options). Values are stored in a `custom` JSONB column on each record table and validated on the server | "NAAC criterion" on publications, "Sanction letter number" on grants | Missing in both |
| G30 | Different options or labels | **Configurable lists** stored in settings, seeded from the current defaults in `rdms-web/src/lib/types.ts` | Their own grant types, designations, FDP programme types, department names | Missing. Lists are constants in the UI today; departments are already per institution |
| G31 | Different rules or scoring | **Settings with numbers and choices**, not code | Score weights and targets, seed-money limit, whether a PDF is required to submit | Partial. Weights, targets, academic-year start and the seed-money window are settings in the UI; limits and "PDF required" are fixed in `domain.ts` |
| G32 | Different reports or formats | **Report definitions as data**, plus CSV export for anything unusual | A NIRF or NAAC-format report enabled for those who need it | Partial. The UI's 54 reports are already declared as data in `reports.ts`, but the list is the same for every institution |

Custom fields and configurable lists cover most requests in practice, because they are usually "we also track X" or "we call it Y".

**Two cases that come up with larger customers**

| # | What they want | How to handle it | When |
|---|---|---|---|
| G33 | Their own sign-in or systems | Per-institution OIDC settings, and an API or webhooks so their HR or ERP system can exchange data with UniRise. They build the integration on their side; UniRise does not write code for their systems | With OIDC in phase 8. Tenant API keys already exist |
| G34 | A different approval chain, for example a department head reviewing before the Office of Research | A configurable number of review steps on the shared entry workflow | Not before a paying customer needs it. Until then, the single Office of Research approval stays. This is the expensive one |

**The rule for every request**

1. Can an existing setting do it? Configure it; no development.
2. Would at least two or three other institutions want it? Build it as a switchable feature for everyone.
3. Is it unique to one customer? Decline, or charge for it and still build it as a setting, never as a separate copy of the code.

**Isolation levels, if a customer asks for more than configuration**

| Level | What the customer gets | Cost |
|---|---|---|
| Shared backend, own database (today) | Data isolation, own backup, export and deletion | Lowest; one service to run |
| Shared backend, own database server | Their data on a dedicated RDS instance or in a specific region | One more RDS instance per such customer. ADR 11 already allows it |
| Fully dedicated deployment | Their own backend, database and URL | A full stack per customer and every release deployed once per customer. Offer only as a priced enterprise option |

**What the current design already gives:** each institution's database has a settings table, and the UI already reads departments, targets and weights from it. G28 to G30 go into the schema phase so they exist from the start.

### 4.5 Backend features with no screen

Milestones, meeting logs, reminders, restricted projects, mentor relationships, scoped role grants, period close with snapshots, CSV import. The roles they were built for no longer exist. They need a keep, park or remove decision (D3).

## 5. All features and their state

| Feature | UI | Backend |
|---|---|---|
| Multi-institution isolation (database per institution) | Built (SQLite) | Built |
| Institution provision, suspend, export, delete, usage | CLI | Built |
| Email and password sign-in, lockout, CSRF, idle timeouts | Built | Missing |
| OIDC sign-in | Not built | Not built (target) |
| Three-role access model | Built | Needs rework |
| Publications | Built | Partial |
| Grants and outcomes | Built | Partial |
| Seed money | Built | Partial |
| FDPs | Built | Missing |
| Conferences | Built | Missing |
| Honours and Awards | Built | Missing |
| Intellectual Property | Built | Missing |
| Review workflow with Under Review and Resubmitted | Built | Partial |
| Approvals queue and counts | Built | Missing |
| Biodata, CV, researcher profile | Built | Missing |
| Profile update approval | Built | Missing |
| Faculty directory, Find Profiles, SDG filters | Built | Partial (researcher list) |
| Research Networks, collaboration map, conference map | Built | Data only |
| Dashboards, analytics, scores, targets | Built | Missing (data only if D2 is "browser") |
| Reports (54) with CSV and print | Built | 19 of a different catalogue |
| Annual report | Built | Missing |
| User management | Built | Partial |
| Institution, departments, targets, weights settings | Built | Partial |
| Notices | Built | Missing |
| Office audit log | Built | Partial |
| Enquiry form with email | Built (SMTP) | Missing |
| File uploads | Names only | Missing |
| Email to users (invites, reset) | Not built | Not built |
| Landing page, dark mode, branding, print | Built | Not applicable |
| Feature switches per institution | Not built | Missing |
| Custom fields per record type | Not built | Missing |
| Configurable option lists | Constants in code | Missing |
| Milestones, meeting logs, projects, periods, CSV import | No screen | Built |
| Backups and restore drill | Not built | Built (manual job) |

## 6. AWS integration

Account `417441726165`, `ap-south-1`, shared with MentorEDGE. Only UniRise resources are in scope. Details: `infra/DEV_DEPLOY_RUNBOOK.md`, `infra/DEV_ENV_IMPLEMENTATION_PLAN.md`.

### Done (dev)

- VPC with two public and two private subnets, S3 gateway endpoint. No NAT, bastion or paid interface endpoints.
- RDS PostgreSQL 16, `db.t4g.micro`, private, encrypted, 7-day backups.
- ECS Fargate cluster `unirise-dev`, service `unirise-dev-api`: one ARM64 task, 0.25 vCPU, 512 MiB, image pinned by digest.
- HTTPS load balancer with an ACM certificate; `api.dev-unirise.mentoredge.co.in` by CNAME in Hostinger DNS.
- ECR repository, 14-day log group.
- S3 `uploads` and `exports` buckets, private, encrypted, lifecycle rules.
- SES domain identity verified with DKIM, configuration set.
- Secrets Manager: `unirise/dev/app-db`, `unirise/dev/admin-key`, RDS master secret.
- Operator-only Fargate admin tasks for database bootstrap and backup/restore. Restore drill passed on 2026-11-04.
- CORS for `https://dev-unirise.mentoredge.co.in`.
- Cost estimate: $50 to $70 a month before tax and usage.

### Provisioned but not used by the application

- S3 `uploads` bucket: the API has no upload code.
- SES: the API sends no email. The account is still in the SES sandbox.
- `exports` bucket: used only by the manual backup job.

### Not started

| # | Item | Why it matters |
|---|---|---|
| A1 | AWS SDK in the API: S3 presigned uploads, SES send | Blocks G24, G25 and any email to users |
| A2 | Tenant database passwords from the control-plane table to Secrets Manager | Required before real data (marked `shortcut:` in `V1__control_plane.sql`) |
| A3 | SES production access request | Without it, mail goes only to verified addresses |
| A4 | Deploy pipeline: CI builds and tests only; deploys are `scripts/push-image.sh` plus `tofu apply` by hand | Repeatable releases |
| A5 | Scheduled tenant backups (EventBridge Scheduler running the existing admin task) | Backups are manual today |
| A6 | Frontend hosting for `dev-unirise.mentoredge.co.in`: Hostinger, not AWS (D4). Build `rdms-web` with the API base URL and upload `dist/` | The UI is not deployed anywhere |
| A7 | Human IAM users with MFA instead of root; budget alerts | Deferred by request; needed before production |
| A8 | Alarms (task health, 5xx, RDS storage and CPU), rate limiting at the edge | No monitoring today |
| A9 | Upload scanning for PDFs and certificates | Needed once uploads exist |
| A10 | Production environment: region and account choice, Multi-AZ, deletion protection | Not designed |
| A11 | ~~Commit the infra and API changes from 2026-11-04~~ **Done 2026-11-14** | The running image was built from source that was uncommitted until then |

## 7. Plan

Each phase ends with tests passing and the docs updated. Order matters: phases 2 to 5 depend on phase 1.

**Phase 0. Housekeeping.** Pending infra and API changes committed on 2026-11-14 (A11). Still to do: refresh `RDMS_WEB_FEATURES.md` (7 record types, 54 reports, closed registration, review states).

**Phase 1. Decisions.** D1 to D4 were decided on 2026-11-14 (section 8). D5 to D8 follow the recommendations unless changed.

**Phase 2. Roles and sign-in (G1, G2, G19, G23).** Three roles in `AccessService`. Accounts with password hashes, cookie session, CSRF header, lockout and idle timeouts kept in the database so they survive a restart. User management endpoints. Admin action log. Provisioning creates the first Office account.

**Phase 3. Schema (G4, G5, G8 to G14, G16, G21, G22).** Tenant migrations V6 onward: `fdp`, `conference`, `honour`, `intellectual_property`, `biodata`, `profile_change`, `notice`; publication and grant columns; `under_review` status; display codes; targets and weights in settings; enabled features, custom field definitions and configurable lists in settings, plus a `custom` JSONB column on every record table (G28 to G30). Rule limits such as the seed-money ceiling and "PDF required" become settings (G31). Update `TENANT_DB_SCHEMA.md`.

**Phase 4. Entry and approval APIs (G6, G7, G9 to G15, G17, G18).** New kinds on the existing `EntryWorkflow`. Rules ported from `rdms-web/src/lib/domain.ts`. Office approvals queue, counts, start review, grant outcome. Profile change workflow.

**Phase 5. Profiles, settings, notices (G16, G20 to G22).** Biodata read and write, official faculty details, departments, targets, weights, notices.

**Phase 6. Frontend switch (G3).** Replace `store.ts` calls slice by slice: sign-in, then publications, then the remaining kinds, approvals, profiles, administration. Port `server/api.test.ts` as acceptance tests against the API. Remove the SQLite server last.

**Phase 7. AWS (A1 to A9).** S3 uploads, SES mail and enquiries (G24, G25), Secrets Manager for tenant credentials, deploy pipeline, scheduled backups, alarms, IAM users and budget. The frontend goes to Hostinger (A6), which also means the UI calls the API cross-origin: the session cookie needs `Domain`-less `SameSite=Strict` on the API host and CORS with credentials for the one allowed origin.

**Phase 8. Later.** OIDC with per-institution settings and integration webhooks (G33), per-institution report selection (G32), configurable review steps only when a customer needs them (G34), server-side reports and PDF if the browser approach is outgrown, production environment (A10), harvesting, webhooks.

## 8. Open decisions

| # | Decision | Recommendation |
|---|---|---|
| D1 | Sign-in for the pilot: password as in the UI, or wait for OIDC | **Decided 2026-11-14:** password for the pilot with the UI's existing protections; OIDC in phase 8. OIDC design is still deferred |
| D2 | Data contract: keep the UI's "one scoped slice, compute in the browser" model, or move reports and analytics to the server | **Decided 2026-11-14:** keep it for the pilot. The server scopes the data, the UI computes the 54 reports and all analytics. Revisit when an institution's data gets large |
| D3 | Old-model modules with no screen (milestones, meeting logs, projects, relationships, periods, scoped grants) | **Decided 2026-11-14:** park. Keep the tables, stop exposing the endpoints |
| D4 | Where the frontend is hosted | **Decided 2026-11-14:** Hostinger, on `dev-unirise.mentoredge.co.in`. Same site as the API, so SameSite cookies work. Deploys are manual uploads of `rdms-web/dist`; no AWS frontend resources |
| D5 | Can the Office grant individual features or data scopes, or are permissions fixed per role | Fixed per role until a customer asks |
| D6 | Seed-money window: one switch (UI) or dated cycles (backend) | Keep dated cycles in the database, show "open now" to the UI |
| D7 | Are reads by the Office audited, or only changes | Changes only for the pilot |
| D8 | Score weights and targets: per institution (as built) or platform defaults with overrides | Per institution, seeded from defaults |

## 9. Not checked for this document

- AWS resources were not listed live. Section 6 comes from the Terraform files and the 2026-11-04 deployment notes; only the public health endpoint was called today.
- The backend tests were not re-run.
- Grant and seed-money columns were compared at table level, not field by field. That comparison belongs to phase 3.
