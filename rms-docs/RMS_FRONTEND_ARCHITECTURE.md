# RMS – Frontend Architecture

> **Superseded 2026-11-06, kept for reference.** This described `unirise-web`, the first frontend, which was removed from the repository on 2026-11-14 (last commit containing it: 649ee73). The product frontend is `rdms-web`; see `RDMS_WEB_FEATURES.md` and `BACKEND_PLAN.md`. Still useful here: the UniRise design tokens in §3 (`rdms-web/src/styles.css` now holds the live copy) and the open brand questions in §12. The repository layout, roles, routes and same-origin hosting below no longer apply.

Status: Draft v0.1 · Companion to PRD, TRD, ARCHITECTURE and FRONTEND_SPEC · Last updated: 2026-11-02
Scope: the RMS web application (Phases 2–3), styled to match the UniRise page at https://mentoredge.co.in/unirise.

This document does not repeat screens and flows from FRONTEND_SPEC.md. It sets the structure of the code, the design system taken from UniRise, and the decisions FRONTEND_SPEC left open. Where it differs from FRONTEND_SPEC, §12 says so.

Source of the design values: I read the UniRise page's HTML and its two CSS files. Colours, radii, font and card styles in §3 are copied from there. The page does not show app-style screens (tables, forms, side navigation), so those patterns in §4–§5 are extensions of the same tokens, not copies. Check them with whoever owns the MentorEDGE brand.

---

## 1. Decisions

| # | Decision | Reason |
|---|---|---|
| F1 | React 18 + TypeScript + Vite SPA for the signed-in app | Stays as in FRONTEND_SPEC §2; one static bundle served from the API's origin |
| F2 | Tailwind CSS + shadcn/ui (Radix) | The UniRise site is built with Tailwind, and shadcn uses the same CSS-variable token model (`--primary`, `--card`, `--border`, `--radius`). Tokens copy across directly |
| F3 | Marketing and public profile pages are separate from the app | The UniRise landing page is a Next.js site. The app is a logged-in SPA. Only the design tokens are shared |
| F4 | One shared token package (`@rms/design-tokens`) | Keeps the app and any future public profile site visually identical to MentorEDGE |
| F5 | Light and dark themes from day one | The UniRise site has a theme toggle and a full dark palette |
| F6 | Per-tenant branding limited to logo and one accent colour | Answers the open question in FRONTEND_SPEC §10 without breaking the UniRise look |

Alternative to F1: server-rendered pages. If chosen, §3 (tokens) and §4 (components) still apply unchanged.

---

## 2. Repository layout

```
rms-web/
  package.json            pnpm workspace
  packages/
    design-tokens/        CSS variables, tailwind preset, fonts
    ui/                   shared components (Button, Card, Badge, DataTable, ...)
    api-client/           generated from OpenAPI (TRD §5), never hand-edited
  apps/
    web/                  the signed-in SPA
      src/
        app/              providers, router, layouts, error boundary
        features/         one folder per area (below)
        lib/              http client, auth, query keys, formatters
        i18n/             en.json, message loader
        test/             msw handlers, factories, a11y helper
      e2e/                Playwright flows (FRONTEND_SPEC §8)
    site/                 (optional, Phase 3) public profile site, server-rendered
```

`features/` mirrors the screens:

```
features/
  auth/            sign-in, session, route guards
  dashboard/       summary tiles, charts, checklist
  publications/    list, detail, import-by-DOI, delete
  people/          researchers, departments, profile, CSV import
  awards/
  review-queue/    claims (planned)
  duplicates/      merge (planned)
  reports/         catalogue, viewer, export
  settings/        users, SSO, harvest, API keys, audit log
  platform-admin/  tenant creation (internal)
```

Each feature folder contains `routes.tsx`, `api.ts` (thin wrappers over the generated client plus query keys), `components/`, `hooks/` and `schemas.ts` (Zod). Features may import from `packages/*` and `lib/`. **They must not import from each other**; shared pieces move to `packages/ui`. An ESLint boundary rule enforces this.

---

## 3. Design system (from UniRise)

### 3.1 Tokens

Values below were read from the live CSS. Format is HSL without the `hsl()` wrapper, as shadcn expects.

| Token | Light | Dark |
|---|---|---|
| `--background` | 252 100% 99% | 236 28% 9% |
| `--foreground` | 220 27% 13% | 257 100% 97% |
| `--card` | 0 0% 100% | 236 24% 14% |
| `--primary` | 263 70% 42% | 258 90% 66% |
| `--primary-foreground` | 0 0% 100% | 257 100% 97% |
| `--secondary` / `--muted` | 257 100% 97% | 251 44% 20% / 236 22% 16% |
| `--muted-foreground` | 220 9% 46% | 257 36% 78% |
| `--accent` | 261 73% 58% | 262 76% 56% |
| `--destructive` | 354 70% 54% | 0 100% 71% |
| `--border` / `--input` | 248 100% 95% | 248 28% 28% |
| `--ring` | 263 70% 42% | 258 90% 66% |
| `--radius` | 0.75rem | 0.75rem |

Also used on the page: landing accent `#7c3aed` (violet-600) for eyebrow labels, `#6d28d9` for deep violet, and a soft glow made from `primary/20` and fuchsia blurred circles behind hero sections. Easing: `--ease-out-strong: cubic-bezier(0.23, 1, 0.32, 1)`.

Semantic status colours (verification badges, report states) are **not** on the UniRise page. Proposed, derived to sit with the violet palette:

| State | Colour | Also shown as |
|---|---|---|
| Verified | green | check icon + "Verified" |
| Suggested | amber | sparkle icon + "Suggested" |
| Unverified | slate | dot icon + "Unverified" |
| Rejected / error | `--destructive` | x icon + text |

Colour is never the only signal (FRONTEND_SPEC §6).

### 3.2 Typography
- Font: **Figtree** (the page loads it as its sans font). Self-host it with `font-display: swap` and a size-adjusted fallback to avoid layout shift.
- Eyebrow label: `text-xs md:text-sm font-semibold uppercase tracking-[0.25em]`, violet-600 (light) / violet-400 (dark).
- Page title: `text-3xl md:text-4xl font-semibold tracking-tight`. Hero titles go up to `lg:text-6xl`; the app uses the smaller sizes.
- Card title: `text-lg md:text-xl font-semibold tracking-tight`. Body: `text-sm md:text-base`, `leading-relaxed`, slate-600 / slate-300.

### 3.3 Shape, elevation, motion
- **Cards:** `rounded-2xl`, 1px border `slate-200/70` (dark: `white/7%`), padding `px-8 py-8`, shadow `0 8px 32px rgba(0,0,0,.06)`. Hover: lift `-translate-y-1`, border `violet-200`, shadow `0 16px 48px rgba(91,33,182,.12)`, 300 ms. Dark mode swaps in `bg-card` and a violet glow shadow.
- **Primary button:** `rounded-full` on marketing; **`rounded-xl` with `shadow-[0_10px_24px_hsl(var(--primary)/.25)]` in the header** and the app. Height 40–44 px, `font-semibold`. Press: `active:scale-[.98]`.
- **Secondary button:** outlined, `rounded-full`, slate border, subtle hover fill.
- **Focus:** 2 px ring using `--ring`, 2 px offset. Never remove it.
- **Header:** sticky, translucent (`bg-background/85` + backdrop blur), bottom border `border/70`, content in a centred row: logo, centred nav, theme toggle + CTA.
- **Motion:** only transform and opacity, 200–300 ms, `ease-out-strong`. Sections fade/slide in on scroll on the landing page; the app uses this only for dialogs, toasts and cards. All motion disabled under `prefers-reduced-motion`.

### 3.4 Layout rules
- Content container: `container mx-auto px-4`, max width 80rem (`max-w-[80rem]`) for dashboards and lists, 72rem for forms and detail pages.
- Section rhythm on landing-style pages: `py-20 md:py-24`.
- Grids: 1 column on mobile, 2 at `sm`, up to 3–4 at `lg`, gap 6.
- Optional hero treatment for the dashboard header: soft background image or gradient, a white-to-transparent overlay, two blurred violet/fuchsia circles. Use it once per page at most.

---

## 4. App shell

The UniRise site uses a top header. A data-heavy app also needs a persistent side navigation. Proposed shell, using the same tokens:

```
┌──────────────────────────────────────────────────────────────┐
│ Header (sticky): logo · global search · theme · user menu     │
├────────────┬─────────────────────────────────────────────────┤
│ Left rail  │  Page header: eyebrow · title · primary action   │
│ Home       │  ─────────────────────────────────────────────  │
│ Publications│  Content (cards, tables, charts)                │
│ People     │                                                  │
│ Awards     │                                                  │
│ Reports    │                                                  │
│ Review (n) │                                                  │
│ Settings   │                                                  │
└────────────┴─────────────────────────────────────────────────┘
 Mobile: left rail becomes a bottom bar; header keeps logo + menu.
```

- **Header** copies the UniRise header look: translucent, blurred, logo at left. The marketing nav (Home / UniRise / Corporate / Blog / Contact) is replaced by the app search; the theme toggle and the primary button style are unchanged.
- **Left rail:** icons plus labels, active item uses `secondary` fill and a primary-coloured text. Items hidden per role (FRONTEND_SPEC §3). A badge shows pending review count.
- **Page header:** eyebrow in the UniRise violet style (for example "RESEARCH OFFICE"), title, short description, primary action on the right.
- **Tenant branding:** logo slot in the header and one accent colour override for `--primary`, validated for 4.5:1 contrast against white and against the dark background; if it fails, the default violet is kept.

---

## 5. Component inventory

Built on shadcn/ui primitives, restyled with §3.

| Component | Notes |
|---|---|
| `Button` | Variants: primary, secondary (outline), ghost, destructive; sizes sm/md/lg; loading state disables and shows a spinner |
| `Card` / `StatCard` | UniRise card style; `StatCard` shows value, label, trend; whole card is a link when it navigates |
| `DataTable` | Server-side pagination, sorting, filters bound to the URL; becomes a card list below 640 px |
| `VerificationBadge` | Verified / Suggested / Unverified with icon and text |
| `SourceChip` | Crossref, ORCID, OpenAlex, Manual, with link where allowed |
| `FormField` set | Text, select, combobox (author and researcher pickers), date, money; label, hint, error linked by `aria-describedby` |
| `OrcidInput`, `DoiInput` | Format validation, normalise on blur |
| `ChartCard` | Recharts wrapper with a "view as table" toggle |
| `EmptyState` | Icon, explanation, primary action |
| `ConfirmDialog` | Used for delete and merge |
| `Toast` | With undo, used by the review queue |
| `ReviewCard` | Suggestion card with Confirm / Not mine / Skip and keyboard shortcuts |
| `Skeleton` | One per list, card and chart |
| `ThemeToggle` | Light / dark / system, stored in localStorage (the only non-sensitive value stored there) |

---

## 6. State, data and routing

**Server state: TanStack Query.** Query keys are built in each feature's `api.ts` from a factory, for example `publications.list(filters)`. Mutations invalidate by key. Defaults: `staleTime` 30 s for lists, 5 min for reports, retries only for GET and network errors.

**URL is the state for lists.** Filters, sort, page and page size live in the query string so views can be shared and survive reload. Components read them with a typed `useListParams()` hook.

**Local UI state:** React state or small Zustand stores for the shell (rail collapsed, theme). No global store for server data.

**Forms:** React Hook Form + Zod. Schemas mirror server validation: ORCID `\d{4}-\d{4}-\d{4}-\d{3}[\dX]`, DOI `10.\d{4,9}/\S+`, end year ≥ start year, amount ≥ 0.

**Routing (React Router, lazy-loaded per feature):**

| Path | Screen | Roles |
|---|---|---|
| `/sign-in` | SSO sign-in | public |
| `/` | Dashboard | all |
| `/publications`, `/publications/:id`, `/publications/new` | list, detail, add | all (edit: admin, researcher for own) |
| `/people`, `/people/:id` | people and profiles (list: overview roles; profile: any signed-in user, server scopes it) | admin, executive, dean, HoD, viewer |
| `/organisation` | org tree (institution, school, department, group) | admin |
| `/units` | unit and executive dashboard (scope picker, comparison, scholars by stage) | admin, executive, dean, HoD, viewer |
| `/my-progress` | scholar milestones | scholar |
| `/mentees`, `/mentees/:id` | supervisor view, milestones and confidential meeting log | supervisor |
| `/grants`, `/grants/:id` | grant list and five-step wizard | all (edit: admin, researcher, supervisor; review: admin, HoD, dean) |
| `/seed-money`, `/seed-money/:id`, `/seed-money/report` | seed money proposals, form, report | all (same edit and review roles) |
| `/lookup` | find a researcher by employee ID, ORCID or Scopus ID | all (server scopes it) |
| `/awards`, `/awards/:id` | awards | all (server scopes by role) |
| `/review` | review queue | admin, researcher, supervisor |
| `/duplicates` | merge (planned) | admin |
| `/reports`, `/reports/:slug` | catalogue, viewer | admin, executive, dean, HoD, viewer |
| `/settings/*` | users, SSO, harvest, keys, audit | admin |
| `/platform/*` | tenant creation | platform admin only, separate entry |

Route guards redirect unauthorised users to a 403 page; the server stays the real authority.

---

## 7. API client and auth

- **Generated client:** produced from the springdoc OpenAPI document with `openapi-typescript` + `openapi-fetch` (or `orval` for TanStack hooks). CI regenerates and fails if the committed output differs, so types cannot drift.
- **Same origin:** the SPA is served by the ingress next to `/api`, so there is no CORS and cookies are first party.
- **Auth:** HttpOnly, Secure, SameSite cookies after SSO. No tokens in `localStorage`. State-changing requests carry a CSRF token from a cookie-to-header pair.
- **Interim (MVP, API key):** the key is entered once on a developer-only screen and held in memory, never persisted. This exists only until per-user auth ships (Phase 2).
- **Tenant:** never visible or sent by the client; the server derives it.
- **Error mapping:** one `HttpError` type. 401 → sign in with return path; 403 → access page; 404 → not found; 409 → "Already in your records" with link; 502 → "Couldn't reach Crossref, try again"; other 400 → field messages from client-side Zod, generic banner if the server rejects something the client allowed; 5xx/network → retry banner.
- **External text** (titles, venues from Crossref/ORCID) is always rendered as text, never HTML.

---

## 8. Performance

- Route-level code splitting; Recharts and the CSV import preview load only on the pages that use them.
- Budget: initial JS ≤ 200 KB gzip for sign-in and dashboard; check in CI with `size-limit`.
- Lists use server pagination (size ≤ 200); tables over 100 visible rows use row virtualisation.
- Fonts self-hosted and preloaded; images lazy-loaded; the hero background used on the dashboard is optional and compressed.
- Targets: LCP ≤ 2.5 s and INP ≤ 200 ms on a mid-range laptop over broadband. These are goals to measure, not results.

---

## 9. Accessibility and internationalisation

Follows FRONTEND_SPEC §6 (WCAG 2.1 AA). Specific to the UniRise look:
- The soft violet text (`violet-600` on near-white) passes 4.5:1; `violet-400` on the dark background must be checked per use. The token-check script in CI tests every text/background pair used.
- Translucent header and glow backgrounds never sit behind body text.
- Hover lifts are decoration only; every card action is also keyboard reachable.
- All strings go through `t()` from the start; English only at launch; dates and numbers use `Intl` with the tenant locale and currency.

---

## 10. Testing and quality gates

| Layer | Tool | What |
|---|---|---|
| Unit / component | Vitest + Testing Library | components, hooks, Zod schemas |
| API mocking | MSW | handlers generated from the OpenAPI document |
| Accessibility | axe-core in component tests and Playwright | zero serious violations |
| End to end | Playwright | the six flows in FRONTEND_SPEC §8 |
| Visual | Playwright screenshots on Storybook stories | card, button, badge, table in light and dark |
| Static | ESLint (with the feature-boundary rule), `tsc --strict`, Prettier | |
| Security | `npm audit`/Dependabot, secret scan, CSP check | no inline scripts |

CI order: lint → typecheck → unit → build → size check → e2e against a seeded stack → deploy to staging.

---

## 11. Build and deployment

- `pnpm build` produces static files in `apps/web/dist`, copied into the same container image as the service (or an nginx sidecar) and served at `/`, with `/api` proxied to the service.
- Cache: hashed assets `immutable`; `index.html` `no-cache`.
- Headers set at ingress: strict CSP (no inline scripts, fonts and images from self), HSTS, `X-Content-Type-Options`, `Referrer-Policy`, `frame-ancestors 'none'`.
- Environments mirror the backend: local (Vite dev server proxying `/api`), staging (synthetic data), production per region. Runtime config (support email, SSO entry URL) is loaded from `/config.json` so one build serves all environments.
- Optional public profile site (`apps/site`, Phase 3) is a separate deployable using the same tokens and `ui` package, server-rendered for indexing.

---

## 12. Differences from FRONTEND_SPEC and open items

**Added or changed relative to FRONTEND_SPEC.md**
- Tailwind + shadcn/ui chosen as the specific UI kit (spec said "e.g. Radix/shadcn").
- A shared design-token package and the UniRise visual language (§3).
- Feature-folder boundaries enforced by lint (§2).
- Tenant branding limited to logo and one accent colour (answers a §10 open question).
- Light and dark themes in scope from the first release.

**Still open**
1. Can the app use MentorEDGE's logo files and the Figtree font under their licences? (Figtree is open source under the SIL OFL; the logo is MentorEDGE's.)
2. SPA versus server-rendered for the first release (§1 keeps the SPA; confirm).
3. Is the app served under a MentorEDGE domain (for example `app.mentoredge.co.in`) or each university's domain? This affects cookies, CSP and branding.
4. Languages required by the pilot customer.
5. Whether researchers may edit publication metadata or only claim and reject.
6. Brand sign-off on the app-specific patterns in §4–§5, which extend the UniRise page rather than copy it.
