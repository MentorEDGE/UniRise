# UniRise backend plan

Date: 2026-11-14, brought up to date 2026-11-18. Branch `dev`. Sources: `unirise-api/` (code and migrations), `rdms-web/` (server, types, rules, reports), `infra/`, `rms-docs/`, and the decisions recorded on 2026-11-02 to 2026-11-06.

## 1. Where we stand

- **Running on AWS dev (2026-11-18):** the API at `https://api.dev-unirise.mentoredge.co.in` is deployed from GitHub on every push to `dev` that changes `unirise-api/` (A4; first deploy `5f7be0e`, task definition revision 9). Sample institutions `abc` (ABC Institute of Technology) and `xyz` (XYZ University, three schools) are loaded as sandboxes with `rdms-web/scripts/load-demo.sh`; every demo account uses the one demo password `Unirise123` (decided 2026-11-17). Sign-in, scoping per role and the refusal of former faculty were checked against the live API. The old `demo` sandbox (Demo University) was deleted on 2026-11-17.
- **Dev database restored 2026-11-16.** It was in `inaccessible-encryption-credentials` from 2026-11-04 (KMS access lost at 17:08 UTC, stopped at 19:03 UTC, terminal on 2026-11-11; the key `alias/aws/rds` is enabled and CloudTrail shows no change that explains it, so the cause is unknown). Restored from the 2026-11-11 final snapshot into a new instance, checked, the broken instance deleted, the new one renamed to `unirise-dev` (same endpoint) and the managed master password turned on; OpenTofu then updated the admin task and two IAM policies for the new secret and resource id, and the plan is clean. The two snapshots from before the restore (`unirise-dev-keep-2026-11-04`, `unirise-dev-keep-2026-11-11`) were deleted on 2026-11-18; kept: `unirise-dev-before-phase2-6` and `unirise-dev-before-a2-secrets`, plus the nightly backups (A5). `backend.hcl` and `terraform.tfvars` were rebuilt from the state on 2026-11-16 (git-ignored, not in the repo).
- `rdms-web` is the product frontend (decided 2026-11-06). Served from `dev-unirise.mentoredge.co.in` it calls the AWS API (`store.ts`, `KNOWN_APIS`); for local work, `npm run dev` passes `/api` to a local Java API. On the AWS site the sign-in page's sample accounts only fill in the email. The SQLite prototype server was removed on 2026-11-17.
- The backend was first built for the older model (researcher, scholar, supervisor, HoD, Dean, Executive). Phases 2 to 6 moved it to the final model (Faculty, Top-Level Management, Office of Research); the old-model tables stay, and their endpoints are parked (D3).
- **Former faculty: decided 2026-11-17 by the product owner.** They are kept in the database only: their work is used in no performance figure, analysis or report, for any role and any year. A record shared with a current faculty member still counts for that person (`forAnalysis` in `rdms-web/src/lib/analytics.ts`; reports credit current faculty only). Management's data slice already leaves them out; the Office keeps them in its lists.
- The UI has 7 record types and 60 reports; `RDMS_WEB_FEATURES.md` was rewritten from the code on 2026-11-17.

## 2. Agreed tech stack

| Layer | Choice | State |
|---|---|---|
| Language, framework | Java 21, Spring Boot 4.1.2 (webmvc, security, validation, actuator), Maven wrapper | Built |
| Architecture | One deployable service (modular monolith). Packages `tenancy` and `api` | Built |
| Database | PostgreSQL 16. One control-plane database plus one database per institution (ADR 11) | Built |
| Data access | Routing `DataSource` with `JdbcClient`, LRU connection pools per tenant. No JPA or Hibernate | Built |
| Migrations | Flyway, run in code: control plane at start, tenants by the migrator | Built (control V1-V10, tenant V1-V9) |
| Access rules | One `AccessService` checked on the server for every read and write | Built for the three roles (phase 2, 2026-11-14) |
| Sign-in | Email and password with a cookie session (phase 2), tenant API key for integrations, operator key. Target: OIDC in phase 8 | Built (phase 2, 2026-11-14) |
| Tests | JUnit with Testcontainers (real PostgreSQL 16). 75 tests on 2026-11-21 (5 skipped, parked by D3) | Built |
| Packaging | Docker image, ARM64, non-root user | Built |
| CI | GitHub Actions: `mvnw verify` and image build (`api.yml`); deploy to AWS dev on push to `dev` (`deploy-dev.yml`, A4) | Built |
| Infrastructure as code | OpenTofu under `infra/`, state in an encrypted S3 bucket | Built for dev |
| Hosting | AWS `ap-south-1`: ECS Fargate, private RDS, ALB with ACM certificate, ECR, S3, SES, Secrets Manager | See section 6 |
| Frontend | `rdms-web`: React 18, Vite, TypeScript, React Router 6, Recharts | Built; calls the Java API |

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
| Reports | 19 reports (publications and grants), CSV export | UI has 60, computed in the browser |
| Import | CSV onboarding (preview, commit) | No screen, useful for onboarding |

## 4. Gaps between the UI and the backend

Status: **Missing** = nothing in the API. **Partial** = exists but the contract differs.

**Status on 2026-11-17** (the tables below keep the original gap descriptions; this is where each one stands):

| State | Gaps |
|---|---|
| Done in phases 2 to 6 (Java API, deployed to AWS dev) | G1 to G23, G31 (seed money limit, PDF rule), G35 to G40 |
| Done in the browser by design (D2: the API sends the scoped slice) | G26 reports, G27 analytics, G40 management dashboard |
| Done after phase 6 | G41 schools (2026-11-17) |
| Done 2026-11-17 | G28 record types on/off (Institution → Record types; hidden in menus and forms, refused by the API). G29 custom fields (Institution → Custom Fields; up to 10 per record type; on entry forms, in record details and the review window; checked by the API: type, options, required to submit) |
| Done 2026-11-17 (G30) | Option lists (Institution → Option Lists): designations, publication categories, grant types, grant sources and FDP programme types can be reworded (up to 50 each; empty = default); lists used by scoring, reports or record rules stay fixed. Entries keep their value if it leaves the list |
| Partly done | G24 enquiries: stored and emailed (A1a, deploy pending) |
| Not started | G25 file uploads (**A1b**) |
| Later (phase 8) | G32 per-institution reports, G33 OIDC and integrations, G34 configurable review steps |

### 4.1 Cross-cutting

| # | UI behaviour | Backend today | Work |
|---|---|---|---|
| G1 | Three roles: `office`, `management`, `faculty`. Only `office` reviews. Management sees approved data only | **Done 2026-11-14 (phase 2).** Roles on `app_user`; only the Office reviews; management reads approved entries only | Done |
| G2 | Email and password, HttpOnly SameSite=Strict cookie, `X-RDMS` CSRF header, 5 failures lock 15 minutes, idle timeout 8 hours (30 minutes for Office), change password, temporary passwords | **Done 2026-11-14 (phase 2).** Same endpoints and responses as the prototype; lockout and sessions in the control-plane database | Done |
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
| G19 | User management: list, create faculty or management account, activate, suspend, deactivate with reason, change role, reset password. Sessions end on suspend or role change | **Done 2026-11-14 (phase 2).** `/api/office/users`; provisioning creates the first Office account | Done |
| G20 | Office edits official faculty details and deactivates faculty | `POST /api/researchers` only | Partial. Add update and deactivate |
| G21 | Settings: institution name and tagline, departments (cannot remove one with faculty), academic-year start month, targets, score weights | `tenant_settings` (currency, locale, fiscal year), org tree | Partial. Departments map to `org_unit` rows of type department |
| G22 | Notices: post, delete, shown to faculty | None | Missing |
| G23 | Audit log of every Office action, per institution, readable by the Office | **Done 2026-11-14 (phase 2) for accounts and sign-ins.** `admin_log` in each institution's database, `GET /api/office/audit`. Entry decisions are added in phase 4 | Partial |
| G24 | Talk to Our Team enquiry: stored, emailed to corporate, rate-limited, honeypot | None | Missing. Control-plane table plus SES |
| G25 | File uploads: only file names are stored today (PDF, certificates, IP documents, photo as a data URL) | None. S3 uploads bucket exists | Missing. Presigned upload and download |
| G26 | Reports: 60 definitions (54 on 2026-11-14) in 6 groups, list and group modes, CSV and print | 19 SQL reports for publications and grants | See D2. If reports stay in the browser, no port is needed for the pilot |
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
| G32 | Different reports or formats | **Report definitions as data**, plus CSV export for anything unusual | A NIRF or NAAC-format report enabled for those who need it | Partial. The UI's 60 reports are already declared as data in `reports.ts`, but the list is the same for every institution |

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

### 4.5 Added to the UI after this plan was written (2026-11-11 to 2026-11-14)

| # | UI behaviour | Backend work | Phase |
|---|---|---|---|
| G35 | Former faculty: the Office records why someone left (Retired, Resigned, Transferred, Other) and the last working day. Their profile and records stay with the Office; management gets current faculty only, and only records that credit at least one of them. Every current figure counts active faculty only | `exit_reason`, `exit_date` on the faculty profile; the management scope rule above | 3 and 5 |
| G36 | Follow me links on the profile: LinkedIn, X, ResearchGate, GitHub, YouTube, SSRN, website, each checked against its own site | Part of the biodata (G16), validated on the server | 5 |
| G37 | Ph.D. guided and ongoing are counted from the supervision list when scholars are listed | Server-side rule on profile updates (G17) | 4 and 5 |
| G38 | Open pages refresh their data by themselves (on navigation, at most every 5 seconds, and every minute) | `GET /api/data` should answer `304 Not Modified` to an unchanged `ETag`, or the full slice is re-sent each time | 6 |
| G39 | Review details: start review on opening, views and counts per stage, faculty reply on resubmission, review comments removed from management's data | Part of G4, G6 and G18 | 4 |
| G40 | Top-Level Management dashboard | None: computed in the browser from the data slice (D2) | — |
| G41 | Schools of a university (added 2026-11-17): each school holds some departments; every department filter can also name a whole school; Department Comparison by school; "School wise" summary reports; a School column in the annual report | `settings.schools` (jsonb), validated in `PUT /api/settings` (`InstitutionController.schools`, same rules as `domain.ts cleanSchools`) | Done (no table: settings only). Institutes and colleges have no schools and see no change |

### 4.6 Backend features with no screen

Milestones, meeting logs, reminders, restricted projects, mentor relationships, scoped role grants, period close with snapshots, CSV import. The roles they were built for no longer exist. They need a keep, park or remove decision (D3).

## 5. All features and their state

Updated 2026-11-18. "Browser" means computed in the website from the scoped data slice the API sends (decision D2).

| Feature | Website | Java API (AWS dev) |
|---|---|---|
| Multi-institution isolation (database per institution) | Built | Built |
| Institution provision, suspend, export, delete, usage | Operator API only | Built |
| Email and password sign-in, lockout, CSRF, idle timeouts | Built | Built (phase 2) |
| OIDC sign-in | Not built | Not built (phase 8) |
| Three-role access model, former faculty | Built | Built |
| The seven record types (publications, grants, seed money, FDPs, conferences, honours, IP) | Built | Built (phases 3-4) |
| Review workflow (Under Review, Changes Requested, Resubmitted), approvals queue, profile approval | Built | Built (phase 4) |
| Biodata, CV, researcher profile, Follow me links | Built | Built (phase 5; CV printed by the browser) |
| Find Profiles, Research Networks, maps | Built | Browser |
| Dashboards (management, Office), analytics, scores, targets | Built | Browser |
| Reports (60, incl. School wise) with CSV and print; annual report | Built | Browser |
| Schools of a university (G41) | Built | Built (settings) |
| User management, audit log | Built | Built |
| Institution, departments, targets, weights, notices | Built | Built |
| Record types on/off (G28), custom fields (G29), option lists (G30) | Built | Built |
| Enquiry form, emailed to the team (G24) | Built | Built (A1a; SES production access since 2026-11-18) |
| File uploads with virus scanning (G25) | Built | Built (A1b, A9). Since 2026-11-21: documents (PDF, Word, Excel, PowerPoint, OpenDocument, text, CSV, RTF), images and ZIP, by extension; programs and web pages refused; non-viewable files download. Files no entry uses are removed: when taken off an entry or with a deleted draft (`UploadCleanup.forget`), and abandoned uploads older than a day every 6 hours (`UploadCleanup.sweep`) |
| In-app notifications with mark as read | Built (2026-11-21, bell in the menu bar) | Built: tenant V8 `notification`, `Notifier`, `GET /api/notifications`, `POST /api/notifications/read`. Faculty: decisions on entries and profile updates, funding outcomes, notices. Office: new submissions and resubmissions |
| Email to faculty on a decision (approved, changes requested, rejected) | Not applicable | Built (2026-11-21): `DecisionMail`, for all seven entry types and profile updates; never to accounts loaded from the sample data |
| Security hardening, free (2026-11-24) | Built | (1) Website security headers via Hostinger `.htaccess`: strict Content-Security-Policy (own scripts and styles only; API, S3 uploads, Unsplash photo allowed), HSTS, X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy, COOP. (2) Passwords: at least 10 characters, letters and a number, no common words or site name, not built from the email, different from the current one, and not in known breaches (`BreachedPasswords`, Have I Been Pwned range API with k-anonymity; skipped if unreachable). (3) A "confirm your password" step for sensitive Office actions was built on 2026-11-24 and removed the same day at the user's request (control V10 `user_token.confirmed_at` remains, unused). (4) Audit log append-only (tenant V9 and control V10 triggers block UPDATE/DELETE/TRUNCATE on `admin_log` and `platform_access_log`); file opens and CSV exports are logged; the audit page shows who. (5) RDS deletion protection on. |
| Emails come from each institution's own Office of Research address; UniRise sends none of its own | Built (2026-11-23): Settings → Institution → Email sender | Built: control V9 `institution_mail`, `InstitutionSender`, `/api/office/mail-sender` (GET/PUT/check/DELETE). The Office enters its address; the domain is registered with SES (Easy DKIM) and the 3 CNAME records are shown for the institution's IT; until verified nothing is emailed (temporary passwords are shown to the Office instead). Welcome, password-link, decision and submission emails all use it, signed by the Office, Reply-To the address. A domain used by another institution, or UniRise's own, is refused. "Forgot password" sends no email: it tells the person to ask their Office. Infra: API task role may send from and manage `identity/*`, with an explicit deny on UniRise's and MentorEdge's own identities |
| Welcome email with a temporary password; new password required at first sign-in | Built (2026-11-21) | Built: the account-creation invitation carries the email, a temporary password and a set-password link; control V8 `must_change_password` (set for every temporary password); the website opens Account → Change Password first |
| Email to users (invitations, password reset) | Built (2026-11-18) | Built (2026-11-18): `PasswordLinks`, `PasswordController` (`/api/password/forgot`, `check`, `set`), `POST /api/office/users/{id}/invite`; control V7 `password_link` (hashed, one use, invite 7 days, reset 1 hour) |
| Landing page, dark mode, branding, print | Built | Not applicable |
| Milestones, meeting logs, projects, periods, CSV import (old model) | No screen | Built, parked (D3) |
| Backups | Not applicable | Nightly (A5), restore drill tested |

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

### In use since 2026-11-17

- S3 `uploads` bucket: record files (A1b), scanned by GuardDuty Malware Protection (A9).
- SES: enquiries to the team (A1a). Production access granted 2026-11-18 (A3), so mail can go to any address.
- `exports` bucket: nightly backups (A5).
- Secrets Manager: one secret per institution database (A2).

### Work items

| # | Item | Why it matters |
|---|---|---|
| A1 | AWS SDK in the API: S3 presigned uploads, SES send | **A1b uploads built 2026-11-17** (`UploadController`: presigned PUT for faculty and the Office, PDF/JPEG/PNG up to 10 MB, keys `<institution>/<user>/<uuid>/<name>`; downloads only for files on records in the caller's own data, 5-minute links; bucket CORS for the website only). The UI keeps names only where the API has no bucket. **A1a email built 2026-11-17** (`EnquiryMail`: each stored enquiry is emailed to the team address, Reply-To the enquirer, from no-reply@ the dev domain; failures recorded and retried every 30 minutes for 7 days) |
| A2 | ~~Tenant database passwords from the control-plane table to Secrets Manager~~ **Done 2026-11-17** | `SecretStore` (`app.secrets.store=aws` on AWS): one secret per institution, `unirise/dev/tenant/<slug>`, labelled Project=UniRise; the API task may use only that prefix. The three existing passwords were moved at start-up (written, read back, then removed from `institution_secret`). The table stays for local runs and tests only |
| A3 | SES production access request | **Done 2026-11-18**: granted for ap-south-1 (50,000 emails a day); mail can go to any address |
| A4 | Deploy pipeline: CI builds and tests only; deploys are `scripts/push-image.sh` plus `tofu apply` by hand | **Done 2026-11-18**: `.github/workflows/deploy-dev.yml` runs on every push to dev that changes `unirise-api/` (or by hand): (test, ARM64 image, new task definition, wait until stable; ECS rolls back a failed rollout) and `infra/envs/dev/github.tf` (a UniRise-only role for `MentorEDGE/UniRise` dev, through the account's existing GitHub OIDC provider; the deployed image recorded in SSM `/unirise/dev/api-image-digest`, which `ecs.tf` reads, so a later `tofu apply` keeps the image GitHub deployed). Infrastructure changes still go through `tofu plan` and `tofu apply` |
| A5 | ~~Scheduled tenant backups~~ **Done 2026-11-17** | EventBridge Scheduler `unirise-dev-nightly-backup` runs the admin task with `backup-all` at 03:00 IST: one dump per live institution to `exports/backups/<slug>/` (AES-256, kept 30 days). First manual run: 3 of 3; first scheduled run 2026-11-18 03:01 IST: 2 of 2 (Demo University deleted). A failed run emails the team (A8); the run is in the log group under `admin/` |
| A6 | ~~Frontend hosting~~ **Done 2026-11-16** | Hostinger publishes `dev-unirise.mentoredge.co.in` from the `dev` branch; the pages call the AWS API (`KNOWN_APIS` in `store.ts`); `.htaccess` stops browsers keeping an old page |
| A7 | Human IAM users with MFA instead of root; budget alerts | **Done 2026-11-18**: budget `unirise-dev-monthly`, $80 a month for resources tagged Project=UniRise (the `Project` cost-allocation tag switched on for the account), emails corporate@mentoredge.co.in at 80% actual and 100% forecast. People sign in as IAM users with MFA (unirise-require-mfa), not root; the deploy key on the operator's Mac has no MFA (A4 removes the need for it) |
| A8 | Alarms (task health, 5xx, RDS storage and CPU), rate limiting at the edge | **Alarms live 2026-11-17** (`alerts.tf`): API with no healthy server for 3 minutes (the health check includes the database), more than 10 server errors in 5 minutes, database storage under 2 GB, database CPU over 80% for 15 minutes, and any failed database admin job (the nightly backup); all email corporate@mentoredge.co.in through SNS (the subscription must be confirmed from that mailbox). Rate limiting at the edge (AWS WAF, about $6-7 a month) not done |
| A9 | ~~Upload scanning~~ **Built 2026-11-17** | GuardDuty Malware Protection for S3 on the uploads bucket only (`malware.tf`); each object is tagged with its scan result and the API opens a file only when it is NO_THREATS_FOUND (otherwise a short page: still being checked, flagged, or could not be checked) |
| A10 | Production environment: region and account choice, Multi-AZ, deletion protection | Not designed |
| A11 | ~~Commit the infra and API changes from 2026-11-04~~ **Done 2026-11-14** | The running image was built from source that was uncommitted until then |

## 7. Plan

Each phase ends with tests passing and the docs updated. Order matters: phases 2 to 5 depend on phase 1.

**Phase 0. Housekeeping.** Pending infra and API changes committed on 2026-11-14 (A11). `RDMS_WEB_FEATURES.md` rewritten from the code on 2026-11-17 (three roles, 7 record types, review states, schools, 60 reports).

**Phase 1. Decisions.** D1 to D4 were decided on 2026-11-14 (section 8). D5 to D8 follow the recommendations unless changed.

**Phase 2. Roles and sign-in (G1, G2, G19, G23). Done 2026-11-14.** 42 backend tests (37 run, 5 parked by D3), including `SignInAndUserManagementTest`. Three roles in `AccessService`. Accounts with password hashes, cookie session, CSRF header, lockout and idle timeouts kept in the database so they survive a restart. User management endpoints. Admin action log. Provisioning creates the first Office account.

**Phase 3. Schema (G4, G5, G8 to G14, G16, G21, G22). Done 2026-11-14 (tenant V7, control V6).** Decision taken while building it: records are stored as the UI's JSON in one `record` table with typed columns for what the server checks (kind, display id, owner, status, credited faculty, dates, version) instead of one table per kind. Reason: D2 keeps reports and analytics in the browser, G29 needs JSON custom fields anyway, and one table gives every kind the same workflow. The older `publication`, `research_grant` and `seed_proposal` tables and their endpoints still work but are superseded and have no screen; remove them when the team agrees. Original text: Tenant migrations V6 onward: `fdp`, `conference`, `honour`, `intellectual_property`, `biodata`, `profile_change`, `notice`; publication and grant columns; `under_review` status; display codes; targets and weights in settings; enabled features, custom field definitions and configurable lists in settings, plus a `custom` JSONB column on every record table (G28 to G30). Rule limits such as the seed-money ceiling and "PDF required" become settings (G31). Update `TENANT_DB_SCHEMA.md`.

**Phase 4. Entry and approval APIs (G6, G7, G9 to G15, G17, G18). Done 2026-11-14.** `POST/DELETE /api/records/{kind}`, `/api/office/approvals` (views, count, start, review, grant outcome), profile updates. Rules ported from `domain.ts`. New kinds on the existing `EntryWorkflow`. Rules ported from `rdms-web/src/lib/domain.ts`. Office approvals queue, counts, start review, grant outcome. Profile change workflow.

**Phase 5. Profiles, settings, notices (G16, G20 to G22). Done 2026-11-14.** `GET /api/data` (the scoped slice, with ETag/304), `PUT /api/faculty/{id}` (including former faculty), `PUT /api/settings` (with feature switches, custom fields and lists), notices, enquiries (stored; email in phase 7), and an operator-only demo-data loader. Biodata read and write, official faculty details, departments, targets, weights, notices.

**Phase 6. Frontend switch (G3). Done 2026-11-14; the SQLite prototype server was removed on 2026-11-17 after its API tests were ported to Java (`InstitutionApiTest`).** The API answers the same requests as the prototype, so the switch is one setting: `VITE_API_BASE` (empty = same origin). The frontend's end-to-end test (298 checks per run, every page and workflow for the three roles) passes against the Java API through `rdms-web/scripts/api-proxy.mjs` with the sample data loaded by `scripts/export-demo.ts`.

**Phase 7. AWS (A1 to A9). Done 2026-11-18.** Done: A1 (uploads A1b, enquiry email A1a), A2 secrets, A3 SES production access, A4 deploy from GitHub, A5 nightly backups (first scheduled run 18 Nov: 2 of 2 institutions), A6 hosting, A9 virus scanning, A11. A7 budget, A8 alarms. Phase 7 complete; WAF rate limiting (about $6-8 a month) is left for production. The frontend is on Hostinger and calls the API cross-origin with the SameSite=Strict session cookie and CORS for the one allowed origin, as planned.

**Phase 8. Later.** OIDC with per-institution settings and integration webhooks (G33), per-institution report selection (G32), configurable review steps only when a customer needs them (G34), server-side reports and PDF if the browser approach is outgrown, production environment (A10), harvesting, webhooks.

## 8. Open decisions

| # | Decision | Recommendation |
|---|---|---|
| D1 | Sign-in for the pilot: password as in the UI, or wait for OIDC | **Decided 2026-11-14:** password for the pilot with the UI's existing protections; OIDC in phase 8. OIDC design is still deferred |
| D2 | Data contract: keep the UI's "one scoped slice, compute in the browser" model, or move reports and analytics to the server | **Decided 2026-11-14:** keep it for the pilot. The server scopes the data, the UI computes the reports (60 today) and all analytics. Revisit when an institution's data gets large |
| D3 | Old-model modules with no screen (milestones, meeting logs, projects, relationships, periods, scoped grants) | **Decided 2026-11-14:** park. Keep the tables, stop exposing the endpoints |
| D4 | Where the frontend is hosted | **Decided 2026-11-14:** Hostinger, on `dev-unirise.mentoredge.co.in`. Same site as the API, so SameSite cookies work. Hostinger publishes the site from the `dev` branch automatically; no AWS frontend resources |
| D5 | Can the Office grant individual features or data scopes, or are permissions fixed per role | Fixed per role until a customer asks |
| D6 | Seed-money window: one switch (UI) or dated cycles (backend) | Keep dated cycles in the database, show "open now" to the UI |
| D7 | Are reads by the Office audited, or only changes | Changes only for the pilot |
| D8 | Score weights and targets: per institution (as built) or platform defaults with overrides | Per institution, seeded from defaults |

## 9. Not checked for this document

- QA audit 2026-11-20/21: 389 checks across the three roles, security, files on AWS and load (report: https://claude.ai/artifact/AsmrTN2CGEC9Vv9MwWwxFU). Fixed: profile phone validation, the Office no longer receives faculty drafts, unused files are removed.
- Updated 2026-11-18. AWS resources in section 6 were checked live with the AWS CLI on 2026-11-18 (the deploy user), including the first scheduled nightly backup, the GitHub deploy, the budget and SES production access. The backend suite ran on 2026-11-17: 64 tests, 0 failures, 5 skipped (parked features); the GitHub deploy runs it again on every API change.
- The SNS alert subscription to corporate@mentoredge.co.in waits for its confirmation link to be clicked; until then alarm emails are not delivered.
- Grant and seed-money columns were compared at table level, not field by field.
