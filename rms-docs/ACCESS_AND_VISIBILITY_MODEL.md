# RMS – Access, Visibility and Flow Model

Status: Draft v0.2 · Companion to PRD.md, TRD.md, ARCHITECTURE.md, FRONTEND_SPEC.md, PRIOR_ART_STUDY.md · Last updated: 2026-11-02 · v0.2: decisions 1, 2, 3 and 7 accepted and applied to the other docs
Purpose: define who sees what in an institution, how data flows, and the edge cases to settle before building. Nothing here is implemented yet. Where it conflicts with the other docs, §5 and §8 say so.

---

## 1. Core idea

RMS is one **record of research activity**; each person sees a different **slice** of it. Each fact is stored once and filtered by who is asking. A fact is a publication, grant, project, supervision link, milestone, patent or event, and each is linked to a **person** and an **org unit**.

Access is the combination of three things:

| Ingredient | Meaning | Example |
|---|---|---|
| **Role** | What actions the person can do | Researcher, Supervisor, HoD, Executive, Admin |
| **Scope** | Which part of the university they can see | Self, my mentees, my department, my school, everything |
| **Sensitivity** | How confidential the data is | Public record, internal, confidential |

Designation is not permission. "Professor" is a title. Being a HoD or a supervisor is a **role grant** given by an admin, usually for a limited period. One person often holds several roles at once.

## 2. Hierarchy

```
Tenant (the customer: a university or university group)
 └─ Institution / campus / affiliated college
     └─ School / Faculty
         └─ Department
             └─ Research group / lab
```

Each node has a `type` and a `parent`. Data rolls up the tree. Colleges get their own research office with delegated admin; the VC sees across all of them.

## 3. Who sees what

| Who | Question they ask | Sees | Can edit |
|---|---|---|---|
| **Researcher / PhD scholar** | "Where am I? What is due?" | Own outputs, milestones (registration, coursework, proposal, thesis, viva), supervisor feedback addressed to them, pending claims | Own profile, claims, logs |
| **Faculty / supervisor** | "How are my people doing, and how am I doing?" | Own record; each mentee's progress, overdue milestones, meeting logs; own supervision load and graduated scholars | Own record, mentee meeting notes |
| **HoD** | "How is my department doing?" | Department rollup, per-faculty outputs, scholars by stage, who is overdue | Validates records, assigns supervisors |
| **Dean** | "How do my departments compare?" | School rollup, department comparison, funding vs output | Mostly read |
| **Pro-VC (Research) / VC** | "How is the university doing, and where do I intervene?" | University-wide totals and trends, per-institution and per-school comparison, ranking and accreditation readiness | Read; approves reports |
| **Registrar** | "Are we compliant and is the paperwork complete?" | Compliance and record completeness, scholar counts by stage, accreditation data | Read; report sign-off |
| **Research office admin** | "Is the data correct and can I produce the report?" | Everything in scope, data-quality queues | Almost everything |
| **IT admin** | "Who has access?" | Users, roles, SSO, audit log; no research content | Access settings |
| **Guest** (external examiner, auditor) | One narrow job | Specific items, time-limited | Nothing |

**Rule: aggregates go up, detail stays down.** The VC sees department totals and trends by default. Named individuals are visible only through a controlled drill-down that is logged.

### Sensitivity tiers
- **Public scholarly record** (papers, awards): visible to anyone whose scope includes the person.
- **Internal** (project status, milestone dates): visible to the person, their supervisor and their unit heads.
- **Confidential** (appraisal comments, mentee welfare notes, misconduct cases, NDA or industry projects, budgets): visible only to named people. Never rolled up to Dean or VC views.

## 4. End-to-end flow

1. **Set up the tenant.** The operator creates it; the customer builds the org tree and imports people and appointments (HR or CSV).
2. **Assign roles** by role template (for example "HoD" gives the department-subtree scope). Roles have start and end dates.
3. **Collect data** from three sources:
   - Harvested: publications via ORCID, OpenAlex, Crossref.
   - Entered by people: projects, supervision, milestones, mentoring logs.
   - Imported: grants and finance data.
4. **Verify.** Suggested → claimed by the researcher → (optional per tenant) validated by the HoD.
5. **Review progress** continuously through each person's own view.
6. **Close the period** (academic or financial year) and freeze a snapshot so reported numbers stop changing.
7. **Report.** Produce accreditation and funder formats and the annual faculty report. Exports are logged.

## 5. Data representation

Proposed model (extends TRD §4; today only `department`, `researcher`, `publication`, `award` exist):

| Table | Key fields | Notes |
|---|---|---|
| `org_unit` | id, parent_id, type, name | Replaces flat `department` |
| `person` | id, name, email, orcid | Researcher, staff, scholar or guest |
| `appointment` | person, org_unit, designation, fte, valid_from, valid_to | Effective-dated; supports joint appointments |
| `role_grant` | person, role, scope_unit, valid_from, valid_to, granted_by | Time-bound, supports acting and delegated roles |
| `relationship` | mentor, mentee, type (primary/co-supervisor/backup), valid_from, valid_to | Drives supervisor visibility; the backup type covers a supervisor who leaves |
| `milestone` | scholar, stage, due, completed, status | PhD progress |
| `meeting_log` | relationship, date, notes, sensitivity | Mentoring record |
| Activity records | publication, award/project, patent, event | Each carries `sensitivity`, owner and the org unit **at the time** |
| `classification_scheme` / `classification_term` | scheme, code, label, valid_from, valid_to | Replaces hardcoded enums (journal quality lists change over time) |
| `period` / `period_snapshot` | period, org unit, metric, value | Frozen figures at period close |

**Visibility check:** a record is visible if the viewer is the owner, or has a `relationship` to the owner, or holds a `role_grant` whose scope contains the owner's unit, and the record's sensitivity is within what that role may see. Executive dashboards read precomputed rollups per unit and period.

**Differences from the other docs (applied in PRD, TRD, FRONTEND_SPEC and ARCHITECTURE v0.2 on 2026-11-02)**
- The five roles in TRD §3 are too coarse. Add Supervisor, HoD, Executive and Scholar. "Dean (department-scoped)" mixes up Dean and HoD.
- `app_user` has no department or scope. Replace with `appointment` + `role_grant`.
- Supervision, milestones, projects and patents are not in the data model yet.

## 6. Edge cases

**People and structure**
- Joint appointments across two departments: credit is split or counted in both.
- Transfers and promotions mid-year: affiliation needs effective dates, and a paper counts for the unit the author was in on the publication date.
- Acting or rotating HoDs, delegated access (for example a PA to the VC), vacant posts.
- Leavers: access ends, outputs stay in past reports.
- Visiting, adjunct, emeritus, postdoc and project staff who are not regular employees.
- A supervisor leaves or retires, leaving scholars without one: needs a reassignment flow and an alert.
- Co-supervision and a change of supervisor midway.
- Name variants, duplicate people, researchers with no ORCID.

**Counting and fairness**
- Double counting: a paper with authors from three departments counts once for the university but once per department. Rollups must count *distinct* items.
- Disciplines publish very differently; comparisons across fields need normalisation.
- Journal quality lists (for example UGC-CARE, Scopus-indexed) change over time; predatory journals need flagging.
- Retractions, preprint vs published versions, duplicates.
- Leaderboards can demotivate and cause disputes: show a person their own rank and others only aggregates.

**Trust and disputes**
- A researcher claims a paper that is not theirs, or rejects one the HoD thinks is theirs: needs a dispute workflow and a full audit trail.
- If pay or promotion depends on the data, it will be contested. Treat it as an official record.

**Privacy and security**
- PhD scholars are students. PRD §3 lists "student records" as a non-goal and TRD §8 says "no student data". Decide explicitly what is allowed for scholars.
- Confidential projects (NDA, defence) show only "restricted" to people outside the project.
- Mentee welfare notes must never roll up to Dean or VC views.
- Break-glass support access for our own staff, always logged.
- Data-protection law (for India, the DPDP Act): export, erase and consent for public profiles, versus the institution's need to keep records.
- A stale HR import can leave someone with the wrong scope: run periodic access reviews.

**Time and operations**
- Reporting periods differ (calendar, academic, financial); snapshots stop numbers moving after submission.
- Harvested data lags: show an "as of" date.
- Reminders for overdue claims and milestones need an escalation chain or they become spam.
- Offboarding the customer: guarantee a full data export on termination.

**B2B business**
- Define what a "seat" is for pricing: do leavers, students and guests count?
- SSO, white-labelling, per-college billing, and whether affiliated colleges need sub-tenants.

## 7. Decisions needed before building

| # | Decision | Recommendation |
|---|---|---|
| 1 | Tenant boundary | One tenant per legal customer; colleges are org units with delegated admin |
| 2 | Do PhD scholars get accounts? | Yes, with own-data-only access |
| 3 | Source of truth for people and org structure | Customer HR system or CSV; role grants managed inside RMS |
| 4 | Can executives see named individuals? | Yes, via a logged drill-down that excludes confidential data |
| 5 | Credit rule across departments | Full credit per department, distinct counts at university level |
| 6 | Is HoD validation required? | Optional per tenant; researcher self-verification by default |
| 7 | Is v1 outputs only, or also progress (milestones, mentoring)? | Include milestones and supervision in v1, because the product goal is progress |
| 8 | Launch region and first reporting formats | Pick the first customer's formats and design the fields around them |

**Status (2026-11-02):** decisions 1, 2, 3 and 7 are accepted as recommended. Decisions 4, 5 and 6 stand as default recommendations pending customer input. Decision 8 is open.

## 8. Open items and impact on other docs

- India-specific points (UGC-CARE, NAAC, NIRF, DPDP) are assumptions about the target market and are not verified. Confirm the launch region.
- Applied: PRD R23–R30, TRD §3–§7 (roles, data model, API, counting, snapshots) and FRONTEND_SPEC §3–§4 (scholar, supervisor and executive screens).
- Phase 2 sign-in is proposed as invitation-based email one-time link until SSO ships in Phase 3. To confirm with the first customer.
- Still unverified: the India-specific points, and whether a shared hosted service is acceptable to the first customer.
