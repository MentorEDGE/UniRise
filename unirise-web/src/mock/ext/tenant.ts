// Feature slice "tenant": sample-data (mock) and server (real) versions of its API calls. Keys must match between the two.
import { HttpError, http, qs } from "@/lib/http";
import { db, demoUsers } from "@/mock/store";
import { SESSION_KEY, audit, logAccess, mockUser, nowIso, requireRole, today, wait } from "@/mock/helpers";
import { CURRENCIES, HEX_RE, accentHasContrast } from "@/lib/tenantFormat";
import { WEBHOOK_EVENTS } from "@/lib/types";
import type { ApiKeyRow, ClassificationScheme, PublicProfile, Role, Tenant, TenantSettings, TenantStatus, User, Webhook } from "@/lib/types";

/* --------------------------------- types --------------------------------- */
export type SsoSettings = TenantSettings["sso"];
export type SettingsPatch = Partial<Omit<TenantSettings, "sso" | "name">>;
export interface NewKey { key: string; row: ApiKeyRow }
export interface SsoTestResult { ok: boolean; message: string; checkedAt: string }
export interface WebhookTestResult { ok: boolean; status: number; sentAt: string; message: string }
export interface TenantExport {
  tenant: Tenant; exportedAt: string; exportedBy: string; format: "json-summary";
  counts: Record<string, number>; note: string;
}
export interface DeletionRecord { tenantId: number; tenantName: string; statusAtDeletion: TenantStatus; deletedAt: string; deletedBy: string; removed: string[]; sample: true; note: string }
export interface SupportGrant { tenantId: number; tenantName: string; grantedAt: string; expiresAt: string; reason: string }
export interface SignInLink { link: string; expiresInMinutes: number }

export const LINK_MINUTES = 15;
export const SUPPORT_MAX_MINUTES = 480;
export const TENANT_TRANSITIONS: Record<TenantStatus, TenantStatus[]> = {
  sandbox: ["pilot", "closed"],
  pilot: ["active", "suspended", "closed"],
  active: ["suspended", "closed"],
  suspended: ["active", "closed"],
  closed: [],
};

/* -------------------------------- helpers -------------------------------- */
const ALL_ROLES: Role[] = ["RESEARCH_ADMIN", "EXECUTIVE", "DEAN", "HOD", "SUPERVISOR", "RESEARCHER", "VIEWER", "IT_ADMIN", "GUEST", "PLATFORM_ADMIN"];
const ACCESS_ADMINS: Role[] = ["RESEARCH_ADMIN", "IT_ADMIN"];
const clone = <T,>(x: T): T => structuredClone(x);
const signedIn = () => requireRole(mockUser(), ALL_ROLES);
const admin = () => requireRole(mockUser(), ["RESEARCH_ADMIN"]);
const accessAdmin = () => requireRole(mockUser(), ACCESS_ADMINS);
const platform = () => requireRole(mockUser(), ["PLATFORM_ADMIN"]);
const bad = (reason: string) => new HttpError(400, reason);

function randomHex(bytes: number) {
  const a = new Uint8Array(bytes);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(a);
  else for (let i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 256);
  return [...a].map((b) => b.toString(16).padStart(2, "0")).join("");
}
/** A key is shown once. Only its first 8 characters are kept, so the plaintext is never stored, audited or logged. */
const newKey = () => { const key = `rms_${randomHex(20)}`; return { key, prefix: key.slice(0, 8) }; };

const isDate = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

/** Webhooks must be https to a public host with no credentials in the URL. */
function checkWebhookUrl(raw: string) {
  let u: URL;
  try { u = new URL(raw); } catch { throw bad("url"); }
  const host = u.hostname.toLowerCase();
  const local = host === "localhost" || host.endsWith(".local") || /^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host) || host === "[::1]";
  if (u.protocol !== "https:" || u.username || u.password || local) throw bad("url");
}

const sorted = (xs: ClassificationScheme[]) => clone(xs).sort((a, b) => a.name.localeCompare(b.name));

/* ------------------------------ sign-in links ----------------------------- */
// Sandbox-tenant only (PRD R3). Single use, 15 minutes. Held in memory here; the server stores a hash.
const links = new Map<string, { roleKey: string; expiresAt: number; used: boolean }>();

/* ---------------------------------- mock ---------------------------------- */
export const mock = {
  /* Tenant settings (R34) */
  settings: (): Promise<TenantSettings> => { signedIn(); return wait(clone(db.settings), 120); },
  saveSettings: (patch: SettingsPatch): Promise<TenantSettings> => {
    admin();
    const next: SettingsPatch = {};
    if (patch.logoText !== undefined) {
      const t = patch.logoText.trim();
      if (t.length < 1 || t.length > 4) throw bad("logoText");
      next.logoText = t;
    }
    if (patch.accent !== undefined) {
      if (!HEX_RE.test(patch.accent)) throw bad("accent");
      if (!accentHasContrast(patch.accent)) throw bad("contrast");
      next.accent = patch.accent.toLowerCase();
    }
    if (patch.currency !== undefined) { if (!CURRENCIES.includes(patch.currency)) throw bad("currency"); next.currency = patch.currency; }
    if (patch.fiscalYearStartMonth !== undefined) {
      if (!Number.isInteger(patch.fiscalYearStartMonth) || patch.fiscalYearStartMonth < 1 || patch.fiscalYearStartMonth > 12) throw bad("fiscalYearStartMonth");
      next.fiscalYearStartMonth = patch.fiscalYearStartMonth;
    }
    if (patch.locale !== undefined) { if (!/^[a-z]{2,3}(-[A-Z]{2})?$/.test(patch.locale)) throw bad("locale"); next.locale = patch.locale; }
    if (patch.publicProfilesEnabled !== undefined) next.publicProfilesEnabled = !!patch.publicProfilesEnabled;
    if (patch.hodValidation !== undefined) next.hodValidation = !!patch.hodValidation;
    if (patch.escalationDays !== undefined) {
      if (!Number.isInteger(patch.escalationDays) || patch.escalationDays < 7 || patch.escalationDays > 120) throw bad("escalationDays");
      next.escalationDays = patch.escalationDays;
    }
    Object.assign(db.settings, next);
    audit("settings.update", "tenant-settings", db.settings.name, Object.keys(next).join(", "));
    return wait(clone(db.settings));
  },

  /* Single sign-on (R4) */
  saveSso: (patch: Partial<SsoSettings>): Promise<TenantSettings> => {
    accessAdmin();
    const cur = db.settings.sso;
    const next: SsoSettings = { ...cur, ...patch };
    if (!["google", "microsoft", "none"].includes(next.provider)) throw bad("provider");
    next.clientId = next.clientId.trim();
    next.domain = next.domain.trim().toLowerCase();
    if (next.provider !== "none") {
      if (!next.clientId || next.clientId.length > 200) throw bad("clientId");
      if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(next.domain)) throw bad("domain");
    }
    // Any change needs a fresh test before it counts as verified.
    const changed = next.provider !== cur.provider || next.clientId !== cur.clientId || next.domain !== cur.domain;
    next.status = next.provider === "none" ? "not-configured" : changed ? "configured" : cur.status;
    db.settings.sso = next;
    audit("sso.update", "tenant-settings", db.settings.name, `${next.provider}, ${next.domain || "no domain"}`);
    return wait(clone(db.settings));
  },
  testSso: (): Promise<SsoTestResult> => {
    accessAdmin();
    const s = db.settings.sso;
    const checkedAt = nowIso();
    if (s.provider === "none" || !s.clientId || !s.domain) {
      return wait({ ok: false, message: "Single sign-on is not set up yet. Choose a provider, then enter the client ID and domain.", checkedAt });
    }
    s.status = "verified";
    audit("sso.test", "tenant-settings", db.settings.name, "sample test passed");
    return wait({ ok: true, message: "Sample result: the provider answered and the domain matched. No real sign-in was attempted.", checkedAt });
  },

  /* Classification lists (R34). Terms are ended, never deleted, because lists change over time. */
  classification: (): Promise<ClassificationScheme[]> => { signedIn(); return wait(sorted(db.classification), 120); },
  saveClassificationScheme: (s: { id?: number; code: string; name: string }): Promise<ClassificationScheme> => {
    admin();
    const code = s.code.trim().toLowerCase(), name = s.name.trim();
    if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(code)) throw bad("code");
    if (name.length < 2 || name.length > 80) throw bad("name");
    if (db.classification.some((x) => x.code === code && x.id !== s.id)) throw new HttpError(409, "code");
    if (s.id !== undefined) {
      const cur = db.classification.find((x) => x.id === s.id);
      if (!cur) throw new HttpError(404);
      cur.code = code; cur.name = name;
      audit("classification.update", "classification-scheme", cur.id, name);
      return wait(clone(cur));
    }
    const n: ClassificationScheme = { id: db.nextId.scheme++, code, name, terms: [] };
    db.classification.push(n);
    audit("classification.create", "classification-scheme", n.id, name);
    return wait(clone(n));
  },
  addTerm: (t: { schemeId: number; code: string; label: string; validFrom: string }): Promise<ClassificationScheme> => {
    admin();
    const scheme = db.classification.find((x) => x.id === t.schemeId);
    if (!scheme) throw new HttpError(404);
    const code = t.code.trim().toUpperCase(), label = t.label.trim();
    if (!/^[A-Z0-9][A-Z0-9_-]{0,30}$/.test(code)) throw bad("code");
    if (label.length < 1 || label.length > 80) throw bad("label");
    if (!isDate(t.validFrom)) throw bad("validFrom");
    if (scheme.terms.some((x) => x.code === code)) throw new HttpError(409, "code");
    scheme.terms.push({ code, label, validFrom: t.validFrom });
    audit("classification.term-add", "classification-scheme", scheme.id, `${code} from ${t.validFrom}`);
    return wait(clone(scheme));
  },
  endTerm: (t: { schemeId: number; code: string; validTo: string }): Promise<ClassificationScheme> => {
    admin();
    const scheme = db.classification.find((x) => x.id === t.schemeId);
    const term = scheme?.terms.find((x) => x.code === t.code);
    if (!scheme || !term) throw new HttpError(404);
    if (term.validTo) throw new HttpError(409, "ended");
    if (!isDate(t.validTo) || t.validTo < term.validFrom) throw bad("validTo");
    term.validTo = t.validTo;
    audit("classification.term-end", "classification-scheme", scheme.id, `${term.code} until ${t.validTo}`);
    return wait(clone(scheme));
  },

  /* Integrations (R36). RESEARCH_ADMIN and IT_ADMIN only. */
  apiKeys: (): Promise<ApiKeyRow[]> => { accessAdmin(); return wait(clone(db.apiKeys).sort((a, b) => b.id - a.id), 120); },
  createApiKey: (name: string): Promise<NewKey> => {
    accessAdmin();
    const n = name.trim();
    if (n.length < 2 || n.length > 60) throw bad("name");
    const { key, prefix } = newKey();
    const row: ApiKeyRow = { id: db.nextId.apiKey++, name: n, prefix, createdOn: today() };
    db.apiKeys.push(row);
    audit("api-key.create", "api-key", row.id, `${n} (${prefix}…)`);
    return wait({ key, row: clone(row) });
  },
  rotateApiKey: (id: number): Promise<NewKey> => {
    accessAdmin();
    const old = db.apiKeys.find((k) => k.id === id);
    if (!old) throw new HttpError(404);
    if (old.revokedOn) throw new HttpError(409, "revoked");
    old.revokedOn = today();
    const { key, prefix } = newKey();
    const row: ApiKeyRow = { id: db.nextId.apiKey++, name: old.name, prefix, createdOn: today() };
    db.apiKeys.push(row);
    audit("api-key.rotate", "api-key", row.id, `${old.name}: ${old.prefix}… replaced by ${prefix}…`);
    return wait({ key, row: clone(row) });
  },
  revokeApiKey: (id: number): Promise<void> => {
    accessAdmin();
    const k = db.apiKeys.find((x) => x.id === id);
    if (!k) throw new HttpError(404);
    if (k.revokedOn) throw new HttpError(409, "revoked");
    k.revokedOn = today();
    audit("api-key.revoke", "api-key", k.id, `${k.name} (${k.prefix}…)`);
    return wait(undefined, 120);
  },
  webhooks: (): Promise<Webhook[]> => { accessAdmin(); return wait(clone(db.webhooks), 120); },
  saveWebhook: (w: { id?: number; url: string; events: string[]; active: boolean }): Promise<Webhook> => {
    accessAdmin();
    const url = w.url.trim();
    checkWebhookUrl(url);
    const events = [...new Set(w.events)];
    if (events.length === 0 || events.some((e) => !(WEBHOOK_EVENTS as readonly string[]).includes(e))) throw bad("events");
    if (w.id !== undefined) {
      const cur = db.webhooks.find((x) => x.id === w.id);
      if (!cur) throw new HttpError(404);
      Object.assign(cur, { url, events, active: !!w.active });
      audit("webhook.update", "webhook", cur.id, url);
      return wait(clone(cur));
    }
    const n: Webhook = { id: db.nextId.webhook++, url, events, active: !!w.active };
    db.webhooks.push(n);
    audit("webhook.create", "webhook", n.id, url);
    return wait(clone(n));
  },
  deleteWebhook: (id: number): Promise<void> => {
    accessAdmin();
    const w = db.webhooks.find((x) => x.id === id);
    if (!w) throw new HttpError(404);
    db.webhooks = db.webhooks.filter((x) => x.id !== id);
    audit("webhook.delete", "webhook", id, w.url);
    return wait(undefined, 120);
  },
  testWebhook: (id: number): Promise<WebhookTestResult> => {
    accessAdmin();
    const w = db.webhooks.find((x) => x.id === id);
    if (!w) throw new HttpError(404);
    audit("webhook.test", "webhook", id, w.url);
    return wait({ ok: true, status: 200, sentAt: nowIso(), message: "Sample result: no request left this browser. A real test sends a signed ping to your URL." });
  },

  /* Platform console (R2, R32, R33, R35). PLATFORM_ADMIN only. */
  tenants: (): Promise<Tenant[]> => { platform(); return wait(clone(db.tenants).sort((a, b) => a.id - b.id), 160); },
  createTenant: (t: { name: string; status: "sandbox" | "pilot" }): Promise<{ tenant: Tenant; apiKey: string }> => {
    platform();
    const name = t.name.trim();
    if (name.length < 3 || name.length > 80) throw bad("name");
    if (t.status !== "sandbox" && t.status !== "pilot") throw bad("status");
    if (db.tenants.some((x) => x.name.toLowerCase() === name.toLowerCase())) throw new HttpError(409, "name");
    const tenant: Tenant = { id: db.nextId.tenant++, name, status: t.status, plan: t.status === "pilot" ? "Pilot" : "Sandbox", createdOn: today(), activeResearchers: [] };
    db.tenants.push(tenant);
    const { key, prefix } = newKey();
    audit("tenant.create", "tenant", tenant.id, `${name} (${t.status}); first API key ${prefix}…`);
    return wait({ tenant: clone(tenant), apiKey: key });
  },
  setTenantStatus: (a: { id: number; status: TenantStatus }): Promise<Tenant> => {
    platform();
    const t = db.tenants.find((x) => x.id === a.id);
    if (!t) throw new HttpError(404);
    if (!TENANT_TRANSITIONS[t.status].includes(a.status)) throw new HttpError(409, "transition");
    const from = t.status;
    t.status = a.status;
    // Pilot to active changes the label and plan only; the data stays where it is (R32).
    if (from === "pilot" && a.status === "active") t.plan = "Standard";
    audit("tenant.status", "tenant", t.id, `${t.name}: ${from} to ${a.status}`);
    return wait(clone(t));
  },
  exportTenant: (id: number): Promise<TenantExport> => {
    const u = platform();
    const t = db.tenants.find((x) => x.id === id);
    if (!t) throw new HttpError(404);
    // Only the first tenant holds the sample records; the others are empty shells in this demo.
    const holds = t.id === 1;
    const counts = holds
      ? { orgUnits: db.orgUnits.length, people: db.researchers.length, publications: db.publications.length, grants: db.grants.length, seedMoneyProposals: db.seedProposals.length, awards: db.awards.length, milestones: db.milestones.length }
      : { orgUnits: 0, people: 0, publications: 0, grants: 0, seedMoneyProposals: 0, awards: 0, milestones: 0 };
    audit("tenant.export", "tenant", t.id, t.name);
    logAccess({ action: "export", targetName: t.name, targetId: t.id, note: "Full tenant export (platform console)" });
    return wait({
      tenant: clone(t), exportedAt: nowIso(), exportedBy: u.email, format: "json-summary", counts,
      note: "Sample export: a summary of record counts. A real export also contains every record, in JSON and CSV.",
    });
  },
  deleteTenant: (a: { id: number; confirmName: string }): Promise<DeletionRecord> => {
    const u = platform();
    const t = db.tenants.find((x) => x.id === a.id);
    if (!t) throw new HttpError(404);
    if (a.confirmName !== t.name) throw bad("confirmName");
    // Contract end, not a shortcut: a live tenant must be suspended or closed first.
    if (t.status === "active") throw new HttpError(409, "active");
    db.tenants = db.tenants.filter((x) => x.id !== t.id);
    const record: DeletionRecord = {
      tenantId: t.id, tenantName: t.name, statusAtDeletion: t.status, deletedAt: nowIso(), deletedBy: u.email, sample: true,
      removed: ["Tenant record", "Users and role grants", "Research records", "API keys and webhooks", "Settings"],
      note: "Sample record: nothing stored was removed in this demo. A real deletion also covers backups according to the contract.",
    };
    audit("tenant.delete", "tenant", t.id, `${t.name} (was ${t.status})`);
    return wait(record);
  },
  supportAccess: (a: { id: number; minutes: number; reason: string }): Promise<SupportGrant> => {
    platform();
    const t = db.tenants.find((x) => x.id === a.id);
    if (!t) throw new HttpError(404);
    const reason = (a.reason ?? "").trim();
    if (reason.length < 10 || reason.length > 300) throw bad("reason");
    if (!Number.isInteger(a.minutes) || a.minutes < 15 || a.minutes > SUPPORT_MAX_MINUTES) throw bad("minutes");
    const now = new Date();
    const expires = new Date(now.getTime() + a.minutes * 60_000);
    const grant: SupportGrant = { tenantId: t.id, tenantName: t.name, grantedAt: now.toISOString().slice(0, 19), expiresAt: expires.toISOString().slice(0, 19), reason };
    logAccess({ action: "support-access", targetName: t.name, targetId: t.id, note: `Break-glass: ${reason}. Expires ${grant.expiresAt}.` });
    audit("tenant.support-access", "tenant", t.id, `${t.name}, ${a.minutes} minutes`);
    return wait(grant);
  },

  /* Public profiles (R22). No sign-in needed; only the public scholarly record leaves this function. */
  publicProfiles: (p: { q?: string } = {}): Promise<PublicProfile[]> => {
    const q = (p.q ?? "").trim().toLowerCase();
    const all = publicProfileList();
    return wait(all.filter((x) => !q || `${x.researcher.name} ${x.researcher.title} ${x.department}`.toLowerCase().includes(q)), 160);
  },
  publicProfile: (id: number): Promise<PublicProfile> => {
    const found = publicProfileList().find((x) => x.researcher.id === id);
    if (!found) throw new HttpError(404);
    return wait(found, 160);
  },

  /* Sign-in (FRONTEND_SPEC 4.1) */
  requestSignInLink: (email: string): Promise<SignInLink> => {
    const e = email.trim().toLowerCase();
    const roleKey = Object.keys(demoUsers).find((k) => demoUsers[k].email.toLowerCase() === e);
    if (!roleKey) throw new HttpError(404);
    const token = randomHex(16);
    links.set(token, { roleKey, expiresAt: Date.now() + LINK_MINUTES * 60_000, used: false });
    return wait({ link: `${location.origin}/sign-in?token=${token}`, expiresInMinutes: LINK_MINUTES }, 300);
  },
  signInWithLink: (token: string): Promise<User> => {
    const l = links.get(token);
    // One answer for unknown, used and expired so a guess learns nothing.
    if (!l || l.used || l.expiresAt < Date.now()) throw new HttpError(410);
    l.used = true;
    sessionStorage.setItem(SESSION_KEY, l.roleKey);
    audit("auth.link-signin", "session", demoUsers[l.roleKey].id, "sign-in link used");
    return wait(demoUsers[l.roleKey], 200);
  },
};

/** The public scholarly record of consenting, active people. Verified publications only; no email, IDs, awards or supervision. */
function publicProfileList(): PublicProfile[] {
  if (!db.settings.publicProfilesEnabled) throw new HttpError(404);
  return db.researchers
    .filter((r) => r.publicProfile && (r.status ?? "active") === "active")
    .map((r) => ({
      researcher: { id: r.id, name: r.name, title: r.title, orcid: r.orcid },
      department: db.orgUnits.find((u) => u.id === r.departmentId)?.name ?? "—",
      institution: db.settings.name,
      publications: db.publications
        .filter((p) => p.state === "verified" && p.authorIds.includes(r.id))
        .sort((a, b) => b.year - a.year)
        .map((p) => ({ id: p.id, title: p.title, venue: p.venue, year: p.year, doi: p.doi, type: p.type })),
    }))
    .sort((a, b) => a.researcher.name.localeCompare(b.researcher.name));
}

/* ---------------------------------- real ---------------------------------- */
const json = (body: unknown) => JSON.stringify(body);
export const real: typeof mock = {
  settings: () => http("/settings"),
  saveSettings: (patch) => http("/settings", { method: "PUT", body: json(patch) }),
  saveSso: (patch) => http("/settings/sso", { method: "PUT", body: json(patch) }),
  testSso: () => http("/settings/sso/test", { method: "POST" }),

  classification: () => http("/classification"),
  saveClassificationScheme: (s) => (s.id ? http(`/classification/${s.id}`, { method: "PUT", body: json(s) }) : http("/classification", { method: "POST", body: json(s) })),
  addTerm: ({ schemeId, ...t }) => http(`/classification/${schemeId}/terms`, { method: "POST", body: json(t) }),
  endTerm: ({ schemeId, code, validTo }) => http(`/classification/${schemeId}/terms/${encodeURIComponent(code)}/end`, { method: "POST", body: json({ validTo }) }),

  apiKeys: () => http("/api-keys"),
  createApiKey: (name) => http("/api-keys", { method: "POST", body: json({ name }) }),
  rotateApiKey: (id) => http(`/api-keys/${id}/rotate`, { method: "POST" }),
  revokeApiKey: (id) => http(`/api-keys/${id}`, { method: "DELETE" }),
  webhooks: () => http("/webhooks"),
  saveWebhook: (w) => (w.id ? http(`/webhooks/${w.id}`, { method: "PUT", body: json(w) }) : http("/webhooks", { method: "POST", body: json(w) })),
  deleteWebhook: (id) => http(`/webhooks/${id}`, { method: "DELETE" }),
  testWebhook: (id) => http(`/webhooks/${id}/test`, { method: "POST" }),

  tenants: () => http("/platform/tenants"),
  createTenant: (t) => http("/platform/tenants", { method: "POST", body: json(t) }),
  setTenantStatus: ({ id, status }) => http(`/platform/tenants/${id}/status`, { method: "PUT", body: json({ status }) }),
  exportTenant: (id) => http(`/platform/tenants/${id}/export`, { method: "POST" }),
  deleteTenant: ({ id, confirmName }) => http(`/platform/tenants/${id}/delete`, { method: "POST", body: json({ confirmName }) }),
  supportAccess: ({ id, ...b }) => http(`/platform/tenants/${id}/support-access`, { method: "POST", body: json(b) }),

  publicProfiles: (p = {}) => http(`/public/profiles${qs({ q: p.q })}`),
  publicProfile: (id) => http(`/public/profiles/${id}`),

  requestSignInLink: (email) => http("/auth/link", { method: "POST", body: json({ email }) }),
  signInWithLink: (token) => http("/auth/link/verify", { method: "POST", body: json({ token }) }),
};
