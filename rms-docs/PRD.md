# RMS – Product Requirements Document

Status: Draft v0.4 (adds a database per institution; B2B tenant lifecycle and SSO in Phase 2) · Owner: TBD · Last updated: 2026-11-02 · v0.2 adds the org hierarchy, supervision and milestones, and visibility rules (see ACCESS_AND_VISIBILITY_MODEL.md)

## 1. Summary
RMS is a multi-tenant SaaS that gives a university a single, current system of record for its researchers, publications, grants and projects, and produces the reports the research office is asked for (accreditation, rankings, funders, annual faculty review) without manual spreadsheet assembly.

## 2. Problem
Research output is scattered across Scopus, Web of Science, ORCID, department spreadsheets and the repository. Research offices spend weeks per reporting cycle collecting and reconciling it; faculty are repeatedly asked to re-enter the same data; deans lack a trustworthy view. Incumbent tools (Elsevier Pure, Symplectic) are expensive and heavy; open-source options (VIVO, DSpace) need specialist staff to host and customise.

## 3. Goals / Non-goals
**Goals**
- G1. Faculty enter almost no data: publications are harvested and only need confirming.
- G2. Research office produces its standard annual report in under 30 minutes (baseline: days to weeks; to be measured in discovery).
- G3. Hosted, multi-tenant, onboarding of a university in under 2 weeks.
- G4. Strict tenant data isolation.

**Non-goals (v1)**
- Full-text repository / preservation (integrate with DSpace instead).
- Peer review, manuscript submission, or research data management.
- Student academic records (enrolment, grades, fees) or an HR system of record. PhD scholars are in scope as researchers: supervision, milestones and their own outputs only.
- Replacing grants/finance systems (read-only integration only).

## 4. Users and personas
| Persona | Needs | Success signal |
|---|---|---|
| Research Office Admin (buyer/primary) | Accurate institution-wide data, repeatable reports, approval control | Report built without manual spreadsheet work |
| Dean / Department Head | Scorecard for their unit, trends, funding vs. output | Uses dashboard monthly |
| Executive (Pro-VC Research, VC, Registrar) | University-wide view across institutions; readiness for accreditation and ranking | Gets institution-wide numbers without asking the research office |
| Researcher / Faculty | Own profile always correct, minimal effort | Confirms suggestions in under 5 min/quarter |
| PhD Scholar | Sees own stage, deadlines and feedback | Knows the next milestone and due date without asking |
| Supervisor (faculty) | Tracks mentees and own supervision load | Overdue milestones visible without chasing |
| Institution IT Admin | SSO, user provisioning, security review | Passes security questionnaire |
| Platform Operator (us) | Create/suspend tenants, monitor | Self-serve tenant bootstrap |

## 5. Scope and requirements
Priority: P0 = pilot-blocking, P1 = needed to sell, P2 = later.

### 5.1 Tenancy and access
- R1 (P0). Each university is an isolated tenant; no cross-tenant read or write, including via references between records. *Implemented in MVP (API key per tenant).* From v0.4 each institution has its own database (ARCHITECTURE.md ADR 11, MULTI_TENANCY_DESIGN.md).
- R2 (P0). Operator-only tenant creation. *MVP.*
- R3 (P1). Per-user authentication. Access is role + scope + sensitivity (ACCESS_AND_VISIBILITY_MODEL.md §1). Roles: Researcher/Scholar (self), Supervisor (own mentees), HoD (department), Dean (school), Executive (whole tenant, aggregates by default), Research Admin, IT Admin (access settings, no research content), Guest (time-limited, narrow), Read-only. Role grants are time-bound and can be delegated (acting HoD). Sign-in in Phase 2 is OIDC single sign-on (R4); an invitation-based email one-time link is for sandbox and demo tenants only.
- R4 (P1). SSO via OIDC (Google Workspace, Microsoft 365) in Phase 2 and SAML 2.0 in Phase 3. University IT will not approve email-link login for real staff.
- R5 (P1). Audit log of changes and report exports (Phase 3). The access log, meaning named drill-downs by executives and deans plus platform support access, is Phase 2 because R27 depends on it.

### 5.2 Organisation and people
- R6 (P0). Departments; researchers with name, email, title, department, ORCID (format-validated). *MVP.* Departments become org units in R23.
- R7 (P1). Bulk import of staff from CSV; later HR sync.
- R8 (P1). Researcher status (active/left) with effective dates so historical reports stay correct.

### 5.3 Publications
- R9 (P0). Create/edit publications with authors, year, venue, type, DOI. *MVP.*
- R10 (P0). Import by DOI from Crossref, rejecting duplicates per tenant. *MVP.*
- R11 (P1). Automatic harvest per researcher from ORCID and OpenAlex (later PubMed, Scopus, Web of Science where licensed).
- R12 (P1). Claim/verify workflow: system proposes matches; researcher confirms or rejects; research admin can override. Only verified records count in official reports.
- R13 (P1). De-duplication and merge by DOI, then fuzzy title+year+author match with human confirmation.
- R14 (P2). Open-access status and funder-mandate compliance flags; link to repository record.

### 5.4 Grants and projects
- R15 (P0). Awards with funder, amount, dates, principal investigator. *MVP.*
- R16 (P1). Co-investigators, projects grouping awards and publications, import from finance/grants system.

### 5.5 Reporting
- R17 (P0). JSON reports: totals, publications by year, top researchers, department output and funding. *MVP.*
- R18 (P1). CSV and PDF export; saved report definitions; date-range and department filters.
- R19 (P1). Templates for annual faculty report and one accreditation/ranking format agreed with the pilot customer.
- R20 (P2). Collaboration networks, trend analytics, benchmarking.

### 5.6 Web application and public profiles
- R21 (P1). Web UI for admins, deans and researchers.
- R22 (P2). Optional public profile site per tenant (VIVO-style showcase), indexable.

### 5.7 Integrations (P1–P2)
ORCID, OpenAlex, Crossref, SSO providers, DSpace/repository sync, HR and grants systems via CSV first, API later.

### 5.8 Organisation, supervision and progress
- R23 (P1). Org hierarchy per tenant: institution/campus → school → department → research group, as a tree of org units. Replaces the flat department list; data rolls up the tree.
- R24 (P1). Supervision relationships (primary and co-supervisor, effective-dated) plus a backup supervisor. A supervisor who leaves or retires triggers an alert and a reassignment flow.
- R25 (P1). PhD milestones per scholar (registration, coursework, proposal, progress reviews, thesis submission, viva) with due dates, status and approvals. Reminders go to the scholar and the supervisor and escalate when overdue.
- R26 (P1). Meeting logs and mentoring notes, confidential by default and visible only to the scholar and the supervisors named on the record.
- R27 (P1). Sensitivity tiers on records (public record, internal, confidential), enforced on the server. Executives see aggregates by default; drilling down to a named person is logged and excludes confidential data.
- R28 (P1). Period close: freeze a snapshot of reported figures for an academic or financial year so submitted numbers do not change.
- R29 (P1). Cross-department counting: each department gets credit by the author's appointment on the publication date; university totals count each item once.
- R30 (P1). Disputes: a researcher can contest or reject a claim; every change is audited.

### 5.9 Tenant lifecycle and operations (B2B)
- R31 (P1). Fast onboarding: the operator provisions a tenant, the customer sets up OIDC SSO and imports people and org structure from CSV with a preview. Target: first report within two weeks of kickoff (G3).
- R32 (P1). Pilot and sandbox tenants with synthetic or limited data that convert to paid without migrating data.
- R33 (P1). Tenant controls: suspend; export all of a tenant's data; delete all of it at contract end with confirmation; restore a single tenant from backup.
- R34 (P1). Per-tenant settings: logo and accent colour, currency, fiscal year, report templates, classification lists.
- R35 (P2). Usage metering: active researchers per month for billing. What counts as a paid seat is a commercial decision (see Open).
- R36 (P1). Integration surface: versioned API, API keys with rotation, webhooks for key events, CSV import for HR and grants data.

### 5.10 Institutional entry modules (from a reference RMS)
Source: a research data management system used at a large Indian university (screenshots and a short feature list, `RMS.docx`). Only the features below are described there in enough detail to specify.
- R37 (P1). Publication entry by type (Book, Book chapter, Conference paper, Journal article, Technical report). Fields: category, DOI or web link, title, journal or venue, publish month and year, ISSN (journals), project reference. Authors table covers people from this institution, **outside authors, ex-faculty and ex-students** (the last two with termination or course-completion date). PDF upload (PDF only, up to 10 MB, optional for books). Save draft, then submit. Statuses: draft, submitted, approved, rework, revision required, rejected. Only approved entries count in reports.
- R38 (P1). Grant entry as a five-step form (basic details, investigators, enclosures, other information, submit) with save draft at any step. Statuses: draft, submitted, sanctioned, rework, rejected. Exactly one lead investigator; investigator shares total 100%. UTN is assigned on sanction.
- R39 (P1). Seed money: proposals (category, title, abstract, investigators with type and lead PI) during a **quarterly application window enforced by the server**. Statuses: approved, yet to be submitted, submitted, rework, reject, revision required. Report by date range and status.
- R40 (P1). Report catalogue with CSV export and print: 11 publication reports (by year, institute, department, employee ID, roll number, journal, faculty- or student-authored, partner institution, continent, counts) and 8 grant reports (by type, department, year received, inter-institute, percentage sharing, sanctioned details, employee ID, counts) with a date range and, for grants, a date basis (applied, entered or sanctioned).
- R41 (P1). Researcher lookup by employee ID, ORCID iD or Scopus ID, limited to people the viewer may see.
- R42 (unscheduled). The reference system's menu also names Grant Call, Incentive Point, Journal Entry, APC, IPR, Approval, PAS, Conference and Search, but the source document does not describe them. Do not design or build them until the first customer defines what each does.
- Institution-specific fields in the reference (for example an "ERF related" flag, grant units such as "Indian Grant") are per-tenant settings and custom fields (R34), not fixed columns.

## 6. Non-functional requirements
- Security: tenant isolation tested automatically; keys stored hashed; least-privilege roles; OWASP ASVS L2 target before first paid customer.
- Privacy: collect minimum personal data; GDPR-ready (export/delete a researcher); regional hosting option in Phase 4. Scholar data is limited to supervision, milestones and own outputs. The launch region decides which law applies (for example India's DPDP Act). Confidential notes never roll up to Dean or VC views.
- Availability: 99.5% in pilot, 99.9% for paid tier. Daily backups, tested restore.
- Performance: list/report endpoints p95 < 500 ms for a tenant of 5,000 researchers and 200,000 publications.
- Accessibility: WCAG 2.1 AA for the web UI.
- Data quality: every publication records its source and verification state.

## 7. Success metrics
- Pilot: ≥ 80% of target department's known publications present and verified within 30 days.
- Time to produce annual report: ≤ 30 min (vs. measured baseline).
- Researcher effort: median < 5 min/quarter.
- Activation: ≥ 60% of invited researchers connect ORCID.
- Commercial: 1 pilot signed → 1 paid conversion within 2 semesters.

## 8. Phasing
| Phase | Content | Exit criterion |
|---|---|---|
| 1 MVP | R1, R2, R6, R9, R10, R15, R17 (built, unverified build) | Runs end to end in a demo tenant |
| 2 Pilot-ready | R3, R4 (OIDC), R7, R11–R13, R18, R21, R23–R27, R31–R34, R36, R37–R41 | One department live with real users |
| 3 Sellable | R4 (SAML), R5, R8, R16, R19, R14, R22, R28–R30, R35 | Passes a university security review |
| 4 Scale | R20, repository/HR/grants integrations, data residency | Multiple paying tenants |

## 9. Risks and open questions
- Author disambiguation drives most data-quality cost → ORCID/DOI keys plus mandatory human verification.
- Data-source licensing (Scopus/WoS APIs need institutional keys) → start with open sources (ORCID, OpenAlex, Crossref).
- Slow university sales cycles → free pilot with a research-office champion.
- Privacy law differs by region (GDPR, FERPA) → decide launch region(s).
- Decided (ACCESS_AND_VISIBILITY_MODEL.md §7): one tenant per legal customer with colleges as org units; PhD scholars have accounts; HR system or CSV is the source of truth for people and org structure; milestones and supervision are in v1.
- Decided: each institution has its own database (ADR 11). Open: which report format does the pilot customer need first? Does the first customer accept a shared hosted service, and where may data be stored? Who owns data after contract end (export guarantees)? What counts as a paid seat (leavers, students, guests)? Pricing tiers by researcher count to be validated.
