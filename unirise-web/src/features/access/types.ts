import type { AccessLogEntry, ReportTable, Role, RoleGrant } from "@/lib/types";

/** A grant as the access screens see it. reviewedOn is set when the access review has dealt with it. */
export type GrantRow = RoleGrant & { reviewedOn?: string };

export type GrantKind = RoleGrant["kind"];

export interface GrantInput {
  holder: string;
  researcherId?: number;
  role: Role;
  scopeUnitId?: number;
  validFrom: string;
  validTo?: string;
  kind: GrantKind;
  note?: string;
}

export type ReviewReason = "expired" | "ends-soon" | "no-end-date";
export type SuggestedAction = "confirm-ended" | "renew" | "set-end-date";
export interface AccessReviewItem { grant: GrantRow; reason: ReviewReason; daysLeft?: number; suggested: SuggestedAction; message: string }

export type AccountType = "staff" | "guest" | "platform";
export type UserStatus = "active" | "expiring" | "expired";
export interface UserRow {
  id: number;
  name: string;
  email: string;
  role: Role;
  scopeName?: string;
  account: AccountType;
  kind: GrantKind;
  status: UserStatus;
  /** Date the access ends, when it ends. */
  expires?: string;
  /** Where the role comes from: a role grant, the HR import, a shared item (guest) or the platform operator. */
  source: "role-grant" | "hr-import" | "guest-share" | "platform";
}

export interface GuestView {
  item: { kind: "report" | "publication"; ref: string; label: string };
  expiresOn: string;
  /** The shared report, when the item is a report the sample data can produce. */
  report?: ReportTable;
  /** The shared publication, when the item is a publication. */
  publication?: { title: string; venue: string; year: number; doi?: string };
}

export interface AuditFilters { q?: string; entity?: string; from?: string; to?: string }
export interface AccessLogFilters { action?: AccessLogEntry["action"]; from?: string; to?: string }
export interface LogExport { log: "audit" | "access"; rows: number }

export const roleLabel: Record<Role, string> = {
  RESEARCH_ADMIN: "Research administrator", EXECUTIVE: "Executive", DEAN: "Dean", HOD: "Head of department", SUPERVISOR: "Supervisor",
  RESEARCHER: "Researcher", VIEWER: "Viewer (read-only)", IT_ADMIN: "IT administrator", GUEST: "Guest", PLATFORM_ADMIN: "Platform operator",
};
export const kindLabel: Record<GrantKind, string> = { direct: "Direct", acting: "Acting", delegated: "Delegated" };
/** Roles that need an org unit to mean anything. */
export const SCOPED_ROLES: Role[] = ["EXECUTIVE", "DEAN", "HOD"];
/** Roles a research administrator may grant. Platform operators are created by the platform, not by a tenant. */
export const GRANTABLE_ROLES: Role[] = ["RESEARCH_ADMIN", "EXECUTIVE", "DEAN", "HOD", "SUPERVISOR", "RESEARCHER", "VIEWER", "IT_ADMIN", "GUEST"];

export type GrantStatus = "scheduled" | "active" | "ended";
export function grantStatus(g: { validFrom: string; validTo?: string }, on: string): GrantStatus {
  if (g.validFrom > on) return "scheduled";
  return g.validTo && g.validTo < on ? "ended" : "active";
}
