# rdms-web: features not in the original plan

> **Status 2026-11-06: gap analysis only, parked.** `unirise-web`, mentioned below, was removed from the repository on 2026-11-14. Decisions since: roles are final (Top-Level Management, Faculty, Office of Research; all earlier roles dropped), `rdms-web` is the product frontend on PostgreSQL via `unirise-api`, login/OIDC deferred. The role mapping in §4 step 1 and the "two role models" conflict are therefore superseded. The behaviour reference is now `RDMS_WEB_FEATURES.md`.

Date: 2026-11-06. Source: `rdms-web/` (commits b8299cd, a68eecc, 22d235e, 50bbba2, 40612cd, merged into `dev` as a844b6b) compared with `PRD.md`, `FRONTEND_SPEC.md`, `TRD.md`, `ACCESS_AND_VISIBILITY_MODEL.md` and the `unirise-api` schema (migrations V1 to V3 plus later tenant migrations).

## 1. What this is

`rdms-web` is a second, self-contained app (React + its own Node/SQLite server) that went ahead of the plan. The plan describes researchers, scholars, supervisors, HoD/Dean/Executive scopes, milestones, confidential meeting logs, claims and harvest. `rdms-web` models a different shape: an institutional faculty-output system with three roles (Office of Research, Top-Level Management, Faculty). Its entities are publications, grants, seed money, FDPs, conferences and honours & awards.

`unirise-api` currently has publications, grants and seed money. It has no FDP, conference, honours/award, biodata, notice, target or weight tables. `unirise-web` (the planned frontend) is a separate mock-driven app.

## 2. Feature list (not in the original docs)

Status: **Built** = working in `rdms-web` on its own SQLite backend. **API gap** = no equivalent in `unirise-api`.

### A. New record types
| # | Feature | Status | API gap |
|---|---|---|---|
| U1 | **FDPs** (programme type, mode, level, organiser, role, hours), entry, approval, list, 8 reports | Built | Yes |
| U2 | **Conferences** (participation type, level, country, funding, fees, claims, award), entry, approval, 8 reports | Built | Yes |
| U3 | **Honours & Awards** (level, category, conferring body, date), private to the owner, level-based score weights backfilled for existing institutions, 8 reports, profile/CV, dashboards, analytics, annual report | Built | Yes. The planned "Awards" in `PRD.md` R15 means funder-style awards, a different thing. |
| U4 | Publication extras: quartile, indexing, open-access flag, author kinds (Faculty/Student/External/Ex-Faculty/Ex-Student), inter-institution and student-authored reports | Built | Partial. The API has authors but no quartile/indexing/OA/author kind. |
| U5 | Grants extras: investigator share percentages with rupee split, funding agency, grant source, sanction details | Built | Partial |

### B. Faculty-side
| # | Feature | Status | API gap |
|---|---|---|---|
| U6 | **Biodata / CV** view and edit, per faculty | Built | Yes |
| U7 | **Self performance** page (own statistics against targets) | Built | Yes |
| U8 | Faculty see only their own profile; colleagues' approved publications and directory entries only. Profile search is management-only. | Built | Rule exists in `AccessService`; profile model differs |

### C. Management-side
| # | Feature | Status | API gap |
|---|---|---|---|
| U9 | **Analytics**: institution, department, faculty performance, participation, with attainment against targets | Built | Yes (planned reports are the 19-report catalogue only) |
| U10 | **Targets and weights** settings (per institution scoring) | Built | Yes |
| U11 | **Annual report** (compiled, printable) | Built | Partial. `PRD.md` mentions it; no endpoint. |
| U12 | **Notices** (management posts, shown to faculty) | Built | Yes (`FRONTEND_SPEC.md` mentions notices only briefly) |
| U13 | **Faculty directory and add/edit profiles** in advance of sign-up | Built | Partial (CSV import exists) |
| U14 | 46 reports across publications, grants, FDPs, conferences and awards, with group-by and list modes, CSV export | Built | The API's 19 reports do not cover these |
| U15 | Approvals queue for all six record types | Built | Partial (publications, grants, seed money) |

### D. Platform / access
| # | Feature | Status | API gap |
|---|---|---|---|
| U16 | **Self-registration and access-request flow**: request, Office of Research reviews, email-domain match check, "affiliation verified" tick, links or creates faculty profile on approval | Built | Yes. The plan was invitation-based. |
| U17 | **Office of Research role** (renamed from IT Admin; code unchanged): approves access, activates/suspends users and institutions, resets passwords, audit log, cannot read research data; separate `/#/admin` route, 30-minute idle timeout | Built | Partial. The plan's IT Admin is "access settings, no research content". |
| U18 | Password sign-in with scrypt hashes, lockout after 5 failures for 15 minutes, CSRF header, HttpOnly SameSite cookies | Built | The API uses invitation sessions and API keys; OIDC is planned |
| U19 | Platform-level institution add/suspend; sessions end on suspend | Built | Partly covered by tenant lifecycle |

### E. Presentation
| # | Feature | Status |
|---|---|---|
| U20 | **Landing page**: slogan, proof points, RISE framework (Record, Insight, Stewardship, Elevate), audience cards, scroll reveal, mobile layout | Built |
| U21 | **Dark mode**: light/dark toggle in menu bar, remembered per browser, follows OS default, dark logo, themed charts, print stays light | Built |
| U22 | UniRise by MentorEdge branding, simplified header, Profile menu, steadier dropdowns | Built |
| U23 | Multi-institution co-branding: institution name beside the UniRise brand | Built |

## 3. Conflicts with the existing plan

1. **Two role models.** Plan: Researcher/Scholar/Supervisor/HoD/Dean/Executive/Research Admin/IT Admin/Guest. rdms-web: Office of Research/Management/Faculty. Decision needed on mapping (see §4, step 1).
2. **Two backends.** `rdms-web` runs SQLite, one server process, in-memory login throttling. `unirise-api` runs PostgreSQL per tenant on Fargate. Both implement tenancy.
3. **Sign-in.** Plan: OIDC, invitation links for sandbox. rdms-web: email + password with approval flow.
4. **Naming.** "Awards" (funder awards, PRD R15) versus "Honours & Awards" (recognition). Keep both names distinct in the API.
5. **Misc.** Plan has milestones, confidential meeting logs, claims, duplicates, harvest. None exist in `rdms-web`.

## 4. Plan to fold these into the platform

Each step ends with tests and a doc update. Nothing here is started.

1. **Model decided (2026-11-06): option (a), `rdms-web` is the product frontend.** Still to do: map roles and update `PRD.md`/`FRONTEND_SPEC.md`. Options were: (a) `rdms-web` becomes the product frontend and `unirise-api` serves it; (b) `rdms-web` stays a prototype and the features are rebuilt in `unirise-web`. Also map roles: Management → HoD/Dean/Executive grants, Faculty → Researcher, Office of Research → IT Admin/Research Admin. Update `PRD.md` and `FRONTEND_SPEC.md` accordingly.
2. **Schema.** Add tenant migrations for FDP, conference, honours/award, biodata, notice, targets and weights, plus publication/grant extras (quartile, indexing, open access, author kind, investigator share). Update `TENANT_DB_SCHEMA.md`.
3. **Entry APIs.** FDP, conference, honours using the existing shared draft, submit and review workflow in `unirise-api`. Honours owner-private via `AccessService`.
4. **Reports.** Port the rdms-web report definitions (46) to the report catalogue; reuse the CSV writer with formula defusing.
5. **Analytics and settings.** Targets, weights, attainment, annual report endpoint.
6. **Registration and approval flow.** Design the access-request endpoint with the email-domain check. Needs the SES decision (invitations are blocked on SES sandbox exit).
7. **Frontend switch.** Point `rdms-web` (or `unirise-web`) at the real API slice by slice, starting with sign-in and publications. Replace the SQLite server last.
8. **Presentation items.** Landing page, dark mode and co-branding need no API work; carry over as-is to whichever frontend wins step 1.
9. **Security carry-overs.** Keep the lockout, CSRF and idle-timeout behaviour as acceptance tests against the API.

## 5. Open questions
- Is password sign-in acceptable for the pilot, or OIDC only?
- Should honours stay owner-private for management too, as in `rdms-web`?
- Are score weights per institution or platform-wide?
