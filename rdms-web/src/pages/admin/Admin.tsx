import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, DataTable, Field, Input, Modal, PageTitle, Panel, Select, Tabs, TextArea, useToast } from '../../components/ui';
import type { Column } from '../../components/ui';
import { fmtDate } from '../../lib/analytics';
import { adminApi, publicDepartments } from '../../lib/store';
import type { Institution } from '../../lib/types';

interface Account {
  id: string; email: string; name: string; title: string; role: 'it_admin' | 'management' | 'faculty'; status: string; institutionId: string | null; facultyId: string | null;
  designation: string; department: string; employeeCode: string; note: string; requestedAt: string; reviewedBy: string | null; reviewedAt: string | null; reviewNote: string; affiliationVerified: boolean;
}
type Inst = Institution & { management: number; faculty: number; pending: number };

const ROLE: Record<string, string> = { it_admin: 'Office of Research', management: 'Top-Level Management', faculty: 'Faculty' };
const STATUS_BADGE: Record<string, string> = { active: 'Approved', pending: 'Submitted', rejected: 'Rejected', suspended: 'Rework', deactivated: 'Draft' };
const statusBadge = (s: string) => <span className={`badge ${STATUS_BADGE[s] ?? 'Draft'}`}>{s[0].toUpperCase() + s.slice(1)}</span>;
const domainOf = (email: string) => email.split('@')[1]?.toLowerCase() ?? '';

/** Loads admin data and reloads on demand. */
function useAdmin<T>(path: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const reload = useCallback(() => { adminApi<T>('GET', path).then((d) => { setData(d); setError(''); }).catch((e) => setError((e as Error).message)); }, [path]);
  useEffect(reload, [reload]);
  return { data, error, reload };
}

// ---------------- Access requests ----------------

export function AdminRequests() {
  const [tab, setTab] = useState<'pending' | 'rejected'>('pending');
  const req = useAdmin<Account[]>(`/admin/requests?status=${tab}`);
  const inst = useAdmin<Inst[]>('/admin/institutions');
  const [open, setOpen] = useState<Account | null>(null);
  const instName = useMemo(() => new Map((inst.data ?? []).map((i) => [i.id, i])), [inst.data]);
  const cols: Column<Account>[] = [
    { key: 'at', label: 'Requested', value: (a) => a.requestedAt, render: (a) => fmtDate(a.requestedAt) },
    { key: 'name', label: 'Name', value: (a) => `${a.title} ${a.name}` },
    { key: 'email', label: 'Email', value: (a) => a.email },
    { key: 'role', label: 'Requested role', value: (a) => ROLE[a.role] },
    { key: 'inst', label: 'Institution', value: (a) => instName.get(a.institutionId ?? '')?.name ?? '—' },
    { key: 'domain', label: 'Email domain', value: (a) => (domainOf(a.email) === instName.get(a.institutionId ?? '')?.emailDomain ? 1 : 0),
      render: (a) => (domainOf(a.email) === instName.get(a.institutionId ?? '')?.emailDomain ? <span className="badge Approved">✓ Matches</span> : <span className="badge Rework">! Different</span>) },
    { key: 'detail', label: 'Code / Department', value: (a) => (a.role === 'faculty' ? `${a.employeeCode} · ${a.department}` : a.designation) },
    ...(tab === 'rejected' ? [{ key: 'why', label: 'Reason', value: (a: Account) => a.reviewNote }, { key: 'by', label: 'Decided by', value: (a: Account) => `${a.reviewedBy ?? ''} ${fmtDate(a.reviewedAt ?? '')}` }] : []),
  ];
  return (
    <>
      <PageTitle>Access Requests</PageTitle>
      <Panel size="wide">
        <Tabs value={tab} onChange={setTab} tabs={[{ id: 'pending', label: `Waiting${req.data && tab === 'pending' ? ` (${req.data.length})` : ''}` }, { id: 'rejected', label: 'Rejected' }]} />
        {req.error && <Alert kind="error">{req.error}</Alert>}
        <DataTable rows={req.data ?? []} columns={cols} rowKey={(a) => a.id} onRowClick={tab === 'pending' ? setOpen : undefined} empty={tab === 'pending' ? 'No requests are waiting.' : 'No rejected requests.'} />
        {tab === 'pending' && <p className="note">Open a request to verify the person and approve or reject it. Only approved accounts can sign in. Requests with an email outside the institution’s domain need extra checking.</p>}
      </Panel>
      {open && inst.data && <ReviewRequest account={open} institutions={inst.data} onClose={() => setOpen(null)} onDone={() => { setOpen(null); req.reload(); inst.reload(); }} />}
    </>
  );
}

function ReviewRequest({ account: a, institutions, onClose, onDone }: { account: Account; institutions: Inst[]; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState({ institutionId: a.institutionId ?? '', role: a.role as 'faculty' | 'management', employeeCode: a.employeeCode, department: a.department, designation: a.designation, title: a.title, note: '', affiliationVerified: false });
  const [departments, setDepartments] = useState<string[]>([]);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (form.institutionId) publicDepartments(form.institutionId).then(setDepartments).catch(() => setDepartments([])); }, [form.institutionId]);
  const inst = institutions.find((i) => i.id === form.institutionId);
  const match = !!inst && domainOf(a.email) === inst.emailDomain;
  const act = async (path: string, body: unknown, msg: string) => {
    setBusy(true);
    try { await adminApi('POST', path, body); toast(msg); onDone(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Modal title={`Access request · ${a.title} ${a.name}`} onClose={onClose}>
      {error && <Alert kind="error">{error}</Alert>}
      <dl className="kv">
        <dt>Email</dt><dd>{a.email}</dd>
        <dt>Requested</dt><dd>{ROLE[a.role]} at {institutions.find((i) => i.id === a.institutionId)?.name ?? '—'}, {fmtDate(a.requestedAt)}</dd>
        {a.role === 'faculty' && <><dt>Employee code</dt><dd>{a.employeeCode}</dd><dt>Department</dt><dd>{a.department}</dd></>}
        <dt>Designation</dt><dd>{a.designation || '—'}</dd>
        <dt>Their note</dt><dd>{a.note || '—'}</dd>
      </dl>
      <div className="panel" style={{ marginTop: 14 }}>
        <h3 className="panel-title">Assign and approve</h3>
        <div className="grid g2">
          <Field label="Institution" required><Select value={form.institutionId} onChange={(v) => setForm({ ...form, institutionId: v, department: '' })} options={institutions.filter((i) => i.status === 'active').map((i) => ({ value: i.id, label: i.name }))} placeholder="--Select--" /></Field>
          <Field label="Role" required><Select value={form.role} onChange={(v) => setForm({ ...form, role: v as 'faculty' | 'management' })} options={[{ value: 'faculty', label: 'Faculty' }, { value: 'management', label: 'Top-Level Management' }]} /></Field>
          {form.role === 'faculty' && <>
            <Field label="Employee code" required hint="Links to the existing profile with this code, or creates one"><Input value={form.employeeCode} onChange={(v) => setForm({ ...form, employeeCode: v })} /></Field>
            <Field label="Department" required><Select value={form.department} onChange={(v) => setForm({ ...form, department: v })} options={departments} placeholder="--Select--" /></Field>
          </>}
          <Field label="Designation"><Input value={form.designation} onChange={(v) => setForm({ ...form, designation: v })} /></Field>
          <Field label="Note (kept in the audit log)"><Input value={form.note} onChange={(v) => setForm({ ...form, note: v })} /></Field>
        </div>
        {inst && <p className="note">{match ? <>✓ The email domain matches {inst.name} ({inst.emailDomain}).</> : <>! The email domain <b>{domainOf(a.email)}</b> does not match {inst.name} ({inst.emailDomain}). Confirm the person with the institution before approving.</>}</p>}
        <label className="check" style={{ marginTop: 6 }}>
          <input type="checkbox" checked={form.affiliationVerified} onChange={(e) => setForm({ ...form, affiliationVerified: e.target.checked })} />
          I have verified that this person belongs to the selected institution in this role.
        </label>
        <div className="btn-row">
          <button className="btn ok" disabled={busy || !form.affiliationVerified} onClick={() => act(`/admin/requests/${a.id}/approve`, form, `${a.name} approved as ${ROLE[form.role]}.`)}>Approve</button>
        </div>
      </div>
      <div className="panel" style={{ marginTop: 14 }}>
        <h3 className="panel-title">Reject</h3>
        <Field label="Reason" hint="Recorded in the audit log"><TextArea value={reason} onChange={setReason} /></Field>
        <div className="btn-row"><button className="btn danger" disabled={busy} onClick={() => act(`/admin/requests/${a.id}/reject`, { reason }, `Request from ${a.name} rejected.`)}>Reject request</button></div>
      </div>
    </Modal>
  );
}

// ---------------- Users ----------------

export function AdminUsers() {
  const users = useAdmin<Account[]>('/admin/users');
  const inst = useAdmin<Inst[]>('/admin/institutions');
  const toast = useToast();
  const [filter, setFilter] = useState({ institutionId: '', role: '', status: '', q: '' });
  const [open, setOpen] = useState<Account | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [temp, setTemp] = useState('');
  const instName = new Map((inst.data ?? []).map((i) => [i.id, i.name]));
  const rows = (users.data ?? []).filter((a) => (!filter.institutionId || a.institutionId === filter.institutionId) && (!filter.role || a.role === filter.role)
    && (!filter.status || a.status === filter.status) && (!filter.q || `${a.name} ${a.email}`.toLowerCase().includes(filter.q.toLowerCase())));
  const act = async (path: string, body: unknown, msg: string) => {
    try {
      const r = await adminApi<{ temporaryPassword?: string }>('POST', path, body);
      if (r.temporaryPassword) setTemp(r.temporaryPassword);
      else { setOpen(null); }
      toast(msg); setError(''); setReason(''); users.reload();
    } catch (e) { setError((e as Error).message); }
  };
  const cols: Column<Account>[] = [
    { key: 'name', label: 'Name', value: (a) => a.name },
    { key: 'email', label: 'Email', value: (a) => a.email },
    { key: 'role', label: 'Role', value: (a) => ROLE[a.role] },
    { key: 'inst', label: 'Institution', value: (a) => (a.institutionId ? instName.get(a.institutionId) ?? a.institutionId : 'Platform') },
    { key: 'profile', label: 'Faculty profile', value: (a) => a.facultyId ?? '—' },
    { key: 'status', label: 'Status', value: (a) => a.status, render: (a) => statusBadge(a.status) },
    { key: 'by', label: 'Approved by', value: (a) => a.reviewedBy ?? '' },
  ];
  return (
    <>
      <PageTitle>Users</PageTitle>
      <Panel size="wide">
        <div className="filters" style={{ marginBottom: 10 }}>
          <Field label="Search"><Input value={filter.q} onChange={(v) => setFilter({ ...filter, q: v })} placeholder="Name or email" type="search" /></Field>
          <Field label="Institution"><Select value={filter.institutionId} onChange={(v) => setFilter({ ...filter, institutionId: v })} options={(inst.data ?? []).map((i) => ({ value: i.id, label: i.name }))} placeholder="All" /></Field>
          <Field label="Role"><Select value={filter.role} onChange={(v) => setFilter({ ...filter, role: v })} options={[{ value: 'management', label: 'Top-Level Management' }, { value: 'faculty', label: 'Faculty' }, { value: 'it_admin', label: 'Office of Research' }]} placeholder="All" /></Field>
          <Field label="Status"><Select value={filter.status} onChange={(v) => setFilter({ ...filter, status: v })} options={['active', 'suspended', 'deactivated']} placeholder="All" /></Field>
        </div>
        {users.error && <Alert kind="error">{users.error}</Alert>}
        <DataTable rows={rows} columns={cols} rowKey={(a) => a.id} onRowClick={(a) => { setOpen(a); setTemp(''); setError(''); }} exportName="platform_users" pageSize={20} />
        <p className="note">Open a user to suspend, deactivate, reactivate, change role or reset their password. Suspending signs them out at once. Office of Research accounts are managed from the server command line.</p>
      </Panel>
      {open && (
        <Modal title={`${open.name} · ${ROLE[open.role]}`} onClose={() => setOpen(null)}>
          {error && <Alert kind="error">{error}</Alert>}
          <dl className="kv">
            <dt>Email</dt><dd>{open.email}</dd>
            <dt>Institution</dt><dd>{open.institutionId ? instName.get(open.institutionId) : 'Platform (all institutions)'}</dd>
            <dt>Status</dt><dd>{statusBadge(open.status)}</dd>
            {open.facultyId && <><dt>Faculty profile</dt><dd>{open.facultyId}</dd></>}
            <dt>Approved</dt><dd>{open.reviewedBy ?? '—'} {fmtDate(open.reviewedAt ?? '')}</dd>
          </dl>
          {open.role !== 'it_admin' && (
            <div className="panel" style={{ marginTop: 14 }}>
              <Field label="Reason" hint="Needed to suspend or deactivate; recorded in the audit log"><Input value={reason} onChange={setReason} /></Field>
              <div className="btn-row">
                {open.status !== 'active' && <button className="btn ok" onClick={() => act(`/admin/users/${open.id}/status`, { status: 'active', reason }, `${open.name} reactivated.`)}>Activate</button>}
                {open.status === 'active' && <button className="btn warn" onClick={() => act(`/admin/users/${open.id}/status`, { status: 'suspended', reason }, `${open.name} suspended.`)}>Suspend</button>}
                {open.status !== 'deactivated' && <button className="btn danger" onClick={() => act(`/admin/users/${open.id}/status`, { status: 'deactivated', reason }, `${open.name} deactivated.`)}>Deactivate</button>}
                {open.role === 'faculty'
                  ? <button className="btn secondary" onClick={() => act(`/admin/users/${open.id}/role`, { role: 'management' }, `${open.name} is now Top-Level Management.`)}>Make Top-Level Management</button>
                  : open.facultyId && <button className="btn secondary" onClick={() => act(`/admin/users/${open.id}/role`, { role: 'faculty' }, `${open.name} is now Faculty.`)}>Make Faculty</button>}
                <button className="btn secondary" onClick={() => act(`/admin/users/${open.id}/reset-password`, {}, 'Temporary password created.')}>Reset password</button>
              </div>
              {temp && <Alert kind="success">Temporary password: <b style={{ fontFamily: 'monospace' }}>{temp}</b>. Give it to {open.name} through a trusted channel; it is shown only once. They should change it after signing in.</Alert>}
            </div>
          )}
        </Modal>
      )}
    </>
  );
}

// ---------------- Institutions ----------------

export function AdminInstitutions() {
  const inst = useAdmin<Inst[]>('/admin/institutions');
  const toast = useToast();
  const blank = { name: '', slug: '', emailDomain: '', tagline: 'Faculty Research & Development Portal', departments: '' };
  const [f, setF] = useState(blank);
  const [error, setError] = useState('');
  const create = async () => {
    try {
      await adminApi('POST', '/admin/institutions', { ...f, departments: f.departments.split('\n').map((d) => d.trim()).filter(Boolean) });
      toast(`${f.name} created with its own database.`); setF(blank); setError(''); inst.reload();
    } catch (e) { setError((e as Error).message); }
  };
  const setStatus = async (i: Inst, status: 'active' | 'suspended') => {
    if (status === 'suspended' && !confirm(`Suspend ${i.name}? All its users are signed out and cannot sign in until you reactivate it. Its data is kept.`)) return;
    try { await adminApi('POST', `/admin/institutions/${i.id}/status`, { status }); toast(`${i.name} ${status === 'active' ? 'reactivated' : 'suspended'}.`); inst.reload(); } catch (e) { setError((e as Error).message); }
  };
  const cols: Column<Inst>[] = [
    { key: 'name', label: 'Institution', value: (i) => i.name },
    { key: 'slug', label: 'Short code', value: (i) => i.slug },
    { key: 'domain', label: 'Email domain', value: (i) => i.emailDomain },
    { key: 'mgmt', label: 'Management', value: (i) => i.management, num: true },
    { key: 'fac', label: 'Faculty accounts', value: (i) => i.faculty, num: true },
    { key: 'pending', label: 'Pending', value: (i) => i.pending, num: true },
    { key: 'status', label: 'Status', value: (i) => i.status, render: (i) => statusBadge(i.status) },
    { key: 'act', label: '', value: () => '', render: (i) => (i.status === 'active'
      ? <button className="link-btn" onClick={() => setStatus(i, 'suspended')}>Suspend</button>
      : <button className="link-btn" onClick={() => setStatus(i, 'active')}>Reactivate</button>) },
  ];
  return (
    <>
      <PageTitle>Institutions</PageTitle>
      <Panel size="wide" title="Institutions on the platform">
        {(inst.error || error) && <Alert kind="error">{inst.error || error}</Alert>}
        <DataTable rows={inst.data ?? []} columns={cols} rowKey={(i) => i.id} />
        <p className="note">Each institution has its own database. You manage access here; you cannot see an institution’s research records.</p>
      </Panel>
      <Panel size="wide" title="Add an institution">
        <div className="grid">
          <Field label="Name" required className="span2"><Input value={f.name} onChange={(v) => setF({ ...f, name: v })} /></Field>
          <Field label="Short code" required hint="Lower case, e.g. riverside"><Input value={f.slug} onChange={(v) => setF({ ...f, slug: v.toLowerCase() })} /></Field>
          <Field label="Email domain" required hint="e.g. riverside.edu.in"><Input value={f.emailDomain} onChange={(v) => setF({ ...f, emailDomain: v })} /></Field>
          <Field label="Tagline" className="span2"><Input value={f.tagline} onChange={(v) => setF({ ...f, tagline: v })} /></Field>
          <Field label="Departments" required className="span2" hint="One per line; management can change them later"><TextArea value={f.departments} onChange={(v) => setF({ ...f, departments: v })} rows={4} /></Field>
        </div>
        <div className="btn-row"><button className="btn" onClick={create}>Create institution</button></div>
      </Panel>
    </>
  );
}

// ---------------- Audit ----------------

export function AdminAudit() {
  const audit = useAdmin<{ id: number; at: string; actor_name: string | null; action: string; target: string | null; institution_id: string | null; detail: string }[]>('/admin/audit');
  return (
    <>
      <PageTitle>Audit Log</PageTitle>
      <Panel size="wide">
        {audit.error && <Alert kind="error">{audit.error}</Alert>}
        <DataTable rows={audit.data ?? []} rowKey={(r) => String(r.id)} exportName="platform_audit" pageSize={25} columns={[
          { key: 'at', label: 'When', value: (r) => r.at, render: (r) => `${fmtDate(r.at)} ${r.at.slice(11, 16)}` },
          { key: 'who', label: 'By', value: (r) => r.actor_name ?? '—' },
          { key: 'action', label: 'Action', value: (r) => r.action },
          { key: 'target', label: 'Target', value: (r) => r.target ?? '' },
          { key: 'inst', label: 'Institution', value: (r) => r.institution_id ?? '' },
          { key: 'detail', label: 'Detail', value: (r) => r.detail },
        ]} />
        <p className="note">Sign-ins by the Office of Research, failed admin sign-ins, access decisions, account and institution changes. Times are UTC.</p>
      </Panel>
    </>
  );
}
