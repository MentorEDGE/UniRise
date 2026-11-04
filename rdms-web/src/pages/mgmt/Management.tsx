import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { BarCard } from '../../components/charts';
import { Alert, Attainment, DataTable, Field, Input, PageTitle, Panel, Select, StatusBadge, Tabs, useToast } from '../../components/ui';
import type { Column } from '../../components/ui';
import { dateOf, facultyStats, fmtDate, lakh, pendingCount, trend, uniqueCounts } from '../../lib/analytics';
import { ENTITIES, listColumns } from '../../lib/entities';
import { creditedFaculty, saveFaculty, useStore } from '../../lib/store';
import type { AnyRecord, EntityKind, Faculty } from '../../lib/types';
import { ENTITY_LABEL } from '../../lib/types';
import { RecordDetail } from '../shared/RecordDetail';
import { departmentRows, Tile } from './Analytics';
import { useAnalyticsFilter } from './filters';

const KINDS: EntityKind[] = ['publications', 'grants', 'seedMoney', 'fdps', 'conferences'];

// ---------------- Dashboard ----------------

export function ManagementDashboard() {
  const { db, user } = useStore();
  const { filter, bar } = useAnalyticsFilter();
  const u = useMemo(() => uniqueCounts(db, filter), [db, filter]);
  const stats = useMemo(() => facultyStats(db, filter), [db, filter]);
  const depts = useMemo(() => departmentRows(db, filter), [db, filter]);
  const pending = KINDS.map((k) => ({ k, n: (db[k] as AnyRecord[]).filter((r) => r.status === 'Submitted' && (!filter.department || db.faculty.find((f) => f.id === r.facultyId)?.department === filter.department)).length }));
  const totalPending = pendingCount(db, filter.department);
  const n = stats.length || 1;
  const t = db.settings.targets;
  const yearAgo = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
  const inactive = stats.filter((s) => !s.lastActivity || s.lastActivity < yearAgo).length;
  // Like-for-like: the same span one year earlier, cut at today's date for the running year.
  const prevU = useMemo(() => {
    if (!filter.from) return null;
    const shift = (iso: string) => `${Number(iso.slice(0, 4)) - 1}${iso.slice(4)}`;
    const todayIso = new Date().toISOString().slice(0, 10);
    const end = filter.to > todayIso ? todayIso : filter.to;
    return uniqueCounts(db, { from: shift(filter.from), to: shift(end), department: filter.department });
  }, [db, filter.from, filter.to, filter.department]);
  const delta = (a?: number, b?: number) => (a == null || b == null ? '' : b === a ? '±0 vs same period last year' : `${b > a ? '▲' : '▼'} ${Math.abs(b - a).toLocaleString('en-IN')} vs same period last year`);

  const recent = KINDS.flatMap((k) => (db[k] as AnyRecord[]).filter((r) => r.status === 'Submitted').map((r) => ({ k, r }))).sort((a, b) => b.r.updatedAt.localeCompare(a.r.updatedAt)).slice(0, 8);
  const byId = new Map(db.faculty.map((f) => [f.id, f]));

  return (
    <>
      <PageTitle>Management Dashboard</PageTitle>
      <Panel size="wide">
        <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, alignItems: 'end' }}>
          <div><b>Welcome, {user?.name}</b><div className="muted">{user?.designation} · {db.settings.institutionName}</div></div>
          {bar}
        </div>
      </Panel>
      <div style={{ maxWidth: 1180, margin: '0 auto 14px' }}>
        <div className="tiles">
          <Tile label="Pending approvals" value={totalPending} sub={pending.filter((p) => p.n).map((p) => `${p.n} ${ENTITY_LABEL[p.k]}`).join(' · ') || 'Nothing waiting'} to="/approvals" />
          <Tile label="Publications" value={u.pubs.length} sub={prevU ? delta(prevU.pubs.length, u.pubs.length) : `${(u.pubs.length / n).toFixed(1)} per faculty`} to="/analytics" />
          <Tile label="Sanctioned funding" value={lakh(u.sanctionedAmount)} sub={`${u.sanctioned.length} of ${u.grants.length} proposals`} to="/reports/grants" />
          <Tile label="FDP hours" value={u.fdpHours.toLocaleString('en-IN')} sub={prevU ? delta(prevU.fdpHours, u.fdpHours) : ''} to="/analytics/participation" />
          <Tile label="Conferences" value={u.confs.length} sub={prevU ? delta(prevU.confs.length, u.confs.length) : ''} to="/conferences" />
          <Tile label="Inactive faculty" value={inactive} sub="No approved activity in 12 months" to="/analytics/participation" />
        </div>
      </div>
      <div className="cards">
        <section className="card">
          <h3>Awaiting your approval</h3><p className="sub">Most recent submissions</p>
          {recent.length ? (
            <table className="tbl"><tbody>{recent.map(({ k, r }) => (
              <tr key={r.id}><td>{ENTITY_LABEL[k]}</td><td className="title-cell">{ENTITIES[k].title(r)}</td><td>{byId.get(r.facultyId)?.name}</td><td>{fmtDate(r.updatedAt)}</td></tr>
            ))}</tbody></table>
          ) : <p className="muted">Nothing is waiting for approval.</p>}
          <div className="btn-row left"><Link className="btn sm" to="/approvals">Open approval inbox</Link></div>
        </section>
        <section className="card">
          <h3>Target attainment by department</h3><p className="sub">Faculty meeting the publication ({t.publicationsPerFaculty}) and FDP ({t.fdpHoursPerFaculty} h) targets</p>
          <table className="tbl"><thead><tr><th>Dept.</th><th>Publications</th><th>FDP hours</th></tr></thead>
            <tbody>{depts.filter((d) => !filter.department || d.dept === filter.department).map((d) => <tr key={d.dept}><td title={d.dept}>{d.short}</td><td><Attainment value={d.pubAtt} target={100} /></td><td><Attainment value={d.fdpAtt} target={100} /></td></tr>)}</tbody>
          </table>
          <div className="btn-row left"><Link className="btn sm" to="/analytics/departments">Compare departments</Link></div>
        </section>
        <BarCard title="Activity by department" sub="Approved entries in the period" data={depts.filter((d) => !filter.department || d.dept === filter.department).map((d) => ({ d: d.short, pubs: d.pubs, proposals: d.proposals, confs: Math.round(d.confPF * d.faculty) }))}
          xKey="d" xLabel="Department" series={[{ key: 'pubs', label: 'Publications' }, { key: 'proposals', label: 'Grant proposals' }, { key: 'confs', label: 'Conferences' }]} />
        <section className="card">
          <h3>Top performers</h3><p className="sub">Weighted score in the period</p>
          <table className="tbl"><tbody>{stats.slice(0, 8).map((s, i) => (
            <tr key={s.faculty.id}><td>{i + 1}</td><td><Link to={`/faculty/${s.faculty.id}`}>{s.faculty.title} {s.faculty.name}</Link></td><td className="muted">{s.faculty.department}</td><td className="num"><b>{s.score}</b></td></tr>
          ))}</tbody></table>
          <div className="btn-row left"><Link className="btn sm" to="/analytics/faculty">Full ranking</Link></div>
        </section>
        <InstitutionOverview filter={filter} />
        <section className="card span-all">
          <h3>Notices</h3>
          {db.notices.slice(0, 3).map((x) => <div className="notice" key={x.id}><b>{x.title}</b>{x.body} <small>· {fmtDate(x.at)}</small></div>)}
          <div className="btn-row left"><Link className="btn sm" to="/settings/notices">Manage notices</Link></div>
        </section>
      </div>
    </>
  );
}

// ---------------- Approvals ----------------

export function Approvals() {
  const { db } = useStore();
  const [kind, setKind] = useState<EntityKind>(() => KINDS.find((k) => (db[k] as AnyRecord[]).some((r) => r.status === 'Submitted')) ?? 'publications');
  const [dept, setDept] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const byId = new Map(db.faculty.map((f) => [f.id, f]));
  const counts = Object.fromEntries(KINDS.map((k) => [k, (db[k] as AnyRecord[]).filter((r) => r.status === 'Submitted').length])) as Record<EntityKind, number>;
  const rows = (db[kind] as AnyRecord[]).filter((r) => r.status === 'Submitted' && (!dept || byId.get(r.facultyId)?.department === dept)).sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
  const cols: Column<AnyRecord>[] = [
    ...listColumns(db, kind, { showOwner: true }).filter((c) => c.key !== 'status'),
    { key: 'submitted', label: 'Submitted', value: (r) => r.updatedAt, render: (r) => fmtDate(r.updatedAt) },
    { key: 'wait', label: 'Waiting (days)', value: (r) => Math.max(0, Math.floor((Date.now() - Date.parse(r.updatedAt)) / 86400000)), num: true },
  ];
  return (
    <>
      <PageTitle>Approval</PageTitle>
      <Panel size="wide">
        <Tabs value={kind} onChange={setKind} tabs={KINDS.map((k) => ({ id: k, label: `${ENTITY_LABEL[k]} (${counts[k]})` }))} />
        <div className="filters" style={{ marginBottom: 8 }}>
          <Field label="Department"><Select value={dept} onChange={setDept} options={db.settings.departments} placeholder="All departments" /></Field>
          <span className="muted" style={{ paddingBottom: 6 }}>Oldest first. Open an entry to approve, send for rework or reject it.</span>
        </div>
        <DataTable rows={rows} columns={cols} rowKey={(r) => r.id} onRowClick={(r) => setOpenId(r.id)} exportName={`pending_${kind}`} empty={`No ${ENTITIES[kind].plural.toLowerCase()} are waiting for approval.`} />
      </Panel>
      {openId && <RecordDetail kind={kind} id={openId} onClose={() => setOpenId(null)} />}
    </>
  );
}

// ---------------- Faculty directory ----------------

export function FacultyDirectory() {
  const { db } = useStore();
  const { filter } = useAnalyticsFilter();
  const [params] = useSearchParams();
  const [q, setQ] = useState('');
  const [dept, setDept] = useState(params.get('dept') ?? '');
  const [showInactive, setShowInactive] = useState(false);
  const stats = useMemo(() => new Map(facultyStats(db, { ...filter, department: '' }).map((s) => [s.faculty.id, s])), [db, filter]);
  const rows = db.faculty.filter((f) => (showInactive || f.active) && (!dept || f.department === dept) && (!q || `${f.name} ${f.id} ${f.email} ${f.orcid}`.toLowerCase().includes(q.toLowerCase())));
  const cols: Column<Faculty>[] = [
    { key: 'id', label: 'Emp. Code', value: (f) => f.id },
    { key: 'name', label: 'Name', value: (f) => f.name, render: (f) => <Link to={`/faculty/${f.id}`}>{f.title} {f.name}</Link> },
    { key: 'desig', label: 'Designation', value: (f) => f.designation },
    { key: 'dept', label: 'Department', value: (f) => f.department },
    { key: 'email', label: 'Email', value: (f) => f.email },
    { key: 'score', label: `Score (AY)`, value: (f) => stats.get(f.id)?.score ?? 0, num: true },
    { key: 'bio', label: 'Profile', value: (f) => stats.get(f.id)?.biodata ?? 0, render: (f) => (stats.has(f.id) ? `${stats.get(f.id)!.biodata}%` : '—'), num: true },
    { key: 'active', label: 'Status', value: (f) => (f.active ? 'Active' : 'Inactive'), render: (f) => <span className={`badge ${f.active ? 'Approved' : 'Draft'}`}>{f.active ? 'Active' : 'Inactive'}</span> },
  ];
  return (
    <>
      <PageTitle>Faculty Directory</PageTitle>
      <Panel size="wide" actions={<Link className="btn sm" to="/faculty/new">+ Add Faculty</Link>}>
        <div className="filters" style={{ marginBottom: 8 }}>
          <Field label="Search"><Input value={q} onChange={setQ} placeholder="Name, code, email or ORCID" type="search" /></Field>
          <Field label="Department"><Select value={dept} onChange={setDept} options={db.settings.departments} placeholder="All departments" /></Field>
          <label className="check" style={{ paddingBottom: 6 }}><input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> Show inactive</label>
        </div>
        <DataTable rows={rows} columns={cols} rowKey={(f) => f.id} exportName="faculty_directory" pageSize={20} />
      </Panel>
    </>
  );
}

export function FacultyForm() {
  const { id } = useParams();
  const { db } = useStore();
  const nav = useNavigate();
  const toast = useToast();
  const existing = id ? db.faculty.find((f) => f.id === id) : undefined;
  const [f, setF] = useState<Faculty>(() => existing ? { ...existing } : { id: '', title: 'Dr.', name: '', designation: 'Assistant Professor', department: db.settings.departments[0], email: '', phone: '', joiningDate: new Date().toISOString().slice(0, 10), orcid: '', scopusId: '', active: true });
  const [error, setError] = useState('');
  if (id && !existing) return <Panel><Alert kind="error">Faculty member not found.</Alert></Panel>;
  const u = (p: Partial<Faculty>) => setF({ ...f, ...p });
  const save = async () => {
    if (!f.email.trim() || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email)) { setError('Enter a valid email address.'); return; }
    try {
      await saveFaculty({ ...f, id: f.id.trim(), name: f.name.trim() }, !existing);
      toast(existing ? 'Faculty details saved.' : `Faculty profile ${f.id} added. They can now request access; the platform administrator links their account to this profile.`);
      nav(`/faculty/${f.id.trim()}`);
    } catch (e) { setError((e as Error).message); }
  };
  return (
    <>
      <PageTitle>{existing ? 'Edit Faculty' : 'Add Faculty'}</PageTitle>
      <Panel size="wide" title="Faculty Details">
        {error && <Alert kind="error">{error}</Alert>}
        <div className="grid">
          <Field label="Employee Code" required><Input value={f.id} onChange={(v) => u({ id: v })} disabled={!!existing} /></Field>
          <Field label="Title"><Select value={f.title} onChange={(v) => u({ title: v })} options={['Dr.', 'Prof.', 'Mr.', 'Ms.', 'Mrs.']} /></Field>
          <Field label="Full Name" required className="span2"><Input value={f.name} onChange={(v) => u({ name: v })} /></Field>
          <Field label="Designation"><Select value={f.designation} onChange={(v) => u({ designation: v })} options={['Professor', 'Associate Professor', 'Assistant Professor', 'Professor of Practice', 'Adjunct Faculty']} /></Field>
          <Field label="Department"><Select value={f.department} onChange={(v) => u({ department: v })} options={db.settings.departments} /></Field>
          <Field label="Email" required><Input value={f.email} onChange={(v) => u({ email: v })} type="email" /></Field>
          <Field label="Phone"><Input value={f.phone} onChange={(v) => u({ phone: v })} /></Field>
          <Field label="Date of Joining"><input type="date" value={f.joiningDate} onChange={(e) => u({ joiningDate: e.target.value })} /></Field>
          <Field label="ORCID"><Input value={f.orcid} onChange={(v) => u({ orcid: v })} /></Field>
          <Field label="Scopus ID"><Input value={f.scopusId} onChange={(v) => u({ scopusId: v })} /></Field>
          <Field label="Status"><Select value={f.active ? 'Active' : 'Inactive'} onChange={(v) => u({ active: v === 'Active' })} options={['Active', 'Inactive']} /></Field>
        </div>
        {!existing && <p className="note">This creates the faculty profile only. To sign in, the person requests access with this employee code; the UniRise platform administrator verifies them and links the account.</p>}
        {existing && !f.active && <p className="note">Inactive faculty cannot sign in and are left out of analytics. Their records are kept.</p>}
        <div className="btn-row"><button className="btn secondary" onClick={() => nav(-1)}>Cancel</button><button className="btn ok" onClick={save}>Save</button></div>
      </Panel>
    </>
  );
}

/** 360° view of one faculty member, for management (and reused by "View Profile"). */
export function Faculty360({ facultyId: given }: { facultyId?: string }) {
  const params = useParams();
  const facultyId = given ?? params.id!;
  const { db, user } = useStore();
  const { filter, bar, years, ay } = useAnalyticsFilter({ allowDept: false });
  const [tab, setTab] = useState<EntityKind>('publications');
  const [openId, setOpenId] = useState<string | null>(null);
  const f = db.faculty.find((x) => x.id === facultyId);
  const s = useMemo(() => facultyStats(db, { ...filter, department: '' }).find((x) => x.faculty.id === facultyId), [db, filter, facultyId]);
  const rows = useMemo(() => trend(db, '', [...years].sort().slice(-6), facultyId), [db, years, facultyId]);
  if (!f) return <Panel><Alert kind="error">Faculty member not found.</Alert></Panel>;
  const isMgmt = user?.role === 'management';
  const isSelf = user?.facultyId === facultyId;
  const showScores = isMgmt || isSelf;
  // A colleague's FDPs, conferences, grants and biodata are private: faculty only see their approved publications.
  const colleague = !isMgmt && !isSelf;
  const kinds: EntityKind[] = colleague ? ['publications'] : KINDS;
  const dept = (v: string) => (isMgmt ? ` · dept. avg ${v}` : '');
  const deptStats = facultyStats(db, { ...filter, department: f.department });
  const avg = (k: 'publications' | 'fdpHours' | 'conferences' | 'score') => deptStats.reduce((a, x) => a + x[k], 0) / (deptStats.length || 1);
  const records = (db[tab] as AnyRecord[]).filter((r) => creditedFaculty(tab, r).includes(facultyId) && (isMgmt || r.status === 'Approved'))
    .filter((r) => { const d = dateOf(tab, r); return (!filter.from || d >= filter.from) && (!filter.to || d <= filter.to); })
    .sort((a, b) => dateOf(tab, b).localeCompare(dateOf(tab, a)));
  const t = db.settings.targets;
  return (
    <>
      <PageTitle>Researcher Profile</PageTitle>
      <Panel size="wide">
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{f.title} {f.name} {!f.active && <span className="badge Draft">Inactive</span>}</div>
            <div>{f.designation}, {f.department}</div>
            <div className="muted">{f.id} · {f.email}{f.orcid && <> · ORCID <a href={`https://orcid.org/${f.orcid}`} target="_blank" rel="noreferrer">{f.orcid}</a></>}{f.scopusId && ` · Scopus ${f.scopusId}`} · joined {fmtDate(f.joiningDate)}</div>
          </div>
          <div className="row-actions" style={{ alignItems: 'start' }}>
            {!colleague && <Link className="btn sm" to={isMgmt ? `/faculty/${f.id}/biodata` : '/biodata'}>Profile / CV</Link>}
            {isMgmt && <Link className="btn sm secondary" to={`/faculty/${f.id}/edit`}>Edit details</Link>}
          </div>
        </div>
        <div style={{ marginTop: 10 }}>{bar}</div>
      </Panel>
      {s && (
        <div style={{ maxWidth: 1180, margin: '0 auto 14px' }}>
          <div className="tiles">
            {showScores && <Tile label="Score" value={s.score} sub={isMgmt ? `Dept. avg ${avg('score').toFixed(1)}` : 'Weighted score'} />}
            <Tile label="Publications" value={s.publications} sub={colleague ? 'Approved publications' : `Target ${t.publicationsPerFaculty}${dept(avg('publications').toFixed(1))}`} />
            <Tile label="Q1 + Q2" value={s.q1q2} sub={`${s.scopusWos} Scopus/WoS indexed`} />
            {!colleague && <Tile label="Grants" value={`${s.grantsApplied} / ${s.grantsSanctioned}`} sub={`applied / sanctioned · ${lakh(s.sanctionedAmount)} share`} />}
            {!colleague && <Tile label="FDP hours" value={s.fdpHours} sub={`Target ${t.fdpHoursPerFaculty}${dept(avg('fdpHours').toFixed(0))}`} />}
            {!colleague && <Tile label="Conferences" value={s.conferences} sub={`${s.confPresented} presented`} />}
            {showScores && <Tile label="Profile" value={`${s.biodata}%`} sub="complete" />}
          </div>
        </div>
      )}
      <div className="cards" style={{ marginBottom: 14 }}>
        <BarCard title="Publications by year" data={rows} xKey="ay" xLabel="Academic year" stacked series={[{ key: 'journal', label: 'Journal' }, { key: 'confPaper', label: 'Conference paper' }, { key: 'bookChapter', label: 'Book / chapter' }, { key: 'report', label: 'Tech report' }]} height={200} />
        {!colleague && <BarCard title="FDP hours by year" data={rows} xKey="ay" xLabel="Academic year" series={[{ key: 'fdpHours', label: 'FDP hours' }]} height={200} />}
        {!colleague && <BarCard title="Conferences by year" data={rows} xKey="ay" xLabel="Academic year" stacked series={[{ key: 'national', label: 'National' }, { key: 'international', label: 'International' }]} height={200} />}
      </div>
      <Panel size="wide" title={`Records${ay === 'all' ? '' : ` in AY ${ay}`}`}>
        <Tabs value={tab} onChange={setTab} tabs={kinds.map((k) => ({ id: k, label: ENTITY_LABEL[k] }))} />
        <DataTable rows={records} columns={listColumns(db, tab, { showOwner: false }).map((c) => (c.key === 'status' ? { ...c, render: (r: AnyRecord) => <StatusBadge status={r.status} /> } : c))}
          rowKey={(r) => r.id} onRowClick={(r) => setOpenId(r.id)} exportName={`${f.id}_${tab}`} empty={isMgmt ? 'No records in this period.' : 'No approved records in this period.'} />
      </Panel>
      {openId && <RecordDetail kind={tab} id={openId} onClose={() => setOpenId(null)} />}
    </>
  );
}


// ---------------- Institution overview on the dashboard ----------------

/** Departments, faculty, biodata, FDPs and conference participation of this institution, for the selected period. */
function InstitutionOverview({ filter }: { filter: { from: string; to: string; department: string } }) {
  const { db } = useStore();
  const stats = useMemo(() => facultyStats(db, filter), [db, filter]);
  const byId = new Map(db.faculty.map((f) => [f.id, f]));
  const people = db.faculty.filter((f) => f.active && (!filter.department || f.department === filter.department));
  const depts = db.settings.departments.filter((d) => !filter.department || d === filter.department);
  const inPeriod = (d: string) => (!filter.from || d >= filter.from) && (!filter.to || d <= filter.to);
  const mine = (id: string) => !filter.department || byId.get(id)?.department === filter.department;
  const fdps = db.fdps.filter((x) => x.status === 'Approved' && inPeriod(x.fromDate) && mine(x.facultyId)).sort((a, b) => b.fromDate.localeCompare(a.fromDate));
  const confs = db.conferences.filter((x) => x.status === 'Approved' && inPeriod(x.fromDate) && mine(x.facultyId)).sort((a, b) => b.fromDate.localeCompare(a.fromDate));
  const phd = people.filter((f) => db.biodata.find((b) => b.facultyId === f.id)?.qualifications.some((q) => q.degree.toLowerCase().includes('ph'))).length;
  const desig = ['Professor', 'Associate Professor', 'Assistant Professor'].map((d) => ({ d, n: people.filter((f) => f.designation === d).length }));
  const other = people.length - desig.reduce((a, x) => a + x.n, 0);
  const bio = [...stats].sort((a, b) => a.biodata - b.biodata);
  const avgBio = Math.round(stats.reduce((a, x) => a + x.biodata, 0) / (stats.length || 1));
  const who = (id: string) => { const f = byId.get(id); return f ? <Link to={`/faculty/${f.id}`}>{f.title} {f.name}</Link> : id; };
  return (
    <>
      <section className="card span-all">
        <h3>Departments</h3><p className="sub">Faculty strength and approved activity in the period</p>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>Department</th><th className="num">Faculty</th><th className="num">Prof.</th><th className="num">Assoc.</th><th className="num">Asst.</th><th className="num">Publications</th><th className="num">FDP hours</th><th className="num">Conferences</th><th className="num">Profile</th></tr></thead>
            <tbody>{depts.map((d) => {
              const s = stats.filter((x) => x.faculty.department === d);
              const n = (k: string) => s.filter((x) => x.faculty.designation === k).length;
              const u = uniqueCounts(db, { ...filter, department: d });
              return (
                <tr key={d}>
                  <td><Link to={`/faculty?dept=${encodeURIComponent(d)}`}>{d}</Link></td>
                  <td className="num">{s.length}</td><td className="num">{n('Professor')}</td><td className="num">{n('Associate Professor')}</td><td className="num">{n('Assistant Professor')}</td>
                  <td className="num">{u.pubs.length}</td><td className="num">{u.fdpHours}</td><td className="num">{u.confs.length}</td>
                  <td className="num">{s.length ? `${Math.round(s.reduce((a, x) => a + x.biodata, 0) / s.length)}%` : '—'}</td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
      </section>
      <section className="card">
        <h3>Faculty</h3><p className="sub">{people.length} active faculty{filter.department ? ` in ${filter.department}` : ''}</p>
        <table className="tbl"><tbody>
          {desig.map((x) => <tr key={x.d}><td>{x.d}</td><td className="num">{x.n}</td></tr>)}
          {other > 0 && <tr><td>Other designations</td><td className="num">{other}</td></tr>}
          <tr><td>Holding a Ph.D. (from profiles)</td><td className="num">{phd}</td></tr>
          <tr><td>With ORCID</td><td className="num">{people.filter((f) => f.orcid).length}</td></tr>
        </tbody></table>
        <div className="btn-row left"><Link className="btn sm" to="/faculty">Faculty directory</Link></div>
      </section>
      <section className="card">
        <h3>Faculty profiles</h3><p className="sub">Average completeness {avgBio}% · {stats.filter((x) => x.biodata >= 80).length} of {stats.length} at 80% or more</p>
        <table className="tbl"><tbody>{bio.slice(0, 6).map((x) => (
          <tr key={x.faculty.id}><td>{who(x.faculty.id)}</td><td className="muted">{x.faculty.department}</td><td style={{ width: 140 }}><Attainment value={x.biodata} target={100} /></td></tr>
        ))}</tbody></table>
        <div className="btn-row left"><Link className="btn sm" to="/analytics/participation">Incomplete profiles list</Link></div>
      </section>
      <section className="card">
        <h3>Faculty Development Programmes</h3><p className="sub">{fdps.length} approved in the period · {fdps.reduce((a, x) => a + x.hours, 0)} hours</p>
        <table className="tbl"><tbody>{fdps.slice(0, 6).map((x) => (
          <tr key={x.id}><td>{who(x.facultyId)}</td><td className="title-cell">{x.programmeType}: {x.title}</td><td className="num">{x.hours} h</td></tr>
        ))}</tbody></table>
        {!fdps.length && <p className="muted">No approved FDPs in this period.</p>}
        <div className="btn-row left"><Link className="btn sm" to="/fdp">All FDPs</Link><Link className="btn sm secondary" to="/reports/fdps?r=fdp-faculty">FDP reports</Link></div>
      </section>
      <section className="card">
        <h3>Conference participation</h3><p className="sub">{confs.length} approved in the period · {confs.filter((c) => c.level === 'International').length} international</p>
        <table className="tbl"><tbody>{confs.slice(0, 6).map((c) => (
          <tr key={c.id}><td>{who(c.facultyId)}</td><td className="title-cell">{c.participation}: {c.conferenceName}</td><td className="muted">{c.level}</td></tr>
        ))}</tbody></table>
        {!confs.length && <p className="muted">No approved conference participation in this period.</p>}
        <div className="btn-row left"><Link className="btn sm" to="/conferences">All conferences</Link><Link className="btn sm secondary" to="/reports/conferences?r=cnf-faculty">Conference reports</Link></div>
      </section>
    </>
  );
}
