/**
 * Client state. The browser holds only what the server sent for the signed-in user: their own institution's data,
 * already narrowed to their role. Every change goes to the API, which checks the rules again (src/lib/domain.ts)
 * against the caller's own institution database. Hiding things in the UI is a convenience, not the protection.
 */
import { useSyncExternalStore } from 'react';
import { emptyInstitution } from './seed';
import type { AnyRecord, Biodata, DB, EntityKind, Faculty, Grant, Institution, Settings, User } from './types';

export { creditedFaculty, isEditable } from './domain';
export type { Decision } from './domain';

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

async function loadData() {
  if (snapshot.user && snapshot.user.role !== 'it_admin') set({ db: await api<DB>('GET', '/data') });
  else set({ db: EMPTY });
}

/** Sets the user only together with their data, so no screen ever renders a signed-in user without it. */
async function enter(s: { user: User; institution: Institution | null }) {
  const db = s.user.role === 'it_admin' ? EMPTY : await api<DB>('GET', '/data');
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
export const adminLogin = (email: string, password: string) => signInWith('/admin/login', email, password);

export async function logout() {
  try { await api('POST', '/logout'); } finally { set({ user: null, institution: null, db: EMPTY }); }
}

export async function changePassword(current: string, next: string): Promise<string | null> {
  try { await api('POST', '/account/password', { current, next }); return null; } catch (e) { return (e as Error).message; }
}

export interface Registration { institutionId: string; role: 'faculty' | 'management'; title: string; name: string; email: string; password: string; employeeCode: string; department: string; designation: string; note: string }
export const register = (r: Registration) => api('POST', '/register', r);
export const publicInstitutions = () => api<{ id: string; name: string }[]>('GET', '/public/institutions');
export const publicDepartments = (id: string) => api<string[]>('GET', `/public/institutions/${encodeURIComponent(id)}/departments`);

// ---------- institution data ----------

/** Records this user may see (the server has already narrowed them). */
export function visible<K extends EntityKind>(kind: K): DB[K] { return snapshot.db[kind]; }

const mutate = async <T = null>(method: string, path: string, body?: unknown) => {
  const r = await api<{ result: T }>(method, path, body);
  await loadData();
  return r.result;
};

export const saveRecord = (kind: EntityKind, record: AnyRecord, submit: boolean) => mutate<string>('POST', `/records/${kind}`, { record, submit });
export const deleteRecord = (kind: EntityKind, id: string) => mutate('DELETE', `/records/${kind}/${encodeURIComponent(id)}`);
export const review = (kind: EntityKind, id: string, decision: 'Approved' | 'Rework' | 'Rejected', remark: string, extra?: { sanctionedAmount?: number }) =>
  mutate('POST', `/records/${kind}/${encodeURIComponent(id)}/review`, { decision, remark, sanctionedAmount: extra?.sanctionedAmount });
export const updateGrantOutcome = (id: string, patch: Pick<Grant, 'outcome' | 'sanctionDate' | 'sanctionedAmount' | 'receivedAmount'>) => mutate('POST', `/grants/${encodeURIComponent(id)}/outcome`, patch);
export const saveBiodata = (b: Biodata) => mutate('PUT', `/biodata/${encodeURIComponent(b.facultyId)}`, b);
export const saveFaculty = (f: Faculty, isNew = false) => (isNew ? mutate('POST', '/faculty', f) : mutate('PUT', `/faculty/${encodeURIComponent(f.id)}`, f));
export const saveSettings = (s: Settings) => mutate('PUT', '/settings', s);
export const addNotice = (title: string, body: string) => mutate('POST', '/notices', { title, body });
export const deleteNotice = (id: string) => mutate('DELETE', `/notices/${encodeURIComponent(id)}`);

export function emptyBase(facultyId: string) {
  return { id: '', facultyId, status: 'Draft' as const, createdAt: '', updatedAt: '', history: [] };
}
