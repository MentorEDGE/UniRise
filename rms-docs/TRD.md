# RMS – Technical Requirements Document

Status: Draft v0.4 · Companion to PRD.md, ACCESS_AND_VISIBILITY_MODEL.md and MULTI_TENANCY_DESIGN.md · Last updated: 2026-11-02
"MVP" below means what exists in `src/` today; it has not yet been compiled or tested in CI.

## 1. Architecture
Modular monolith: one Spring Boot 3.3 / Java 21 service over PostgreSQL 16. A single deployable keeps operations simple for a small team; module boundaries (below) allow later extraction of harvesting into a worker. Check that Spring Boot 3.3 is still supported before the first customer and move to a current supported release if it is not.

```
Client (web UI / API) ──HTTPS──> Spring Boot API ──> PostgreSQL
                                   │  ├─ TenantFilter (auth → tenant id)
                                   │  ├─ CRUD + Reports controllers
                                   │  └─ Harvest jobs (Phase 2) ──> Crossref / OpenAlex / ORCID
```

Modules: `tenancy/auth`, `directory` (org units, people, appointments), `supervision` (relationships, milestones, meeting logs), `publications`, `grants`, `reports`, `harvest` (Phase 2), `integrations` (Phase 3).

## 2. Multi-tenancy
- Model (v0.4, ARCHITECTURE.md ADR 11): **a separate PostgreSQL database per institution**, plus a small control-plane database with the institution registry. There is no `institution_id` filtering inside tenant data. Full design: MULTI_TENANCY_DESIGN.md (tenant router, provisioning, per-tenant migrations, backup, restore, deletion, connection pools).
- Enforcement (MVP): the tenant id is derived only from the authenticated credential, stored in a request attribute, and passed to every repository call (`findByIdAndInstitutionId`, `findByInstitutionId`). `institutionId` is `@JsonIgnore`d so clients cannot set it. Cross-references (department, researcher, author IDs) are re-validated against the tenant before save. Reports filter by tenant in every query.
- Hardening (Phase 2–3): Row-Level Security is no longer needed for tenant isolation. Instead: an isolation test that a user of tenant A cannot reach tenant B through any endpoint, a test that background jobs fail without a tenant context, and caches keyed by tenant (MULTI_TENANCY_DESIGN.md §4 and §12). The service layer still asserts the tenant on every record as a second guard.
- Isolation test (exists): `TenantIsolationTest` checks cross-tenant read, cross-tenant author reference, bootstrap auth, and report scoping. Extend per new endpoint.
- Escape hatch: tenant-per-schema or per-database for customers with residency or contractual isolation needs.
- Decided (ADR 11): each institution has its own database; large or in-region tenants may have their own database server. The MVP's shared-schema code (`institution_id` filtering in repositories) is replaced by the tenant router and must be migrated before any real data (§11 item 9).

## 3. Authentication and authorization
- MVP: per-tenant API key in `X-API-Key` (256-bit random, SHA-256 hash stored, shown once). Tenant creation requires `X-Admin-Key` (env `RMS_ADMIN_KEY`, constant-time compare; endpoint disabled if unset).
- Target: OIDC/SAML SSO via Spring Security; session or JWT for the web UI; API keys retained for service integrations, with rotation and revocation.
- Access = role + scope + sensitivity. Roles: `PLATFORM_ADMIN`, `RESEARCH_ADMIN`, `IT_ADMIN`, `EXECUTIVE` (VC, Pro-VC, Registrar; whole tenant), `DEAN` (school subtree), `HOD` (department subtree), `SUPERVISOR` (own mentees via `relationship`), `RESEARCHER` (self, includes PhD scholars), `VIEWER`, `GUEST` (time-limited, item-level). A designation is a title, not a permission: an admin gives role grants, each with a scope node and validity dates.
- Visibility check: the viewer is the owner, or has a `relationship` to the owner, or holds a `role_grant` whose scope contains the owner's org unit, and the record's sensitivity is within what the role may see. Resolution order, most specific wins: screen → field sensitivity → per-record restriction → whole-record private. Checked in the service layer on every read and write, never only in controllers or the UI.
- Delegation: role grants are time-bound and can be granted by another role-holder (acting HoD, an assistant to the VC).
- Named drill-down by Executive or Dean is logged. Platform support access is break-glass and logged.
- Phase 2 sign-in: OIDC single sign-on (Google Workspace, Microsoft 365) through Spring Security, with a session cookie for the web UI. SAML follows in Phase 3. Invitation-based email one-time links are for sandbox and demo tenants only.
- Rate limiting and lockout on key failures (Phase 2).

## 4. Data model
From v0.4 these tables live in each **tenant database** and do not carry `institution_id`; ignore that column in the definitions below (it remains only in the MVP's shared-schema code). The `institution` table moves to the control plane with its connection details (MULTI_TENANCY_DESIGN.md §3). Current tables:
- Control plane: `institution(id, slug, name, key_hash unique, status, plan, region, db_host, db_port, db_name, secret_arn, schema_version)`; each tenant database also keeps one `institution` row of its own (name, locale, currency, fiscal year, branding)
- `department(id, institution_id, name)`
- `researcher(id, institution_id, name, email, title, orcid, department_id)`
- `publication(id, institution_id, title, doi, venue, type, pub_year)` + `publication_authors(publication_id, authors_id)`
- `award(id, institution_id, title, funder, amount, start_year, end_year, researcher_id)`

Planned additions:
- `org_unit(id, institution_id, parent_id, type[campus|school|department|group], name)` replaces the flat `department`; existing departments migrate as `department` units under one root. Subtree queries use a closure table `org_unit_closure(ancestor_id, descendant_id, depth)` (or PostgreSQL `ltree`); choose before the first scoped endpoint, because every read depends on it
- `researcher` becomes the general person record (type: faculty, scholar, staff, guest)
- `app_user(id, institution_id, subject, researcher_id)` – login identity only; permissions come from `role_grant`
- `appointment(id, institution_id, researcher_id, org_unit_id, designation, fte, valid_from, valid_to)` – supports joint appointments; department credit uses the appointment valid on the publication date
- `role_grant(id, institution_id, researcher_id, role, scope_org_unit_id, valid_from, valid_to, granted_by)`
- `relationship(id, institution_id, mentor_id, mentee_id, type[primary|co|backup], valid_from, valid_to)`
- `milestone(id, institution_id, scholar_id, stage, due_date, completed_at, status, approved_by)`
- `meeting_log(id, institution_id, relationship_id, held_on, notes, sensitivity)`
- `classification_scheme(id, code)` and `classification_term(id, scheme_id, code, label, valid_from, valid_to)` instead of hardcoded enums (journal quality lists, publication types)
- `period(id, institution_id, label, starts_on, ends_on, closed_at)` and `period_snapshot(period_id, org_unit_id, metric, value, payload jsonb)`
- `tenant_settings(institution_id, currency, locale, fiscal_year_start)`; `currency` on `award`; `sensitivity` (public|internal|confidential) on activity records; `version` integer on editable records (optimistic locking)
- `institution` gains `status[sandbox|pilot|active|suspended|closed]` and `plan`; `access_log(id, institution_id, actor, action, target_person_id, at)` for named drill-downs and platform support access (Phase 2); `usage_counter(institution_id, month, active_researchers)` for metering
- Entry modules (PRD R37–R41): `publication` gains `category`, `pub_month`, `issn`, `project_ref`, `project_details`, `student_publication`, `entry_status[draft|submitted|approved|rework|revision_required|rejected]`; `publication_author(publication_id, researcher_id?, kind[internal_faculty|internal_student|external|ex_faculty|ex_student], name, institution, department, email, end_date, continent)`; `grant(id, institution_id, unit, type, source, status[draft|submitted|sanctioned|rework|rejected], utn, title, description, call_title, agency, agency_comment, applied_on, entered_on, sanctioned_on, applied_amount, sanctioned_amount, duration_months, matching_grant, remarks, owner_id)`; `grant_investigator(grant_id, researcher_id?, name, role, is_lead, institution, department, share_pct)`; `seed_window(institution_id, label, opens_on, closes_on)`; `seed_proposal(id, institution_id, window_id, category, title, abstract, status, applied_on, owner_id)` with `seed_investigator`; `attachment(id, institution_id, owner_type, owner_id, filename, size, content_type, storage_key)`; `review_event(entity_type, entity_id, action, actor, comment, at)` as the workflow history; `researcher` gains `employee_id`, `roll_no`, `scopus_id` (unique per tenant).
- Server rules: a new seed proposal is rejected (409) outside the window; submitting a grant requires title, agency and exactly one lead, and shares totalling 100%; only `approved` publications (or harvested, verified ones) count in reports; approval is checked against role and org scope.
- `publication_source(publication_id, source, external_id, fetched_at, raw jsonb)` – provenance
- `authorship_claim(publication_id, researcher_id, state[suggested|verified|rejected], decided_by, decided_at, score)`
- `researcher_affiliation` is replaced by `appointment` (above)
- `audit_log(id, institution_id, actor, action, entity, entity_id, at, detail jsonb)`
- `report_definition`, `export_job`
- Indexes: `(institution_id, doi)` unique where doi is not null; `(institution_id, pub_year)`; `(institution_id, department_id)`; trigram index on normalised title for matching.

## 5. API
REST/JSON under `/api`, tenant-scoped, paginated (`page`, `size` ≤ 200). List responses use the envelope `{items, total, page, size}` with a stable default order. List filters: `q`, `year`, `type`, `state`, `orgUnitId`, `sort`. Researcher responses include `publicationCount`. Deleting an org unit that still has people or child units returns 409.

| Area | Endpoints (MVP) |
|---|---|
| Tenancy | `POST /api/institutions?name=` (admin key) |
| CRUD | `/api/{departments,researchers,publications,awards}` GET list, GET/PUT/DELETE `/{id}`, POST |
| Import | `POST /api/publications/import?doi=` |
| Reports | `GET /api/reports/{summary,publications-by-year,top-researchers,departments}` |

Planned: `/api/grants`, `/api/seed-money` (with `/window`), `/api/{publications|grants|seed-money}/{id}/review` (action approve, rework, revision_required or reject, with a comment), `/api/attachments`, `/api/researchers/lookup?kind=employee|orcid|scopus&value=`, `/api/reports/{slug}?from=&to=&basis=` for the report catalogue, `/api/me`, `/api/auth/*`, `/api/imports` (CSV import with preview and per-row errors), `/api/webhooks`, `/api/platform/tenants/{id}/{suspend|export|delete}` (platform admin only), `/api/claims`, `/api/org-units`, `/api/role-grants`, `/api/relationships`, `/api/milestones`, `/api/meeting-logs`, `/api/periods`, `/api/harvest/runs`, `/api/reports/{id}/export?format=csv|pdf` (reports also take `periodId` and `orgUnitId`), `/api/users`. Provide OpenAPI via springdoc; version under `/api/v1` before first external customer. Error bodies carry no internal messages (`server.error.include-message=never`).

## 6. Harvesting (Phase 2)
- Scheduler + queue table in Postgres (`SKIP LOCKED`) to avoid new infrastructure; move to a broker only if needed.
- Sources: ORCID public API (works by iD), OpenAlex (by ORCID/institution), Crossref (by DOI). Respect rate limits and polite-pool headers; exponential backoff; per-source circuit breaker.
- Matching: DOI exact → ORCID-linked author → fuzzy (normalised title + year + author surname) producing `suggested` claims with a score. Nothing becomes `verified` without a human action. Confirmed and rejected suggestions feed back into the scoring. De-duplication clusters candidates, then classifies on title, year and author string.
- "ORCID connected" (proposed): the researcher signs in with ORCID once so the iD is verified. Harvesting still uses the public API.
- Idempotent upserts keyed by `(source, external_id)`; keep raw payload for reprocessing.
- Outbound calls only to a fixed allowlist of hosts (SSRF control); the DOI value is regex-validated before use.

## 7. Reporting
- MVP: JPQL aggregates executed per request, always parameterised by tenant.
- Scale path: materialised views refreshed after harvest/edit for department and year rollups; CSV streamed; PDF rendered server-side from templates (e.g. OpenPDF/Thymeleaf) in an async export job with a stored result and expiry.
- Official reports count only `verified` claims and effective-dated appointments.
- Counting: each org unit gets credit by the author's appointment on the publication date; university totals count each publication once.
- Period close writes `period_snapshot` rows (a forward copy, so submitted figures do not change). Live reports show an "as of" date.

## 8. Security requirements
- Input validation at the boundary (Bean Validation, ORCID/DOI formats); no mass assignment of server-owned fields.
- Uploads: PDF only, up to 10 MB, content type checked on the server (not the file name), virus-scanned, stored outside the web root and served as a download.
- Secrets only from environment/secret store; compose file refuses to start without `RMS_DB_PASSWORD`; DB bound to localhost in dev.
- TLS terminated at ingress; HSTS; secure headers; CORS restricted to the UI origin.
- Dependency scanning (OWASP dependency-check or Dependabot) and SAST in CI; secrets scanning.
- Access log for named drill-downs and platform support access (Phase 2); audit log for writes and exports (Phase 3).
- Personal-data handling: researcher delete/export endpoints; no student academic records (scholars hold only supervision, milestones and own outputs); meeting logs and mentee notes never feed rollups; confidential projects show as "restricted" to people outside them; encryption at rest via managed Postgres/volume encryption.
- Pre-sale: third-party penetration test, ASVS L2 checklist, completed HECVAT-style questionnaire.

## 9. Non-functional targets
- p95 < 500 ms for list/report calls at 5,000 researchers / 200,000 publications per tenant (verify with load test; add indexes above).
- 99.5% (pilot) → 99.9% (paid) availability; RPO ≤ 24 h → ≤ 1 h with PITR; RTO ≤ 4 h; quarterly restore drill.
- Observability: structured logs with tenant id (no PII), metrics and tracing via Micrometer/OpenTelemetry, harvest-run dashboards and alerts.

## 9a. Tenant lifecycle and operations (B2B)
- **Provisioning:** the operator creates a sandbox or pilot tenant, sets its plan and status, and the customer configures OIDC. Pilot converts to active by changing status, with no data migration.
- **Onboarding:** CSV import of org units, people and appointments with a preview and per-row errors before commit; imports are idempotent and re-runnable (HR is the source of truth).
- **Contract exit:** export of all tenant data in open formats (CSV plus JSON); delete-all with confirmation and a written deletion record; both are platform-admin actions and are logged.
- **Backup and restore:** daily backups with a tested restore. Restoring a single tenant must be possible: nightly per-tenant `pg_dump` to S3 plus instance-level RDS backups, with scheduled restore drills (MULTI_TENANCY_DESIGN.md §8).
- **Per-tenant limits:** rate limits and job concurrency per tenant so one large tenant cannot starve the others.
- **Metering:** monthly active-researcher counts. No billing engine in v1.
- **Support access:** platform console with break-glass access to a tenant, time-limited and recorded in `access_log`.
- **Observability:** logs and metrics carry the tenant id and never personal data.

## 10. Delivery and environments
- Repo: Maven build, JUnit tests (H2 in PostgreSQL mode for unit/integration; Testcontainers Postgres for tenant-routing, per-tenant migration and index tests).
- CI: build, test, dependency scan, container build. CD to staging on merge, production by tag.
- Packaging: container image; managed PostgreSQL; schema migrations via Flyway, applied **per tenant database** by the migrator, plus a separate migration set for the control plane (replace the MVP `ddl-auto=update` before any real data).
- Environments: local (docker compose: PostgreSQL 16, MinIO, Mailpit), shared dev on AWS `ap-south-1` (RDS, S3, SES, ECR; Terraform in `infra/`), staging (synthetic data), production per region. Staging and production should live in separate AWS accounts.

## 11. Known gaps in the MVP (to close, in order)
1. Build and test run not yet verified (Maven not available on the dev machine).
2. Replace `ddl-auto=update` with Flyway migrations.
3. Per-user auth and roles; SSO.
4. Control plane, tenant router, provisioner and per-tenant migrator (replaces the earlier Postgres RLS plan; MULTI_TENANCY_DESIGN.md).
5. Pagination uses unsorted page requests; add stable ordering.
6. Crossref calls lack timeout/retry configuration.
7. No UI, CSV/PDF export, audit log, or harvest jobs.
8. The flat `department` table and five-role model must become the org tree, role grants and relationships in §3–§4 before a pilot.
9. The MVP's shared-schema tenancy must be replaced by the control plane, tenant router, provisioner and migrator (MULTI_TENANCY_DESIGN.md).

## 12. Decisions and open questions
- Decided: greenfield (not a VIVO/DSpace fork), Java/Spring Boot + PostgreSQL, shared-schema multi-tenancy.
- Accepted (ACCESS_AND_VISIBILITY_MODEL.md §7): one tenant per legal customer with colleges as org units; PhD scholars have accounts; HR or CSV is the source of truth for people and org structure; milestones and supervision are in v1.
- Open: production region and AWS account (dev is on AWS `ap-south-1`), and whether the first customer accepts shared hosting; whether the first customer needs SAML before Phase 3; confirm the SPA choice in RMS_FRONTEND_ARCHITECTURE.md; licence for any third-party bibliographic data used; Kuali or other grants systems are CSV import only until an API is confirmed with the customer.
