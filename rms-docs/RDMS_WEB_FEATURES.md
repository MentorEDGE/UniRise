# rdms-web: feature reference

**Snapshot:** 2026-11-17, `dev` at 586d345. Rewritten from the code; it replaces the 2026-11-06 snapshot, whose role model (platform-wide Office of Research, self-registration, management approving records) no longer applies. The code is the source of truth; file references point to it.

**Where it runs:** `https://dev-unirise.mentoredge.co.in` (pages on Hostinger, published from `dev`) calling the Java API `https://api.dev-unirise.mentoredge.co.in` (`unirise-api` on AWS). The old Node/SQLite prototype server was removed on 2026-11-17 (its API tests now run against the Java API); locally the website runs against the Java API (see `rdms-web/README.md`). `src/lib/domain.ts` stays as the reference for the record rules. See `BACKEND_PLAN.md`.

## 1. Roles

Three roles, fixed (decided 2026-11-06 and 2026-11-14). Each institution has its own accounts; the UniRise team provisions institutions.

| Role | Sees | Does |
|---|---|---|
| **Office of Research** | Everything in its institution, in every state, including former faculty | Reviews every entry and profile update (the only role that does); records grant outcomes and sanctioned seed money; creates and manages accounts; marks faculty as former; institution settings (schools, departments, targets, score weights, seed money window), notices; reads the audit log |
| **Top-Level Management** | Approved records of current faculty only, without review comments; current faculty's profiles | Read only: dashboards, analytics, reports, profiles |
| **Faculty** | Own records in every state; colleagues' names and departments only (to pick co-authors) | Enter records, submit them for review, answer comments and resubmit; propose profile updates |

Rules in `scopeFor` and `canView` (`src/lib/domain.ts`); the Java API applies the same (`DataSlice`, `AccessService`).

**Former faculty** (retired, resigned, transferred, other; with the last working day): the Office of Research keeps their profile and records. They cannot sign in. Management does not see them, and they are left out of the active faculty count and all current figures. Decided 2026-11-17: this holds for every year and every role, including the Office of Research. Their records stay in the lists (the institution's database) but count in no figure, chart, report or ranking; a record shared with a current faculty member counts for that person only.

## 2. Records and the review workflow

Seven record types: **Publications, Grants & Fellowships, Seed Money, FDPs, Conferences, Honours & Awards, Intellectual Property** (patent, design, copyright, trademark). Display ids come from one counter per institution: `PUB`, `GRT`, `SM`, `FDP`, `CNF`, `AWD`, `IPR`.

Statuses: **Draft → Submitted → Under Review → Approved / Changes Requested / Rejected**. Opening a submission starts the review. Changes Requested goes back to the faculty member, who corrects it and resubmits (shown as **Resubmitted**). Every record keeps a history (who, when, action, comment); management sees only creation and approval, never comments. Rejecting or requesting changes needs a comment.

Credit: a record counts for its owner and internal co-authors or co-investigators. Institution, school and department totals count a shared record once.

Field rules per type (DOI uniqueness, investigator shares adding up to 100%, seed money ₹1 to ₹5,00,000, dates not in the future, PDF required to submit except for books, and so on) are in `domain.ts`; the Java API ports them (`Records.java`).

## 3. Schools and departments

An institute or college has departments. A **university** can also have **schools** (Institution → Institution & Departments): every department belongs to exactly one school. With schools:
- every "Department" filter becomes **School / Department**, with departments grouped under their school and an "All of <school>" choice (dashboards, analytics, record lists, report pages, Approvals, Research Networks);
- Find Profiles has a School filter;
- Department Comparison has **By school** and **By department**;
- every "Department wise" summary report also comes as **School wise**;
- the annual report shows each department's school.

Institutions without schools see none of this. Helpers: `src/lib/org.ts`. Sample data: XYZ University has three schools; ABC Institute of Technology has none.

## 4. Office of Research

- **Dashboard** (home): what is waiting (new and resubmitted, under review, profile updates, changes requested, oldest waiting), an oldest-first list with Review links, counts by type, then the institution at a glance (as management sees it).
- **Approval:** tabs New and resubmitted, Under review, Changes requested, Approved, Rejected; per record type and profile updates; school/department filter. Review window with the conversation, decision and comment; grant outcome and seed money sanction.
- **User Management:** create Faculty and Top-Level Management accounts (the person is emailed a link to set their own password, or the Office gives them a temporary password shown once), suspend, deactivate, email a new password link or create a temporary password, change role. **Audit Log** of sign-ins and every change.
- **Institution:** name, tagline, academic-year start month, seed money window, schools, departments (one with faculty cannot be removed); **Targets & Scoring**; **Notices** shown to faculty.
- Everything management sees (below), across all statuses.

## 5. Top-Level Management (read only)

- **Dashboard:** academic year and school/department filter; figures with change against the year before (active faculty, publications, Q1 + Q2, sanctioned funding, grant proposals, FDP hours, conferences, honours & IP, seed money, collaboration); insights; top researchers; charts (output over six years, by department, journal quality, grant funding, FDP hours, conference participation, monthly activity); top journals and funding agencies. The former "Institution Overview" page is part of it.
- **Faculty:** Find Profiles (search and filters: expertise, SDG, school, department, designation, availability), research profiles, Faculty Performance.
- **Record views** per type, and **report pages** per type with a sidebar of ready-made reports.
- **Seed Money**, **Research Networks** (collaboration network, between departments, countries, SDGs).
- **Reports menu:** Annual Activity Report (printable), Department Comparison, Participation & Compliance.

## 6. Faculty

- **My Workspace** (home): what needs action, figures for the year, notices, quick add buttons.
- **My Profile:** research profile (biodata, expertise, SDGs, supervision, teaching, engagement, Follow Me links checked per site: LinkedIn, X, ResearchGate, GitHub, YouTube, SSRN, website); updates go to the Office of Research for approval. **My Performance:** figures, score, **My targets** for the year, charts by year, records. **CV** to print or save as PDF.
- A menu per record type (My Publications, My Grants, **My Seed Money**, My FDPs, My Conferences, My Awards, My IP) with add screens; **My Collaborations**; **My Submissions** (All, Needs your action, Submitted, Under Review, Changes Requested, Approved, Rejected, Draft).

## 7. Reports

**60 reports** in six groups, as a list (one row per record) or a summary (one row per key, with totals), each with filters, **Export CSV** and **Print**:
- Publications 12, Grants 10, FDPs 8, Conferences 8, Honours & Awards 8, Intellectual Property 8 (54 in all);
- plus a **School wise** version of each group's department summary (6), listed only for universities with schools.

Management reports use approved records of current faculty; the Office can choose any status. Faculty see the same catalogue computed from their own records. Definitions: `src/lib/reports.ts`.

**Targets** (per faculty, per academic year; defaults): publications 2, FDP hours 30, conferences 1, grant proposals 0.5. **Score weights** are per institution (Targets & Scoring); only approved records score.

## 8. Sign-in and security

Email and password (decision D1; OIDC later). Java API: PBKDF2 hashes; HttpOnly, SameSite=Strict, Secure session cookie; 8-hour idle timeout (30 minutes for the Office of Research), 12 hours at most; `X-RDMS` header on every change; 5 failed sign-ins lock an email for 15 minutes, 20 lock an address; former, suspended or deactivated accounts cannot sign in. **Password links by email** (added 2026-11-18): "Forgot password?" on the sign-in page emails a reset link (1 hour; the answer is the same whether or not the account exists; 3 requests per email in 15 minutes), and the Office's invitations email a link to set a password (7 days). Links open `#/set-password`, work once, are replaced by a newer link, stop working if the account is suspended, and setting the password signs the account out everywhere and signs the person in. Without email (local runs) the Office hands out temporary passwords as before. On the AWS dev site the sample accounts on the sign-in page only fill in the email; every sample account uses the demo password `Unirise123` (`scripts/load-demo.sh`).

## 9. Presentation

Landing page; dark and light themes (remembered per browser); UniRise by MentorEdge with the institution's name; one menu bar that folds into a Menu button on phones; print stays light; pages tested on desktop and phone for every role.

## 10. Not built yet

OIDC (university single sign-on), configurable approval chains, per-institution report selection. Tracked in `BACKEND_PLAN.md` (phase 8). Built since the first version of this list: enquiry email, file uploads with virus scanning, invitations and password reset by email.
