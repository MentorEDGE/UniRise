// Feature slice "access": sample-data (mock) and server (real) versions of its API calls. Keys must match between the two.
// Rules enforced here, in the mock, because hiding a button is only a convenience (the server decides):
//  - role grants: a research administrator grants anything except the platform operator role; an IT administrator manages access only;
//    a current HoD or Dean may create acting or delegated grants for their own role, inside their own scope, ending no later than their own grant.
//  - logs: research administrator and IT administrator only. Executives and Deans cannot read the log of their own drill-downs.
//  - guest: one shared item until the expiry date; every view is logged.
import { HttpError, http, qs } from "@/lib/http";
import { db, demoUsers } from "../store";
import { audit, grantIsActive, logAccess, mockUser, requireRole, subtree, today, wait } from "../helpers";
import type { AccessLogEntry, AuditEntry, ReportTable, Role, User } from "@/lib/types";
import type {
  AccessLogFilters, AccessReviewItem, AuditFilters, GrantInput, GrantRow, GuestView, LogExport, ReviewReason, SuggestedAction, UserRow, UserStatus,
} from "@/features/access/types";
import { GRANTABLE_ROLES, SCOPED_ROLES, roleLabel } from "@/features/access/types";

export type * from "@/features/access/types";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
const unitName = (id?: number) => (id === undefined ? undefined : db.orgUnits.find((x) => x.id === id)?.name);
const grants = () => db.roleGrants as GrantRow[];

const ACCESS_ROLES: Role[] = ["RESEARCH_ADMIN", "IT_ADMIN"];
const requireAccessAdmin = () => requireRole(mockUser(), ACCESS_ROLES);

/** The Dean or HoD's own direct grant: the ceiling for anything they hand on. Acting and delegated holders cannot hand on further. */
function ownGrant(u: User): GrantRow {
  const g = grants().find((x) => x.kind === "direct" && x.role === u.role && grantIsActive(x) && ((u.researcherId !== undefined && x.researcherId === u.researcherId) || x.holder === u.name));
  if (!g) throw new HttpError(403);
  return g;
}

/** Whether the user may manage (end or renew) this grant, and the latest end date they may set. */
function manageable(u: User, g: GrantRow): { latest?: string } {
  if (u.role === "RESEARCH_ADMIN") return {};
  if (u.role === "IT_ADMIN") return { latest: undefined };
  if (u.role === "HOD" || u.role === "DEAN") {
    const own = ownGrant(u);
    const scope = own.scopeUnitId ?? u.scopeUnitId;
    if (g.kind === "direct" || g.role !== u.role || g.scopeUnitId === undefined || scope === undefined || !subtree(scope).has(g.scopeUnitId)) throw new HttpError(403);
    return { latest: own.validTo };
  }
  throw new HttpError(403);
}

function validateInput(g: GrantInput) {
  if (!g.holder?.trim()) throw new HttpError(400);
  if (!GRANTABLE_ROLES.includes(g.role)) throw new HttpError(400);
  if (!DATE_RE.test(g.validFrom) || (g.validTo !== undefined && !DATE_RE.test(g.validTo))) throw new HttpError(400);
  if (g.validTo && g.validTo < g.validFrom) throw new HttpError(400);
  if ((g.kind === "acting" || g.kind === "delegated") && !g.validTo) throw new HttpError(400); // acting and delegated roles must expire
  if (SCOPED_ROLES.includes(g.role) && !(g.scopeUnitId !== undefined && db.orgUnits.some((x) => x.id === g.scopeUnitId))) throw new HttpError(400);
}

const describe = (g: GrantRow) =>
  `${g.holder} as ${roleLabel[g.role]}${g.scopeUnitId !== undefined ? `, ${unitName(g.scopeUnitId) ?? "unit " + g.scopeUnitId}` : ""} (${g.kind}), ${g.validFrom} to ${g.validTo ?? "no end date"}`;

/* ------------------------------ guest helpers ------------------------------ */
/** The grant behind a guest account (matched on the name in the holder text; a server links these by user id). */
function guestGrant(u: User): GrantRow | undefined {
  const key = u.name.split("(")[0].trim().toLowerCase();
  return grants().find((g) => g.role === "GUEST" && key && g.holder.toLowerCase().includes(key));
}
/** The day a guest's access really ends: the earlier of the account expiry and the end of its grant (an ended grant ends access at once). */
function guestEnds(u: User): string {
  const g = guestGrant(u);
  const ends = [u.expiresOn, g?.validTo].filter((d): d is string => !!d).sort();
  return ends[0] ?? "";
}

function sharedReport(slug: string): ReportTable | undefined {
  // Only the one published item is built here; a guest never goes through the scoped research calls.
  if (slug !== "pub-university") return undefined;
  const m = new Map<number, number>();
  for (const p of db.publications) if (p.state === "verified") m.set(p.year, (m.get(p.year) ?? 0) + 1);
  return { columns: ["Year", "Publications"], rows: [...m].sort((a, b) => b[1] - a[1] || a[0] - b[0]).map(([y, n]) => [String(y), n]) };
}

/* ------------------------------ users list helpers ------------------------------ */
const matchesGrant = (u: User, g: GrantRow) =>
  g.role === u.role && ((u.researcherId !== undefined && g.researcherId === u.researcherId) || g.holder === u.name);

function statusOf(ends: string | undefined, on: string): UserStatus {
  if (!ends) return "active";
  if (ends < on) return "expired";
  return daysBetween(on, ends) <= 30 ? "expiring" : "active";
}

const mock = {
  /* ------------------------------ role grants ------------------------------ */
  roleGrants: (): Promise<GrantRow[]> => {
    const u = requireRole(mockUser(), ["RESEARCH_ADMIN", "IT_ADMIN", "HOD", "DEAN"]);
    let rows = [...grants()];
    if (u.role === "HOD" || u.role === "DEAN") {
      const units = subtree(u.scopeUnitId!);
      rows = rows.filter((g) => g.scopeUnitId !== undefined && units.has(g.scopeUnitId));
    }
    return wait(structuredClone(rows.sort((a, b) => b.validFrom.localeCompare(a.validFrom) || b.id - a.id)));
  },

  grantRole: (input: GrantInput): Promise<GrantRow> => {
    const u = requireRole(mockUser(), ["RESEARCH_ADMIN", "IT_ADMIN", "HOD", "DEAN"]);
    if (input.role === "PLATFORM_ADMIN") throw new HttpError(403);
    if (u.role === "IT_ADMIN" && input.role !== "IT_ADMIN") throw new HttpError(403); // IT manages access, it does not hand out research roles
    let latest: string | undefined;
    let scope: number | undefined;
    if (u.role === "HOD" || u.role === "DEAN") {
      if ((input.kind !== "acting" && input.kind !== "delegated") || input.role !== u.role) throw new HttpError(403);
      const own = ownGrant(u);
      scope = own.scopeUnitId ?? u.scopeUnitId;
      latest = own.validTo;
    }
    validateInput(input);
    if (scope !== undefined && !(input.scopeUnitId !== undefined && subtree(scope).has(input.scopeUnitId))) throw new HttpError(403);
    if (latest && (!input.validTo || input.validTo > latest)) throw new HttpError(403); // cannot outlast the grantor's own grant
    const n: GrantRow = {
      id: db.nextId.grantRole++, holder: input.holder.trim(), researcherId: input.researcherId, role: input.role, scopeUnitId: input.scopeUnitId,
      validFrom: input.validFrom, validTo: input.validTo || undefined, grantedBy: u.name, kind: input.kind, note: input.note?.trim() || undefined,
    };
    grants().unshift(n);
    audit(n.kind === "direct" ? "Granted role" : n.kind === "acting" ? "Granted acting role" : "Granted delegated role", "role-grant", n.id, describe(n));
    return wait(structuredClone(n));
  },

  endGrant: (id: number): Promise<GrantRow> => {
    const u = requireRole(mockUser(), ["RESEARCH_ADMIN", "IT_ADMIN", "HOD", "DEAN"]);
    const g = grants().find((x) => x.id === id);
    if (!g) throw new HttpError(404);
    manageable(u, g);
    const on = today();
    if (g.validTo && g.validTo < on) {
      if (g.reviewedOn) throw new HttpError(409);
      g.reviewedOn = on; // already ended: the review just confirms it
      audit("Confirmed access ended", "role-grant", g.id, describe(g));
      return wait(structuredClone(g));
    }
    if (g.role === "RESEARCH_ADMIN" && grantIsActive(g) && !grants().some((x) => x.id !== g.id && x.role === "RESEARCH_ADMIN" && grantIsActive(x))) throw new HttpError(409); // never lock the tenant out
    if (g.validFrom > on) {
      grants().splice(grants().indexOf(g), 1); // not started yet: cancelling removes it
      audit("Cancelled role grant", "role-grant", g.id, describe(g));
      return wait(structuredClone(g));
    }
    g.validTo = addDays(on, -1); // ends at once, since a grant counts through its last day
    g.validFrom = g.validFrom < g.validTo ? g.validFrom : g.validTo;
    g.reviewedOn = on;
    audit("Ended role grant", "role-grant", g.id, describe(g));
    return wait(structuredClone(g));
  },

  renewGrant: (req: { id: number; validTo: string }): Promise<GrantRow> => {
    const u = requireRole(mockUser(), ["RESEARCH_ADMIN", "IT_ADMIN", "HOD", "DEAN"]);
    const g = grants().find((x) => x.id === req.id);
    if (!g) throw new HttpError(404);
    if (u.role === "IT_ADMIN" && g.role !== "IT_ADMIN") throw new HttpError(403);
    const { latest } = manageable(u, g);
    if (!DATE_RE.test(req.validTo)) throw new HttpError(400);
    const on = today();
    const floor = g.validTo && g.validTo > on ? g.validTo : on;
    if (req.validTo <= floor) throw new HttpError(400); // renewing extends; use End to shorten
    if (latest && req.validTo > latest) throw new HttpError(403);
    const before = g.validTo ?? "no end date";
    g.validTo = req.validTo;
    g.reviewedOn = on;
    audit("Renewed role grant", "role-grant", g.id, `${describe(g)} (was ${before})`);
    return wait(structuredClone(g));
  },

  /* ------------------------------ access review ------------------------------ */
  accessReview: (): Promise<AccessReviewItem[]> => {
    requireAccessAdmin();
    const on = today();
    const items: AccessReviewItem[] = [];
    for (const g of grants()) {
      let reason: ReviewReason | undefined;
      let suggested: SuggestedAction = "renew";
      let message = "";
      let daysLeft: number | undefined;
      if (g.validTo && g.validTo < on) {
        if (g.reviewedOn) continue;
        reason = "expired"; suggested = "confirm-ended"; message = `Ended on ${g.validTo}. Confirm it should stay ended, or renew it.`;
      } else if (g.validTo && daysBetween(on, g.validTo) <= 30) {
        daysLeft = daysBetween(on, g.validTo);
        reason = "ends-soon"; suggested = "renew"; message = `Ends in ${daysLeft} day${daysLeft === 1 ? "" : "s"}. Renew it if the person still needs it.`;
      } else if (!g.validTo && daysBetween(g.validFrom, on) > 365) {
        reason = "no-end-date"; suggested = "set-end-date"; message = "No end date for over a year. If the HR import is stale this person may still hold access; confirm the role and set an end date.";
      }
      if (reason) items.push({ grant: structuredClone(g), reason, daysLeft, suggested, message });
    }
    const rank: Record<ReviewReason, number> = { expired: 0, "ends-soon": 1, "no-end-date": 2 };
    return wait(items.sort((a, b) => rank[a.reason] - rank[b.reason] || (a.daysLeft ?? 0) - (b.daysLeft ?? 0)));
  },

  /* ------------------------------ guest ------------------------------ */
  guestView: (): Promise<GuestView> => {
    const u = requireRole(mockUser(), ["GUEST"]);
    const item = u.guestItem;
    const ends = guestEnds(u);
    const expired = !item || !ends || ends < today();
    logAccess({ action: "guest-view", targetName: item?.label, note: expired ? "Refused: access has expired" : "Viewed the shared item" });
    if (expired) throw new HttpError(403);
    const view: GuestView = { item: item!, expiresOn: ends };
    if (item!.kind === "report") view.report = sharedReport(item!.ref);
    else {
      const p = db.publications.find((x) => x.id === Number(item!.ref) && x.state === "verified");
      if (p) view.publication = { title: p.title, venue: p.venue, year: p.year, doi: p.doi };
    }
    return wait(view);
  },

  /* ------------------------------ users ------------------------------ */
  usersList: (): Promise<UserRow[]> => {
    requireAccessAdmin();
    const on = today();
    const used = new Set<number>();
    const rows: UserRow[] = Object.values(demoUsers).map((u) => {
      const account = u.role === "GUEST" ? "guest" : u.role === "PLATFORM_ADMIN" ? "platform" : "staff";
      if (u.role === "GUEST") {
        const g = guestGrant(u);
        if (g) used.add(g.id);
        const ends = guestEnds(u);
        return { id: u.id, name: u.name, email: u.email, role: u.role, account, kind: "direct", status: statusOf(ends, on), expires: ends || undefined, source: "guest-share" };
      }
      if (u.role === "PLATFORM_ADMIN") return { id: u.id, name: u.name, email: u.email, role: u.role, account, kind: "direct", status: "active", source: "platform" };
      const own = grants().filter((g) => matchesGrant(u, g)).sort((a, b) => b.validFrom.localeCompare(a.validFrom));
      own.forEach((g) => used.add(g.id));
      const g = own.find((x) => grantIsActive(x, on)) ?? own[0];
      return {
        id: u.id, name: u.name.replace(/ \(acting HoD\)$/, ""), email: u.email, role: u.role, scopeName: unitName(u.scopeUnitId), account,
        kind: g?.kind ?? "direct", status: g ? statusOf(g.validTo, on) : "active", expires: g?.validTo, source: g ? "role-grant" : "hr-import",
      };
    });
    // People added through a role grant who are not one of the sample sign-ins.
    for (const g of grants()) {
      if (used.has(g.id)) continue;
      rows.push({
        id: 10_000 + g.id, name: g.holder, email: "", role: g.role, scopeName: unitName(g.scopeUnitId), account: g.role === "GUEST" ? "guest" : "staff",
        kind: g.kind, status: grantIsActive(g, on) ? statusOf(g.validTo, on) : g.validFrom > on ? "active" : "expired", expires: g.validTo, source: "role-grant",
      });
    }
    return wait(rows);
  },

  /* ------------------------------ logs ------------------------------ */
  auditLog: (f: AuditFilters = {}): Promise<AuditEntry[]> => {
    requireAccessAdmin();
    const q = f.q?.trim().toLowerCase();
    const rows = db.auditLog.filter((e) =>
      (!q || `${e.actor} ${e.action} ${e.entity} ${e.entityId ?? ""} ${e.detail ?? ""}`.toLowerCase().includes(q)) &&
      (!f.entity || e.entity === f.entity) && (!f.from || e.at.slice(0, 10) >= f.from) && (!f.to || e.at.slice(0, 10) <= f.to));
    return wait(structuredClone(rows.sort((a, b) => b.at.localeCompare(a.at) || b.id - a.id)));
  },

  accessLog: (f: AccessLogFilters = {}): Promise<AccessLogEntry[]> => {
    requireAccessAdmin(); // Executives and Deans cannot read the log of their own drill-downs
    const rows = db.accessLog.filter((e) => (!f.action || e.action === f.action) && (!f.from || e.at.slice(0, 10) >= f.from) && (!f.to || e.at.slice(0, 10) <= f.to));
    return wait(structuredClone(rows.sort((a, b) => b.at.localeCompare(a.at) || b.id - a.id)));
  },

  /** Records that a log was exported: one audit entry and one access-log entry. */
  logExported: (x: LogExport): Promise<void> => {
    const u = requireAccessAdmin();
    audit(`Exported ${x.log} log`, "log-export", x.log, `${x.rows} row${x.rows === 1 ? "" : "s"}`);
    logAccess({ action: "export", note: `${u.name} exported the ${x.log} log (${x.rows} row${x.rows === 1 ? "" : "s"})` });
    return wait(undefined, 60);
  },
};

const body = (b: unknown) => ({ method: "POST", body: JSON.stringify(b) });

// Planned endpoints (TRD §5). The server applies the same rules as the sample-data versions above.
export const real: typeof mock = {
  roleGrants: () => http("/role-grants"),
  grantRole: (input) => http("/role-grants", body(input)),
  endGrant: (id) => http(`/role-grants/${id}/end`, { method: "POST" }),
  renewGrant: ({ id, validTo }) => http(`/role-grants/${id}/renew`, body({ validTo })),
  accessReview: () => http("/access-review"),
  guestView: () => http("/guest/view"),
  usersList: () => http("/users"),
  auditLog: (f = {}) => http(`/audit-log${qs({ ...f })}`),
  accessLog: (f = {}) => http(`/access-log${qs({ ...f })}`),
  logExported: (x) => http("/logs/exports", body(x)),
};

export { mock };
