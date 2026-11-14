# rdms-web: feature reference

> **Update 2026-11-06 (after merge of d764653):** this snapshot predates commit d764653. Confirmed by the product owner: **each institution has its own Office of Research** (admins for that institution only), and many institutions share the platform. So wherever this doc says Office of Research is platform-wide or cross-institution, or describes public self-registration and platform-level institution management, it is superseded: accounts are now created by the institution's Office of Research, and institutions are provisioned by the UniRise team with `npm run provision`. Sections 1, 6 and 10 need a full rewrite once the team's changes settle.

**Snapshot:** 2026-11-06, `dev` at a844b6b (includes origin/main 40612cd). The team has changes in progress, so treat this as the current state and update it once those land. Source of truth for behaviour is the code; file references below point to it.

**Decided by the product owner (2026-11-06):**
- Roles are final: **Top-Level Management**, **Faculty**, **Office of Research**. Earlier roles (scholar, supervisor, HoD, Dean, Executive, IT Admin, Guest) do not exist.
- **Office of Research is the full platform admin**: it oversees everything in the RMS (accounts, roles, permissions, records, approvals, dashboards), and everything is audited. The prototype implements only the account and institution part; sections 1 and 10 mark the difference.
- `rdms-web` is the product frontend. Production uses `unirise-api` as the backend on PostgreSQL. The SQLite server in `rdms-web/server/` is a prototype whose rules serve as the specification.
- Production sign-in will be OIDC. Design is deferred. The password sign-in described below is the prototype's behaviour.

Companion doc: `RDMS_WEB_UNPLANNED_FEATURES.md` (gap analysis against the original plan). Deferred.

---

## 1. Roles and who sees what

| Role | Scope | Can do | Cannot do |
|---|---|---|---|
| **Office of Research** (code value `it_admin`) | Platform | **Target (product owner, 2026-11-06):** the platform administrator that oversees everything in the RMS. Creates accounts; grants roles, permissions and the data access each role needs; approves records (publications, grants, seed money, FDPs, conferences, honours); sees all dashboards, analytics and reports; every action is audited and retained. **Prototype today:** approves/rejects access requests, assigns institution and role, activates/suspends/deactivates accounts, resets passwords, adds and suspends institutions, reads the audit log. | Nothing is outside its remit, but all actions are logged. Prototype cannot read research data, which differs from the target. |
| **Top-Level Management** | One institution | **Target (product owner, 2026-11-06): view only.** Sees the institution's data, dashboards, analytics and reports. **Prototype today** also approves records, records grant outcomes, manages the faculty directory, settings and notices; those move to Office of Research or are re-decided (see section 4 and 10). | Approve or reject anything; see other institutions; make entries on behalf of faculty |
| **Faculty** | One institution | Create and edit own entries, submit for approval, own biodata, own reports and statistics | See colleagues' biodata, FDPs, conferences, honours, grants, seed money or contact details |

Faculty visibility (`canView`, `scopeFor` in `src/lib/domain.ts`):
- Records on which they are credited (owner, or internal co-author/co-investigator), in any state.
- Other faculty's **approved publications** only.
- Colleagues' directory entries show name, department and research IDs. Phone and joining date are blanked.
- Faculty cannot open or search another faculty member's profile. Profile search is management-only.

## 2. Record types (all use the same workflow)

Workflow: **Draft → Submitted → Approved / Rework / Rejected**. Rework returns to the owner, who edits and resubmits. Only Draft and Rework entries are editable. Only Drafts can be deleted. Each record keeps a history (who, when, action, remark). IDs are prefixed per type (`PUB`, `GRT`, `SM`, `FDP`, `CNF`, `AWD`) from one counter per institution.

Reviewing is **Office of Research only** (target; the prototype lets management review). Reject and Rework need a remark. Approval needs no remark.

### 2.1 Publications
Types: Journal Article, Book, Book Chapter, Conference Paper, Technical Report. Fields: category, title, DOI, month/year, ISSN, venue, indexing (Scopus, Web of Science, both, UGC CARE, none), quartile (Q1–Q4, NA), impact factor, ERF-related, project reference, open access, authors, PDF name.
Authors have a kind: Faculty, Student, External, Ex-Faculty, Ex-Student.
Rules: the owner must be an author; year between 1950 and the current year; duplicate DOI is rejected with a pointer to the existing entry; PDF required to submit except for books.

### 2.2 Grants
Fields: unit (Indian/International/Consultancy), type, UTN, title, description, call title/source, source, agency, applied date/amount, duration, ERF-related, matching grant, contact, investigators, enclosures, remarks.
Set by Office of Research after approval (prototype: management): **outcome** (Applied, Sanctioned, Not Sanctioned, Completed), sanction date, sanctioned amount, received amount. Received cannot exceed sanctioned.
Rules: owner must be an investigator; shares add up to 100%; exactly one PI; applied amount > 0.

### 2.3 Seed money
Fields: applied date, category (Faculty/Student), title, abstract, requested amount, investigators. Requested amount ₹1 to ₹5,00,000. The reviewer sets the sanctioned amount when approving (Office of Research in the target). New applications are blocked when the **seed money window** setting is closed.

### 2.4 FDPs
Role (Attended, Organised, Resource Person), programme type (FDP, Workshop, STTP, Refresher Course, Orientation Programme, MOOC), title, organiser, sponsor, mode (Offline/Online/Hybrid), level (Institutional/State/National/International), from/to dates, hours, outcome, certificate name. Must have taken place already; to-date not before from-date.

### 2.5 Conferences
Participation (Paper/Poster Presented, Invited Talk/Keynote, Session Chair, Attended, Organised), conference name, paper title, organiser, venue, country, level, mode, dates, proceedings indexing, funding (Institution/Self/External Agency), registration fee, amount claimed, award, certificate name. Same date rules as FDPs.

### 2.6 Honours & Awards
Category (Award, Honour/Distinction, Fellowship of a Learned Society, Best Paper/Presentation, Academic or Editorial Recognition, Scholarship/Travel Grant), title, conferred by, level, date received, citation, prize amount, certificate name. Date cannot be in the future. Prize cannot be negative.
Counted in dashboards, analytics, scores and the annual report; shown on the faculty profile/CV. Distinct from "awards" in the original PRD (funder awards).

### 2.7 Credit
A record counts for its owner plus internal Faculty co-authors/co-investigators. Institution-level totals count a co-authored item once.

## 3. Faculty features
- **Home:** own summary tiles and the institution's notices.
- **Entry screens** per record type (draft, save, submit, resubmit after rework).
- **Biodata / CV** view and edit: DOB, gender, address, summary, research interests, Google Scholar, PhD guided/ongoing, qualifications, experience, awards, memberships. Printable.
- **Own profile:** faculty may update only their own phone, email, ORCID and Scopus ID.
- **Self performance:** own statistics against the institution's targets, from own records only.
- **Reports:** the faculty's own slice of the report catalogue.

## 4. Top-Level Management features

**Target: Top-Level Management only views data and analytics and approves nothing.** Items marked *(prototype)* are things the prototype lets management do that now need a new owner (probably Office of Research); see section 10.

- **Dashboard:** counts, awaiting-approval list, target attainment by department, activity by department, top performers by weighted score, notices.
- *(prototype)* **Approvals queue** for all six record types, with grant outcome entry. Target: moves to Office of Research.
- **Faculty directory:** view. *(prototype)* also add, edit, deactivate faculty profiles ahead of sign-up. Employee code is 3–20 letters/digits and unique. Department must be one of the institution's departments.
- **Profile search** and a per-faculty profile with biodata.
- **Analytics:** institution, departments, faculty performance, participation. Filters: academic year or date range, department. Charts for publications, FDP hours and conferences by year.
- **Annual report:** compiled, printable (Print / Save as PDF).
- *(prototype)* **Settings:** institution name and tagline, departments (cannot remove one that still has faculty), academic-year start month (default June), seed money window, **targets**, **score weights**.
- *(prototype)* **Notices:** post and delete; faculty see them on their home page.

### Targets (per faculty, per academic year; seed defaults)
Publications 2, FDP hours 30, conferences 1, grant proposals 0.5.

### Score weights (seed defaults)
Journal by quartile Q1 10, Q2 8, Q3 6, Q4 4, other 3. Book 8, chapter 4, conference paper 3, technical report 2. Grant sanctioned 10 plus 0.5 per ₹1 lakh (capped at 20 extra); an unsanctioned grant scores 1. Seed money 3. FDP attended 2, organised 4, resource person 3. Conference presented 3, invited 4, chair 2, attended 1, organised 4. Honours: international 6, national 4, other 2. Only Approved records score. Weights are per institution and editable.

### Profile completeness
14 checks (email, phone, ORCID, Scopus ID, DOB, gender, address, summary, interests, Google Scholar, qualification present, PhD listed, experience, memberships) give a percentage. Management dashboards report the average and how many are at 80% or more.

## 5. Reports
46 reports in five groups, each as a list or a group-by table with totals, filters, **Export CSV** and **Print**:
- Publications (12): institute-department, employee, journal, quartile, indexing, year, faculty-/student-authored journal, inter-institution, open access, department and employee counts.
- Grants (10): project type, department, agency, source, year, sanctioned details, all proposals, employee, percentage sharing, institution count.
- FDPs (8): faculty hours, department, programme type, mode, level, organiser, organised/resource person, all.
- Conferences (8): faculty, department, participation type, level, country, funding and claims, awards received, all.
- Honours & Awards (8): faculty, department, level, category, conferring body, year, international recognition, all.
Definitions: `src/lib/reports.ts`. Faculty see the same catalogue computed from their own records.

## 6. Access flow and Office of Research (prototype behaviour)
1. Public pages list active institutions and their departments.
2. A person **requests access** (`/register`): institution, role (Faculty or Top-Level Management), name, email, password, plus employee code and department for faculty. The response is the same whether or not the email exists. Rate-limited per IP.
3. The request is **pending**. The person cannot sign in.
4. Office of Research reviews it. The email domain is compared with the institution's; a mismatch is flagged. Approval requires ticking "affiliation verified". On approval a faculty account is linked to the faculty profile with that employee code, or the profile is created. A profile can be linked to only one account. Rejection requires a reason.
5. Account states: pending, active, rejected, suspended, deactivated. Suspending a user or institution ends sessions immediately. Role changes end sessions.
6. Office of Research also: reset passwords (one-time password shown once), create/suspend institutions (name, short code, email domain, departments), read the audit log.
7. Every admin action is written to an audit log.

Security behaviour worth keeping as acceptance tests against the API: scrypt hashing, 5 failed sign-ins lock an email for 15 minutes, HttpOnly SameSite=Strict cookie, CSRF header on state changes, 8-hour idle timeout for users and 30 minutes for Office of Research, separate sign-in route for Office of Research (`/admin`), the server (not the client) chooses the institution database, fields are whitelisted so a client cannot approve its own entry or set sanctioned amounts.

## 7. Presentation
- **Landing page:** slogan "Every contribution counted. Every institution elevated.", proof points, RISE framework (Record, Insight, Stewardship, Elevate), audience cards, closing statement, scroll reveal, mobile layout.
- **Dark mode:** sun/moon toggle in the menu bar (top right on sign-in pages), remembered per browser, follows the OS by default, dark logo, themed charts, print stays light.
- **Co-branding:** "UniRise by MentorEdge" with the institution's name and tagline beside it. Simplified header, Profile menu, dropdowns that stay open while moving into the list.
- **Print/PDF** via the browser for reports, the annual report and biodata.

## 8. Data model summary (prototype)
Per institution: settings (name, tagline, departments, academic-year start month, seed money window, targets, weights), faculty, biodata, publications, grants, seed money, FDPs, conferences, honours, notices, and one ID counter. Platform level: institutions, accounts, sessions, audit log. Types: `src/lib/types.ts`.

## 9. Not built in the prototype
Email delivery (registration/approval notices, password reset), real file uploads (only file names are stored), OIDC/SAML, two-factor for Office of Research, per-institution backup/export, scale-out beyond one process.

## 10. Open questions to confirm
1. **Office of Research: decided, details open.** Product owner (2026-11-06): it is the admin that oversees the whole RMS, from account creation to research records and every dashboard, with everything audited. This replaces the prototype's "no research data" rule and means the code needs: record view and review rights, cross-institution dashboards and reports, a permission model (who gets which role, feature and data scope), and a complete audit trail of reads as well as changes. Still to settle:
   - ~~Who approves?~~ **Decided:** only Office of Research approves. Top-Level Management approves nothing and only sees data and analytics.
   - Who owns what management did in the prototype: faculty directory add/edit, settings (departments, targets, score weights, seed money window), notices, grant outcome entry? Proposed: Office of Research for all of these; management read-only.
   - Are permissions a fixed set per role, or can Office of Research grant individual features and data scopes to a person? What is the list of grantable permissions?
   - Is it one team seeing all institutions, or can a member be limited to some institutions?
   - Should reads of records by Office of Research be audited, not just changes?
2. Should Top-Level Management be able to see honours of faculty? The prototype shows management everything in its institution; the commit message says honours are "private to the owner", which holds only for other faculty.
3. Are score weights and targets per institution (as built) or platform defaults with overrides?
4. Seed-money window: a single institution-wide switch (as built) or dated cycles?
5. Is "Top-Level Management" one level, or do some institutions need department-level heads later?
