/**
 * Client state. The browser holds only what the server sent for the signed-in user: their own institution's data,
 * already narrowed to their role. Every change goes to the API, which checks the rules again (src/lib/domain.ts)
 * against the caller's own institution database. Hiding things in the UI is a convenience, not the protection.
 */
import { useSyncExternalStore } from 'react';
import { emptyInstitution } from './seed';
import type { AnyRecord, Biodata, DB, EntityKind, Faculty, Institution, Settings, User } from './types';

export { creditedFaculty, isEditable } from './domain';

const EMPTY: DB = emptyInstitution('', '', []);

interface Snapshot { db: DB; user: User | null; institution: Institution | null; ready: boolean }
let snapshot: Snapshot = { db: EMPTY, user: null, institution: null, ready: false };
const listeners = new Set<() => void>();
const set = (patch: Partial<Snapshot>) => { snapshot = { ...snapshot, ...patch }; listeners.forEach((l) => l()); };
const subscribe = (l: () => void) => { listeners.add(l); return () => listeners.delete(l); };

export const useStore = () => useSyncExternalStore(subscribe, () => snapshot);
export const getDB = () => snapshot.db;
export const getUser = () => snapshot.user;

// ---------- HTTP ----------

export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }

/**
 * Where the API is. Empty (the default): the same site that serves the pages, as with the prototype server or a proxy.
 * Set VITE_API_BASE at build time when the API has its own address, e.g. https://api.dev-unirise.mentoredge.co.in for
 * the Java API (unirise-api) with the pages on Hostinger (BACKEND_PLAN D4). The session cookie is then sent with
 * credentials: 'include'; it is SameSite=Strict, so it only goes to the same site (mentoredge.co.in).
 *
 * Pages served from a known UniRise web address use that environment's API when nothing was set at build time, so the
 * Hostinger build needs no settings there. Any other address (a local run, the prototype server) keeps the same site.
 */
const KNOWN_APIS: Record<string, string> = { 'dev-unirise.mentoredge.co.in': 'https://api.dev-unirise.mentoredge.co.in' };
const BUILT_API = (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_API_BASE;
export const API_BASE = (BUILT_API ?? (typeof location === 'undefined' ? '' : KNOWN_APIS[location.hostname] ?? '')).replace(/\/$/, '');
const CREDENTIALS: RequestCredentials = API_BASE ? 'include' : 'same-origin';

const UNREACHABLE = 'UniRise can’t be reached right now. Check your internet connection, or try again in a few minutes.';

async function api<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api${path}`, {
      method, credentials: CREDENTIALS,
      headers: { 'X-RDMS': '1', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, UNREACHABLE); // offline, or the server did not answer at all
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    // A session that expired or was ended by the Office of Research sends the user back to sign in.
    if (res.status === 401 && snapshot.user) set({ user: null, institution: null, db: EMPTY });
    const message = (data as { error?: string } | null)?.error;
    // No JSON error from UniRise: the request never reached it (a hosting error page, or the server is down or restarting).
    throw new ApiError(res.status, message ?? (data === null || res.status >= 502 ? UNREACHABLE : 'Something went wrong. Try again.'));
  }
  return (data ?? {}) as T;
}
export const adminApi = api;

// ---------- session ----------

/** Re-reads the institution's data (after an Office of Research action changed it). */
export const reloadData = () => loadData();
async function loadData() {
  if (snapshot.user) set({ db: await api<DB>('GET', '/data') });
  else set({ db: EMPTY });
}

/** Sets the user only together with their data, so no screen ever renders a signed-in user without it. */
async function enter(s: { user: User; institution: Institution | null }) {
  const db = await api<DB>('GET', '/data');
  set({ user: s.user, institution: s.institution, db });
}

/**
 * Keeps an open tab up to date with what others do: an approval by the Office of Research shows on the faculty
 * member's screen, and a new submission in the Office's queue, without reloading the page. Refreshes when the tab
 * comes back into view, when moving to another page (at most every 5 seconds) and every minute while visible.
 * Nothing re-renders unless the data actually changed.
 */
let lastData = '';
let lastRefresh = 0;
async function refreshQuietly(minGapMs: number) {
  if (!snapshot.user || document.visibilityState !== 'visible' || Date.now() - lastRefresh < minGapMs) return;
  lastRefresh = Date.now();
  try {
    const res = await fetch(`${API_BASE}/api/data`, { credentials: CREDENTIALS, headers: { 'X-RDMS': '1' } });
    if (res.status === 401) { set({ user: null, institution: null, db: EMPTY }); return; }
    if (!res.ok) return;
    const text = await res.text();
    if (text !== lastData) { lastData = text; set({ db: JSON.parse(text) as DB }); }
    window.dispatchEvent(new Event('rdms:approvals'));
  } catch { /* offline for a moment: the next refresh catches up */ }
}
if (typeof window !== 'undefined') {
  document.addEventListener('visibilitychange', () => void refreshQuietly(2_000));
  window.addEventListener('focus', () => void refreshQuietly(2_000));
  window.addEventListener('hashchange', () => void refreshQuietly(5_000));
  setInterval(() => void refreshQuietly(55_000), 60_000);
}

/** Called once on start: restores the session from the HttpOnly cookie, if any. */
export async function bootstrap() {
  try {
    await enter(await api<{ user: User; institution: Institution | null }>('GET', '/session'));
  } catch { set({ user: null, institution: null, db: EMPTY }); }
  set({ ready: true });
}

async function signInWith(path: string, email: string, password: string): Promise<string | null> {
  try {
    await enter(await api<{ user: User; institution: Institution | null }>('POST', path, { email, password }));
    return null;
  } catch (e) { return (e as Error).message; }
}
export const login = (email: string, password: string) => signInWith('/login', email, password);

export async function logout() {
  try { await api('POST', '/logout'); } finally { set({ user: null, institution: null, db: EMPTY }); }
}

export async function changePassword(current: string, next: string): Promise<string | null> {
  try { await api('POST', '/account/password', { current, next }); return null; } catch (e) { return (e as Error).message; }
}

/** Public "Talk to Our Team" enquiry from an institution. */
export const sendEnquiry = (e: Record<string, string>) => api('POST', '/enquiries', e);

// ---------- institution data ----------

/** Records this user may see (the server has already narrowed them). */
export function visible<K extends EntityKind>(kind: K): DB[K] { return snapshot.db[kind]; }

const mutate = async <T = null>(method: string, path: string, body?: unknown) => {
  const r = await api<{ result: T }>(method, path, body);
  await loadData();
  return r.result;
};

/** `note` is the faculty member's reply to the Office of Research, sent with a (re)submission. */
export const saveRecord = (kind: EntityKind, record: AnyRecord, submit: boolean, note = '') => mutate<string>('POST', `/records/${kind}`, { record: { ...record, note }, submit });
export const deleteRecord = (kind: EntityKind, id: string) => mutate('DELETE', `/records/${kind}/${encodeURIComponent(id)}`);
/** Office of Research: official details or deactivation of a faculty profile. */
export const saveFaculty = (f: Faculty) => mutate('PUT', `/faculty/${encodeURIComponent(f.id)}`, f);
export const saveSettings = (s: Settings) => mutate('PUT', '/settings', s);
export const addNotice = (title: string, body: string) => mutate('POST', '/notices', { title, body });
export const deleteNotice = (id: string) => mutate('DELETE', `/notices/${encodeURIComponent(id)}`);
/** A faculty member's proposed profile update; it changes nothing until the Office of Research approves it. */
export const proposeProfileChange = (biodata: Biodata, contact: Pick<Faculty, 'email' | 'phone' | 'orcid' | 'scopusId'>, submit: boolean) => mutate<string>('POST', '/profile-changes', { biodata, contact, submit });

export function emptyBase(facultyId: string) {
  return { id: '', facultyId, status: 'Draft' as const, createdAt: '', updatedAt: '', history: [] };
}
