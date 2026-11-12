import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Alert, DataTable, Field, Input, Modal, NumberInput, PageTitle, Panel, Select, StatusBadge, Tabs, TextArea, useToast } from '../../components/ui';
import type { Column } from '../../components/ui';
import { fmtDate } from '../../lib/analytics';
import { ENTITIES, listColumns } from '../../lib/entities';
import { adminApi, reloadData, useStore } from '../../lib/store';
import type { AnyRecord, Biodata, DB, EntityKind, Faculty, Grant, HistoryItem, ProfileChange, SeedMoney, Status } from '../../lib/types';
import { DECISION_ACTIONS, ENTITY_LABEL, GRANT_OUTCOMES, STATUS_LABEL, isAwaitingOffice, statusLabel } from '../../lib/types';
import { Conversation, ProgressTracker } from '../../components/workflow';

interface Account {
  id: string; email: string; name: string; title: string; role: 'office' | 'management' | 'faculty'; status: string; institutionId: string | null; facultyId: string | null;
  designation: string; department: string; employeeCode: string; note: string; requestedAt: string; reviewedBy: string | null; reviewedAt: string | null; reviewNote: string; affiliationVerified: boolean;
}

const ROLE: Record<string, string> = { office: 'Office of Research', management: 'Top-Level Management', faculty: 'Faculty' };
const STATUS_BADGE: Record<string, string> = { active: 'Approved', pending: 'Submitted', rejected: 'Rejected', suspended: 'Rework', deactivated: 'Draft' };
const statusBadge = (s: string) => <span className={`badge ${STATUS_BADGE[s] ?? 'Draft'}`}>{s[0].toUpperCase() + s.slice(1)}</span>;

/** Loads admin data and reloads on demand. */
function useAdmin<T>(path: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const reload = useCallback(() => { if (!path) return; adminApi<T>('GET', path).then((d) => { setData(d); setError(''); }).catch((e) => setError((e as Error).message)); }, [path]);
  useEffect(reload, [reload]);
  return { data, error, reload };
}

// ---------------- Record approvals ----------------

const KINDS: EntityKind[] = ['publications', 'grants', 'seedMoney', 'fdps', 'conferences', 'awards', 'ipr'];
type QueueKind = EntityKind | 'profiles';
interface ApprovalQueue { records: Record<EntityKind, AnyRecord[]>; profiles: ProfileChange[]; currentProfiles: Record<string, Biodata | null> }
const decisionOf = (h: HistoryItem[]) => [...h].reverse().find((x) => DECISION_ACTIONS.includes(x.action));
/** The stages of the review workflow, one tab each. */
type View = 'awaiting' | 'review' | 'returned' | 'approved' | 'rejected';
const VIEWS: { id: View; label: string }[] = [
  { id: 'awaiting', label: 'New and resubmitted' },
  { id: 'review', label: 'Under review' },
  { id: 'returned', label: 'Changes requested' },
  { id: 'approved', label: 'Approved' },
  { id: 'rejected', label: 'Rejected' },
];

/**
 * The Office of Research approval section for its own institution: faculty submissions (entries and profile updates)
 * waiting for review, and the history of past decisions. Only this role reviews; the API enforces it.
 */
export function AdminApprovals() {
  const { db: full, institution } = useStore();
  const [view, setView] = useState<View>('awaiting');
  const queue = useAdmin<ApprovalQueue>(`/office/approvals?view=${view}`);
  const totals = useAdmin<{ awaiting: number; review: number; returned: number }>('/office/approvals/count');
  const pending = view === 'awaiting' || view === 'review';
  const [kind, setKind] = useState<QueueKind | ''>('');
  const [dept, setDept] = useState('');
  const [open, setOpen] = useState<AnyRecord | null>(null);
  const [openProfile, setOpenProfile] = useState<ProfileChange | null>(null);
  const q = queue.data;
  const inst = { id: institution?.id ?? '', name: institution?.name ?? full.settings.institutionName };
  // The institution's data with just the queue's records, so the usual columns and detail views can be reused.
  const db = useMemo<DB | null>(() => q && ({ ...full, ...(q.records as unknown as Pick<DB, EntityKind>) }), [q, full]);
  const counts = q ? Object.fromEntries([...KINDS.map((k) => [k, q.records[k].length]), ['profiles', q.profiles.length]]) as Record<QueueKind, number> : null;
  const k: QueueKind = kind || (counts && ([...KINDS, 'profiles'] as QueueKind[]).find((x) => counts[x])) || 'publications';
  const byId = new Map(full.faculty.map((f) => [f.id, f]));
  const inDept = (facultyId: string) => !dept || byId.get(facultyId)?.department === dept;
  const order = <T extends { updatedAt: string }>(xs: T[]) => [...xs].sort((a, b) => (pending ? a.updatedAt.localeCompare(b.updatedAt) : b.updatedAt.localeCompare(a.updatedAt)));
  const rows = k === 'profiles' ? [] : order((q?.records[k] ?? []).filter((r) => inDept(r.facultyId)));
  const profileRows = order((q?.profiles ?? []).filter((c) => inDept(c.facultyId)));
  const submittedAt = (h: HistoryItem[]) => [...h].reverse().find((x) => x.action === 'Submitted' || x.action === 'Resubmitted')?.at ?? '';
  const timing: Column<{ updatedAt: string; history: HistoryItem[]; status: Status }>[] = pending ? [
    { key: 'stage', label: 'Status', value: (r) => statusLabel(r), render: (r) => <StatusBadge status={r.status} history={r.history} /> },
    { key: 'submitted', label: 'Submitted', value: (r) => submittedAt(r.history), render: (r) => fmtDate(submittedAt(r.history)) },
    { key: 'wait', label: 'Waiting (days)', value: (r) => Math.max(0, Math.floor((Date.now() - Date.parse(r.updatedAt)) / 86400000)), num: true },
  ] : [
    { key: 'status', label: 'Status', value: (r) => STATUS_LABEL[r.status], render: (r) => <StatusBadge status={r.status} /> },
    { key: 'by', label: 'Decided', value: (r) => decisionOf(r.history)?.at ?? '', render: (r) => { const d = decisionOf(r.history); return d ? `${fmtDate(d.at)} · ${d.by}` : '—'; } },
    { key: 'remark', label: 'Comment', value: (r) => decisionOf(r.history)?.remark ?? '' },
  ];
  const act = pending ? 'Review' : 'Open';
  // Review button first, then only what is needed to pick the entry; the full details open in the review window.
  const cols: Column<AnyRecord>[] = db && k !== 'profiles' ? [
    { key: 'act', label: 'Action', value: () => '', render: (r) => <button type="button" className="btn sm" onClick={(e) => { e.stopPropagation(); setOpen(r); }}>{act}</button> },
    ...listColumns(db, k, { showOwner: true }).filter((c) => ['id', 'type', 'title', 'owner', 'dept'].includes(c.key)),
    ...(timing as Column<AnyRecord>[]),
  ] : [];
  const profileCols: Column<ProfileChange>[] = [
    { key: 'id', label: 'Update ID', value: (c) => c.id },
    { key: 'who', label: 'Faculty', value: (c) => byId.get(c.facultyId)?.name ?? c.facultyId },
    { key: 'dept', label: 'Department', value: (c) => byId.get(c.facultyId)?.department ?? '' },
    { key: 'what', label: 'Changes', value: (c) => c.changed.join(', '), className: 'title-cell' },
    ...(timing as Column<ProfileChange>[]),
  ];
  profileCols.unshift({ key: 'act', label: 'Action', value: () => '', render: (c) => <button type="button" className="btn sm" onClick={(e) => { e.stopPropagation(); setOpenProfile(c); }}>{act}</button> });
  const refresh = () => { queue.reload(); totals.reload(); void reloadData(); window.dispatchEvent(new Event('rdms:approvals')); };
  const count = (v: View) => (v === 'awaiting' || v === 'review' || v === 'returned' ? totals.data?.[v] : undefined);
  const label = (x: QueueKind) => (x === 'profiles' ? 'Profile updates' : ENTITY_LABEL[x]);
  return (
    <>
      <PageTitle>Approvals</PageTitle>
      <Panel size="wide">
        {queue.error && <Alert kind="error">{queue.error}</Alert>}
        <Tabs value={view} onChange={(v) => { setView(v); setKind(''); }} tabs={VIEWS.map((v) => ({ id: v.id, label: count(v.id) != null ? `${v.label} (${count(v.id)})` : v.label }))} />
        <div className="filters" style={{ marginBottom: 10 }}>
          <Field label="Department"><Select value={dept} onChange={setDept} options={full.settings.departments} placeholder="All departments" /></Field>
        </div>
        {counts && <Tabs value={k} onChange={setKind} tabs={([...KINDS, 'profiles'] as QueueKind[]).map((x) => ({ id: x, label: `${label(x)} (${counts[x]})` }))} />}
        {k === 'profiles'
          ? <DataTable rows={profileRows} columns={profileCols} rowKey={(c) => c.id} onRowClick={setOpenProfile} empty={q ? 'No profile updates here.' : 'Loading…'} />
          : <DataTable rows={rows} columns={cols} rowKey={(r) => r.id} onRowClick={setOpen} exportName={`${view}_${k}`} empty={q ? `No ${ENTITIES[k].plural.toLowerCase()} here.` : 'Loading…'} />}
      </Panel>
      {open && db && k !== 'profiles' && <ReviewEntry inst={inst} db={db} kind={k} r={open} onClose={() => { setOpen(null); refresh(); }} onDone={() => { setOpen(null); refresh(); }} />}
      {openProfile && q && <ReviewProfile inst={inst} change={openProfile} faculty={byId.get(openProfile.facultyId)} current={q.currentProfiles[openProfile.facultyId] ?? null} onClose={() => { setOpenProfile(null); refresh(); }} onDone={() => { setOpenProfile(null); refresh(); }} />}
    </>
  );
}

/** Approve / return / reject buttons with a required comment for the last two. */
export function Decide({ path, onDone, extra, label }: { path: string; onDone: () => void; extra?: () => Record<string, unknown>; label: string }) {
  const toast = useToast();
  const [remark, setRemark] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const decide = async (decision: 'Approved' | 'Rework' | 'Rejected') => {
    if (busy) return;
    if (decision !== 'Approved' && !remark.trim()) { setError(decision === 'Rework' ? 'Write what needs correcting.' : 'Give a reason for the rejection.'); return; }
    setBusy(true);
    try {
      await adminApi('POST', path, { decision, remark, ...(extra?.() ?? {}) });
      toast(decision === 'Approved' ? `${label} approved.` : decision === 'Rework' ? `Changes requested on ${label}.` : `${label} rejected.`);
      onDone();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <>
      {error && <Alert kind="error">{error}</Alert>}
      <Field label="Comment to the faculty member" hint="Required when requesting changes or rejecting. Only the faculty member and the Office of Research see it."><TextArea value={remark} onChange={setRemark} /></Field>
      <div className="btn-row">
        <button className="btn ok" disabled={busy} onClick={() => decide('Approved')}>Approve</button>
        <button className="btn warn" disabled={busy} onClick={() => decide('Rework')}>Request changes</button>
        <button className="btn danger" disabled={busy} onClick={() => decide('Rejected')}>Reject</button>
      </div>
    </>
  );
}

/**
 * Opening a submitted entry starts its review (Submitted → Under Review). Returns the status and history to show,
 * updated straight away so the reviewer sees the step they just took.
 */
function useStartReview(path: string, r: { status: Status; history: HistoryItem[] }) {
  const { user } = useStore();
  const [live, setLive] = useState({ status: r.status, history: r.history });
  useEffect(() => {
    if (!path) return;
    adminApi('POST', path).then(() => setLive({ status: 'UnderReview', history: [...r.history, { at: new Date().toISOString(), by: user?.name ?? 'Office of Research', action: 'Review started' }] })).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);
  return live;
}

function ReviewEntry({ inst, db, kind, r, onClose, onDone }: { inst: { id: string; name: string }; db: DB; kind: EntityKind; r: AnyRecord; onClose: () => void; onDone: () => void }) {
  const cfg = ENTITIES[kind];
  const owner = db.faculty.find((f) => f.id === r.facultyId);
  const [sanction, setSanction] = useState(kind === 'seedMoney' ? (r as SeedMoney).requestedAmount : 0);
  const base = '/office/approvals';
  const live = useStartReview(r.status === 'Submitted' ? `${base}/${kind}/${encodeURIComponent(r.id)}/start` : '', r);
  return (
    <Modal title={<>{cfg.label} {r.id} <span style={{ marginLeft: 8 }}><StatusBadge status={live.status} history={live.history} /></span></>} onClose={onClose}>
      <ProgressTracker status={live.status} history={live.history} />
      <dl className="kv">
        <dt>Institution</dt><dd>{inst.name}</dd>
        <dt>Entered by</dt><dd>{owner ? `${owner.title} ${owner.name} (${owner.id}), ${owner.designation}, ${owner.department}` : r.facultyId}</dd>
        {cfg.details(r).map(([key, v]) => <div key={key} style={{ display: 'contents' }}><dt>{key}</dt><dd>{v}</dd></div>)}
      </dl>
      <Conversation history={live.history} />
      {isAwaitingOffice(r.status) && (
        <div className="panel" style={{ marginTop: 12 }}>
          <h3 className="panel-title">Review</h3>
          {kind === 'seedMoney' && (
            <Field label="Sanctioned amount (₹)" hint={`Requested ₹${(r as SeedMoney).requestedAmount.toLocaleString('en-IN')}`}><NumberInput value={sanction} onChange={setSanction} min={0} /></Field>
          )}
          <Decide path={`${base}/${kind}/${encodeURIComponent(r.id)}/review`} label={`${cfg.label} ${r.id}`} extra={() => (kind === 'seedMoney' ? { sanctionedAmount: sanction } : {})} onDone={onDone} />
        </div>
      )}
      {kind === 'grants' && r.status === 'Approved' && <GrantOutcome path={`${base}/grants/${encodeURIComponent(r.id)}/outcome`} g={r as Grant} onDone={onDone} />}
    </Modal>
  );
}

export function GrantOutcome({ path, g, onDone }: { path: string; g: Grant; onDone: () => void }) {
  const toast = useToast();
  const [o, setO] = useState({ outcome: g.outcome, sanctionDate: g.sanctionDate, sanctionedAmount: g.sanctionedAmount, receivedAmount: g.receivedAmount });
  const [error, setError] = useState('');
  const save = async () => {
    if (o.receivedAmount > o.sanctionedAmount) { setError('Received amount cannot exceed the sanctioned amount.'); return; }
    try { await adminApi('POST', path, o); toast('Funding outcome saved.'); onDone(); } catch (e) { setError((e as Error).message); }
  };
  return (
    <div className="panel" style={{ marginTop: 12 }}>
      <h3 className="panel-title">Funding outcome</h3>
      {error && <Alert kind="error">{error}</Alert>}
      <div className="grid">
        <Field label="Outcome"><Select value={o.outcome} onChange={(v) => setO({ ...o, outcome: v as Grant['outcome'] })} options={GRANT_OUTCOMES} /></Field>
        <Field label="Sanction date"><input type="date" value={o.sanctionDate} onChange={(e) => setO({ ...o, sanctionDate: e.target.value })} /></Field>
        <Field label="Sanctioned (₹)"><NumberInput value={o.sanctionedAmount} onChange={(v) => setO({ ...o, sanctionedAmount: v })} min={0} /></Field>
        <Field label="Received (₹)"><NumberInput value={o.receivedAmount} onChange={(v) => setO({ ...o, receivedAmount: v })} min={0} /></Field>
      </div>
      <div className="btn-row"><button className="btn" onClick={save}>Save outcome</button></div>
    </div>
  );
}

const PROFILE_ROWS: [string, (b: Biodata) => ReactNode][] = [
  ['Biography', (b) => b.summary], ['Research interests', (b) => b.researchInterests], ['Areas of expertise', (b) => b.expertise], ['Keywords', (b) => b.keywords],
  ['SDGs', (b) => b.sdgs.map((n) => `SDG ${n}`).join(', ')], ['Google Scholar link', (b) => b.googleScholar],
  ['Google Scholar metrics', (b) => (b.scholar.citations == null && b.scholar.hIndex == null && b.scholar.i10Index == null ? '' : `Citations ${b.scholar.citations ?? '—'} · h-index ${b.scholar.hIndex ?? '—'} · i10-index ${b.scholar.i10Index ?? '—'}`)],
  ['Photograph', (b) => (b.photo ? <img src={b.photo} alt="" style={{ width: 64, borderRadius: 6 }} /> : '')],
  ['Date of birth', (b) => b.dob], ['Gender', (b) => b.gender], ['Address', (b) => b.address], ['Ph.D. guided / ongoing', (b) => `${b.phdGuided} / ${b.phdOngoing}`],
  ['Qualifications', (b) => b.qualifications.map((q) => `${q.degree} ${q.specialization}, ${q.institution} ${q.year}`).join('; ')],
  ['Experience', (b) => b.experience.map((x) => `${x.designation}, ${x.organisation} (${x.from}–${x.to})`).join('; ')],
  ['Memberships', (b) => b.memberships.map((m) => `${m.type}, ${m.body}`).join('; ')],
];

/** Side by side: the approved profile and the proposed update. Approving replaces the approved profile. */
function ReviewProfile({ inst, change: c, faculty: f, current, onClose, onDone }: { inst: { id: string; name: string }; change: ProfileChange; faculty?: Faculty; current: Biodata | null; onClose: () => void; onDone: () => void }) {
  const show = (v: ReactNode) => (v === '' || v == null ? <span className="muted">—</span> : v);
  const contact: [string, string, string][] = (['email', 'phone', 'orcid', 'scopusId'] as const).map((k) => [({ email: 'Email', phone: 'Phone', orcid: 'ORCID', scopusId: 'Scopus ID' })[k], f?.[k] ?? '', c.contact[k]]);
  const live = useStartReview(c.status === 'Submitted' ? `/office/approvals/profiles/${encodeURIComponent(c.id)}/start` : '', c);
  return (
    <Modal title={<>Profile update {c.id} <span style={{ marginLeft: 8 }}><StatusBadge status={live.status} history={live.history} /></span></>} onClose={onClose}>
      <ProgressTracker status={live.status} history={live.history} />
      <p style={{ marginTop: 0 }}><b>{f ? `${f.title} ${f.name}` : c.facultyId}</b> · {f?.designation}, {f?.department} · {inst.name}</p>
      <p className="muted">Changed: {c.changed.join(', ')}</p>
      <div className="tbl-wrap">
        <table className="tbl diff">
          <thead><tr><th>Field</th><th>Approved now</th><th>Proposed</th></tr></thead>
          <tbody>
            {contact.map(([l, a, b]) => <tr key={l} className={a !== b ? 'changed' : ''}><td>{l}</td><td>{show(a)}</td><td>{show(b)}</td></tr>)}
            {PROFILE_ROWS.map(([l, fn]) => {
              const a = current ? fn(current) : ''; const b = fn(c.biodata);
              const differs = JSON.stringify(a) !== JSON.stringify(b);
              return <tr key={l} className={differs ? 'changed' : ''}><td>{l}</td><td>{show(a)}</td><td>{show(b)}</td></tr>;
            })}
          </tbody>
        </table>
      </div>
      <Conversation history={live.history} />
      {isAwaitingOffice(c.status) && (
        <div className="panel" style={{ marginTop: 12 }}>
          <h3 className="panel-title">Review</h3>
          <Decide path={`/office/approvals/profiles/${encodeURIComponent(c.id)}/review`} label={`Profile update ${c.id}`} onDone={onDone} />
        </div>
      )}
    </Modal>
  );
}

// ---------------- Add a user (the only way accounts are created) ----------------

function AddUser({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const { db, institution } = useStore();
  const departments = db.settings.departments;
  const [f, setF] = useState({ role: 'faculty' as 'faculty' | 'management', title: 'Dr.', name: '', email: '', employeeCode: '', department: departments[0] ?? '', designation: 'Assistant Professor', status: 'active' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{ email: string; password: string; name: string; active: boolean } | null>(null);
  const u = (p: Partial<typeof f>) => setF({ ...f, ...p });
  const save = async () => {
    setBusy(true);
    try {
      const r = await adminApi<{ temporaryPassword: string }>('POST', '/office/users', f);
      setCreated({ email: f.email.trim().toLowerCase(), password: r.temporaryPassword, name: f.name, active: f.status === 'active' });
      toast(`Account created for ${f.name}.`); setError(''); onDone(); void reloadData();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Modal title={`Add user · ${institution?.name ?? ''}`} onClose={onClose}>
      {created ? (
        <>
          <Alert kind="success">Account created for <b>{created.name}</b>{created.active ? '' : ' (not active yet; activate it under Users when they should start)'}. Give them these sign-in details through a trusted channel. The password is shown only once; they can change it under Settings → Change Password.</Alert>
          <dl className="kv"><dt>Email</dt><dd>{created.email}</dd><dt>Temporary password</dt><dd><b style={{ fontFamily: 'monospace', fontSize: 16 }}>{created.password}</b></dd></dl>
          <div className="btn-row"><button className="btn secondary" onClick={() => { setCreated(null); setF({ ...f, name: '', email: '', employeeCode: '' }); }}>Add another</button><button className="btn" onClick={onClose}>Done</button></div>
        </>
      ) : (
        <>
          {error && <Alert kind="error">{error}</Alert>}
          <div className="grid g2">
            <Field label="Role" required><Select value={f.role} onChange={(v) => u({ role: v as 'faculty' | 'management', designation: v === 'faculty' ? 'Assistant Professor' : '' })} options={[{ value: 'faculty', label: 'Faculty' }, { value: 'management', label: 'Top-Level Management' }]} /></Field>
            <Field label="Account status"><Select value={f.status} onChange={(v) => u({ status: v })} options={[{ value: 'active', label: 'Active (can sign in now)' }, { value: 'deactivated', label: 'Not active yet' }]} /></Field>
            <Field label="Title"><Select value={f.title} onChange={(v) => u({ title: v })} options={['Dr.', 'Prof.', 'Mr.', 'Ms.', 'Mrs.', '']} /></Field>
            <Field label="Full name" required><Input value={f.name} onChange={(v) => u({ name: v })} /></Field>
            <Field label="Institutional email" required className="span2" hint={institution?.emailDomain ? `Usually ending in @${institution.emailDomain}` : undefined}><Input value={f.email} onChange={(v) => u({ email: v })} type="email" /></Field>
            {f.role === 'faculty' && <>
              <Field label="Employee code" required><Input value={f.employeeCode} onChange={(v) => u({ employeeCode: v })} /></Field>
              <Field label="Department" required><Select value={f.department} onChange={(v) => u({ department: v })} options={departments} /></Field>
            </>}
            <Field label="Designation" className={f.role === 'faculty' ? 'span2' : ''}>
              {f.role === 'faculty'
                ? <Select value={f.designation} onChange={(v) => u({ designation: v })} options={['Professor', 'Associate Professor', 'Assistant Professor', 'Professor of Practice', 'Adjunct Faculty']} />
                : <Input value={f.designation} onChange={(v) => u({ designation: v })} placeholder="e.g. Director, Dean (Research), Registrar" />}
            </Field>
          </div>
          <p className="note">A temporary password is generated and shown once. For faculty, the employee code links the account to their faculty profile (created if it does not exist yet).</p>
          <div className="btn-row"><button className="btn secondary" onClick={onClose}>Cancel</button><button className="btn ok" disabled={busy} onClick={save}>{busy ? 'Creating…' : 'Create account'}</button></div>
        </>
      )}
    </Modal>
  );
}

// ---------------- Users ----------------

const ROLE_ORDER: Record<string, number> = { office: 0, management: 1, faculty: 2 };
/** "Faculty B" before "Faculty AA": placeholder letter codes sort like spreadsheet columns, real names alphabetically. */
const nameKey = (n: string) => n.split(' ').map((w) => (/^[A-Z]{1,3}$/.test(w) ? `${w.length}${w}` : w)).join(' ');
const byRoleThenName = (a: Account, b: Account) => (ROLE_ORDER[a.role] ?? 9) - (ROLE_ORDER[b.role] ?? 9) || nameKey(a.name).localeCompare(nameKey(b.name), undefined, { numeric: true, sensitivity: 'base' });

export function AdminUsers() {
  const users = useAdmin<Account[]>('/office/users');
  const toast = useToast();
  const [filter, setFilter] = useState({ role: '', status: '', q: '' });
  const [open, setOpen] = useState<Account | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [temp, setTemp] = useState('');
  const [adding, setAdding] = useState(false);
  const all = useMemo(() => [...(users.data ?? [])].sort(byRoleThenName), [users.data]);
  const rows = all.filter((a) => (!filter.role || a.role === filter.role)
    && (!filter.status || a.status === filter.status) && (!filter.q || `${a.name} ${a.email} ${a.employeeCode}`.toLowerCase().includes(filter.q.toLowerCase())));
  const act = async (path: string, body: unknown, msg: string) => {
    try {
      const r = await adminApi<{ temporaryPassword?: string }>('POST', path, body);
      if (r.temporaryPassword) setTemp(r.temporaryPassword);
      else { setOpen(null); }
      toast(msg); setError(''); setReason(''); users.reload();
    } catch (e) { setError((e as Error).message); }
  };
  const cols: Column<Account>[] = [
    { key: 'name', label: 'Name', value: (a) => `${a.name} <${a.email}>`, className: 'person-cell', render: (a) => <><b>{a.name}</b><small>{a.email}</small></> },
    { key: 'role', label: 'Role', value: (a) => ROLE[a.role] },
    { key: 'dept', label: 'Department', value: (a) => a.department || '—' },
    { key: 'desig', label: 'Designation', value: (a) => a.designation || '—' },
    { key: 'profile', label: 'Emp. code', value: (a) => a.facultyId ?? '—', className: 'nowrap' },
    { key: 'status', label: 'Status', value: (a) => a.status, render: (a) => statusBadge(a.status) },
    { key: 'added', label: 'Added', value: (a) => a.requestedAt, render: (a) => fmtDate(a.requestedAt), className: 'nowrap' },
  ];
  return (
    <>
      <PageTitle sub="Create and manage faculty and Top-Level Management accounts for your institution.">User Management</PageTitle>
      <Panel size="wide" actions={<button className="btn sm" onClick={() => setAdding(true)}>+ Add user</button>}>
        <div className="role-chips" role="group" aria-label="Accounts by role">
          {([['', 'All accounts'], ['faculty', 'Faculty'], ['management', 'Top-Level Management'], ['office', 'Office of Research']] as const).map(([role, label]) => (
            <button key={role} type="button" className={filter.role === role ? 'on' : ''} aria-pressed={filter.role === role} onClick={() => setFilter({ ...filter, role })}>
              {label}<span>{role ? all.filter((a) => a.role === role).length : all.length}</span>
            </button>
          ))}
        </div>
        <div className="filters" style={{ marginBottom: 10 }}>
          <Field label="Search"><Input value={filter.q} onChange={(v) => setFilter({ ...filter, q: v })} placeholder="Name, email or code" type="search" /></Field>
          <Field label="Status"><Select value={filter.status} onChange={(v) => setFilter({ ...filter, status: v })} options={['active', 'suspended', 'deactivated']} placeholder="All" /></Field>
        </div>
        {users.error && <Alert kind="error">{users.error}</Alert>}
        <DataTable rows={rows} columns={cols} rowKey={(a) => a.id} onRowClick={(a) => { setOpen(a); setTemp(''); setError(''); }} exportName="platform_users" pageSize={20} />
        <p className="note">Add faculty and Top-Level Management accounts here and give each person their email and temporary password. Open a user to suspend, deactivate, reactivate, change role or reset their password. Suspending signs them out at once. Office of Research accounts are provisioned by the UniRise team.</p>
      </Panel>
      {adding && <AddUser onClose={() => setAdding(false)} onDone={() => users.reload()} />}
      {open && (
        <Modal title={`${open.name} · ${ROLE[open.role]}`} onClose={() => setOpen(null)}>
          {error && <Alert kind="error">{error}</Alert>}
          <dl className="kv">
            <dt>Email</dt><dd>{open.email}</dd>
            {open.department && <><dt>Department</dt><dd>{open.department}</dd></>}
            <dt>Status</dt><dd>{statusBadge(open.status)}</dd>
            {open.facultyId && <><dt>Faculty profile</dt><dd>{open.facultyId}</dd></>}
            <dt>Approved</dt><dd>{open.reviewedBy ?? '—'} {fmtDate(open.reviewedAt ?? '')}</dd>
          </dl>
          {open.role !== 'office' && (
            <div className="panel" style={{ marginTop: 14 }}>
              <Field label="Reason" hint="Needed to suspend or deactivate; recorded in the audit log"><Input value={reason} onChange={setReason} /></Field>
              <div className="btn-row">
                {open.status !== 'active' && <button className="btn ok" onClick={() => act(`/office/users/${open.id}/status`, { status: 'active', reason }, `${open.name} reactivated.`)}>Activate</button>}
                {open.status === 'active' && <button className="btn warn" onClick={() => act(`/office/users/${open.id}/status`, { status: 'suspended', reason }, `${open.name} suspended.`)}>Suspend</button>}
                {open.status !== 'deactivated' && <button className="btn danger" onClick={() => act(`/office/users/${open.id}/status`, { status: 'deactivated', reason }, `${open.name} deactivated.`)}>Deactivate</button>}
                {open.role === 'faculty'
                  ? <button className="btn secondary" onClick={() => act(`/office/users/${open.id}/role`, { role: 'management' }, `${open.name} is now Top-Level Management.`)}>Make Top-Level Management</button>
                  : open.facultyId && <button className="btn secondary" onClick={() => act(`/office/users/${open.id}/role`, { role: 'faculty' }, `${open.name} is now Faculty.`)}>Make Faculty</button>}
                <button className="btn secondary" onClick={() => act(`/office/users/${open.id}/reset-password`, {}, 'Temporary password created.')}>Reset password</button>
              </div>
              {temp && <Alert kind="success">Temporary password: <b style={{ fontFamily: 'monospace' }}>{temp}</b>. Give it to {open.name} through a trusted channel; it is shown only once. They should change it after signing in.</Alert>}
            </div>
          )}
        </Modal>
      )}
    </>
  );
}

// ---------------- Audit ----------------

export function AdminAudit() {
  const audit = useAdmin<{ id: number; at: string; actor_name: string | null; action: string; target: string | null; institution_id: string | null; detail: string }[]>('/office/audit');
  return (
    <>
      <PageTitle sub="Every sign-in, account change and approval decision, newest first.">Audit Log</PageTitle>
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
      </Panel>
    </>
  );
}
