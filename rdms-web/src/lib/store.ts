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

async function api<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method, credentials: 'same-origin',
    headers: { 'X-RDMS': '1', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // A session that expired or was ended by the Office of Research sends the user back to sign in.
    if (res.status === 401 && snapshot.user) set({ user: null, institution: null, db: EMPTY });
    throw new ApiError(res.status, (data as { error?: string }).error ?? 'Something went wrong. Try again.');
  }
  return data as T;
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
