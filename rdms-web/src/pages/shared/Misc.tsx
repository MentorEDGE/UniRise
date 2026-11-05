import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { Alert, Field, Input, NumberInput, PageTitle, Panel, Select, TextArea, useToast } from '../../components/ui';
import { DEFAULT_WEIGHTS } from '../../lib/seed';
import { addNotice, adminLogin, changePassword, deleteNotice, login, publicDepartments, publicInstitutions, register, saveSettings, useStore } from '../../lib/store';
import type { Registration } from '../../lib/store';
import type { Settings, Targets, Weights } from '../../lib/types';
import { MONTHS } from '../../lib/types';
import { fmtDate } from '../../lib/analytics';
import { Logo } from '../../components/Logo';
import { ThemeToggle } from '../../components/ThemeToggle';
import { LandingHero, LandingShowcase } from './Landing';

// ---------------- View researcher profile ----------------

export function ProfileSearch() {
  const { db } = useStore();
  const nav = useNavigate();
  const [by, setBy] = useState<'id' | 'orcid' | 'scopus'>('id');
  const [q, setQ] = useState('');
  const [error, setError] = useState('');
  const search = (e: React.FormEvent) => {
    e.preventDefault();
    const s = q.trim().toLowerCase();
    const f = db.faculty.find((x) => (by === 'id' ? x.id.toLowerCase() === s : by === 'orcid' ? x.orcid.toLowerCase() === s : x.scopusId === s));
    if (!f) { setError('No researcher found for that ID.'); return; }
    nav(`/faculty/${f.id}`);
  };
  return (
    <>
      <PageTitle>Employee Detail Search</PageTitle>
      <Panel>
        <form onSubmit={search}>
          <div style={{ display: 'flex', gap: 18, marginBottom: 6 }} role="radiogroup">
            {([['id', 'Employee ID'], ['orcid', 'ORCID'], ['scopus', 'Scopus ID']] as const).map(([k, l]) => (
              <label key={k} className="check"><input type="radio" name="by" checked={by === k} onChange={() => setBy(k)} /> {l}</label>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div style={{ width: 240 }}><Input value={q} onChange={(v) => { setQ(v); setError(''); }} aria-label="Search value" list="profile-ids" placeholder={by === 'id' ? 'EMP1001' : by === 'orcid' ? '0000-0000-0000-0000' : 'Scopus author ID'} /></div>
            <button className="btn" type="submit">Search</button>
          </div>
          <datalist id="profile-ids">{db.faculty.filter((f) => f.active).map((f) => <option key={f.id} value={by === 'id' ? f.id : by === 'orcid' ? f.orcid : f.scopusId}>{f.name}</option>)}</datalist>
          {error && <Alert kind="error">{error}</Alert>}
        </form>
      </Panel>
    </>
  );
}

// ---------------- Settings (management) ----------------

function useSettingsDraft() {
  const { db } = useStore();
  const toast = useToast();
  const [s, setS] = useState<Settings>(() => structuredClone(db.settings));
  const [error, setError] = useState('');
  const save = async () => { try { await saveSettings(s); setError(''); toast('Settings saved.'); } catch (e) { setError((e as Error).message); } };
  return { s, setS, save, error, db };
}

export function InstitutionSettings() {
  const { s, setS, save, error, db } = useSettingsDraft();
  const [newDept, setNewDept] = useState('');
  const inUse = (d: string) => db.faculty.some((f) => f.department === d);
  return (
    <>
      <PageTitle>Institution & Departments</PageTitle>
      <Panel title="Institution" size="wide">
        {error && <Alert kind="error">{error}</Alert>}
        <div className="grid">
          <Field label="Institution name" required className="span2" hint="Shown in the header instead of a logo"><Input value={s.institutionName} onChange={(v) => setS({ ...s, institutionName: v })} /></Field>
          <Field label="Tagline" className="span2"><Input value={s.institutionTagline} onChange={(v) => setS({ ...s, institutionTagline: v })} /></Field>
          <Field label="Academic year starts in"><select value={s.academicYearStartMonth} onChange={(e) => setS({ ...s, academicYearStartMonth: Number(e.target.value) })}>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select></Field>
          <Field label="Seed money window"><select value={s.seedMoneyWindowOpen ? 'open' : 'closed'} onChange={(e) => setS({ ...s, seedMoneyWindowOpen: e.target.value === 'open' })}><option value="open">Open – accepting proposals</option><option value="closed">Closed for this quarter</option></select></Field>
        </div>
      </Panel>
      <Panel title="Departments" size="wide">
        <table className="tbl">
          <thead><tr><th>Department</th><th className="num">Faculty</th><th /></tr></thead>
          <tbody>{s.departments.map((d) => (
            <tr key={d}><td>{d}</td><td className="num">{db.faculty.filter((f) => f.department === d).length}</td>
              <td><button className="link-btn" disabled={inUse(d)} title={inUse(d) ? 'Move its faculty to another department first' : undefined} onClick={() => setS({ ...s, departments: s.departments.filter((x) => x !== d) })}>Remove</button></td></tr>
          ))}</tbody>
        </table>
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <div style={{ flex: 1 }}><Input value={newDept} onChange={setNewDept} placeholder="New department name" aria-label="New department" /></div>
          <button className="btn" onClick={() => { const d = newDept.trim(); if (d && !s.departments.includes(d)) { setS({ ...s, departments: [...s.departments, d] }); setNewDept(''); } }}>Add</button>
        </div>
      </Panel>
      <div className="btn-row"><button className="btn ok" onClick={save}>Save settings</button></div>
    </>
  );
}

const WEIGHT_LABELS: [keyof Weights, string][] = [
  ['q1', 'Journal – Q1'], ['q2', 'Journal – Q2'], ['q3', 'Journal – Q3'], ['q4', 'Journal – Q4'], ['otherJournal', 'Journal – unranked'], ['book', 'Book'], ['chapter', 'Book chapter'],
  ['confPaper', 'Conference paper'], ['techReport', 'Technical report'], ['grantSanctioned', 'Grant sanctioned (base)'], ['grantPerLakh', 'Grant – per ₹1 lakh (max +20)'], ['seedMoney', 'Seed money approved'],
  ['fdpAttended', 'FDP attended'], ['fdpOrganised', 'FDP organised'], ['fdpResource', 'FDP resource person'], ['confPresented', 'Conference – presented'], ['confInvited', 'Conference – invited talk'],
  ['confChair', 'Conference – session chair'], ['confAttended', 'Conference – attended'], ['confOrganised', 'Conference – organised'],
  ['awardInternational', 'Honour / award – international'], ['awardNational', 'Honour / award – national'], ['awardOther', 'Honour / award – state / institutional'],
];
const TARGET_LABELS: [keyof Targets, string][] = [['publicationsPerFaculty', 'Publications per faculty'], ['fdpHoursPerFaculty', 'FDP hours per faculty'], ['conferencesPerFaculty', 'Conferences per faculty'], ['grantAppliedPerFaculty', 'Grant proposals per faculty']];

export function TargetSettings() {
  const { s, setS, save, error } = useSettingsDraft();
  return (
    <>
      <PageTitle>Targets & Scoring</PageTitle>
      <Panel title="Annual targets (per faculty, per academic year)" size="wide">
        {error && <Alert kind="error">{error}</Alert>}
        <div className="grid">{TARGET_LABELS.map(([k, l]) => <Field key={k} label={l}><NumberInput value={s.targets[k]} min={0} step="0.5" onChange={(v) => setS({ ...s, targets: { ...s.targets, [k]: v } })} /></Field>)}</div>
      </Panel>
      <Panel title="Performance score weights" size="wide">
        <p className="note">Points for each approved entry. Co-authors each get the full points; sanctioned grant points are not split. Faculty can see their own score and their department average, not other people's scores.</p>
        <div className="grid">{WEIGHT_LABELS.map(([k, l]) => <Field key={k} label={l}><NumberInput value={s.weights[k]} min={0} step="0.5" onChange={(v) => setS({ ...s, weights: { ...s.weights, [k]: v } })} /></Field>)}</div>
        <div className="btn-row left"><button className="btn secondary sm" onClick={() => setS({ ...s, weights: { ...DEFAULT_WEIGHTS } })}>Restore default weights</button></div>
      </Panel>
      <div className="btn-row"><button className="btn ok" onClick={save}>Save targets & weights</button></div>
    </>
  );
}

export function NoticeSettings() {
  const { db } = useStore();
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [error, setError] = useState('');
  return (
    <>
      <PageTitle>Notices</PageTitle>
      <Panel title="Post a notice to all faculty">
        {error && <Alert kind="error">{error}</Alert>}
        <Field label="Title" required><Input value={title} onChange={setTitle} /></Field>
        <Field label="Message"><TextArea value={body} onChange={setBody} /></Field>
        <div className="btn-row"><button className="btn" onClick={async () => { try { await addNotice(title, body); setTitle(''); setBody(''); setError(''); toast('Notice posted.'); } catch (e) { setError((e as Error).message); } }}>Post notice</button></div>
      </Panel>
      <Panel title="Current notices">
        {db.notices.map((n) => (
          <div key={n.id} className="notice" style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <div><b>{n.title}</b>{n.body} <small>· {fmtDate(n.at)}</small></div>
            <button className="link-btn" onClick={() => { if (confirm('Remove this notice?')) deleteNotice(n.id).catch((e) => setError((e as Error).message)); }}>Remove</button>
          </div>
        ))}
        {!db.notices.length && <p className="muted">No notices.</p>}
      </Panel>
    </>
  );
}

// ---------------- Account ----------------

export function Account() {
  const { user, institution } = useStore();
  const toast = useToast();
  const [pw, setPw] = useState({ old: '', next: '', again: '' });
  const [error, setError] = useState('');
  const change = async () => {
    if (pw.next !== pw.again) { setError('The new passwords do not match.'); return; }
    const err = await changePassword(pw.old, pw.next);
    if (err) setError(err); else { setError(''); setPw({ old: '', next: '', again: '' }); toast('Password changed. Other sessions were signed out.'); }
  };
  return (
    <>
      <PageTitle>Account</PageTitle>
      <Panel title="Your account">
        <dl className="kv">
          <dt>Name</dt><dd>{user?.name}</dd>
          <dt>Email</dt><dd>{user?.email}</dd>
          <dt>Role</dt><dd>{user?.role === 'management' ? 'Top-Level Management' : user?.role === 'faculty' ? 'Faculty' : 'Office of Research (platform)'}</dd>
          {institution && <><dt>Institution</dt><dd>{institution.name}</dd></>}
        </dl>
        <p className="note">Your role and institution are assigned by the UniRise platform administrator. Ask them if either is wrong.</p>
      </Panel>
      <Panel title="Change password">
        {error && <Alert kind="error">{error}</Alert>}
        <div className="grid g3">
          <Field label="Current password"><input type="password" value={pw.old} onChange={(e) => setPw({ ...pw, old: e.target.value })} autoComplete="current-password" /></Field>
          <Field label="New password" hint="At least 8 characters, with letters and a number"><input type="password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} autoComplete="new-password" /></Field>
          <Field label="Repeat new password"><input type="password" value={pw.again} onChange={(e) => setPw({ ...pw, again: e.target.value })} autoComplete="new-password" /></Field>
        </div>
        <div className="btn-row"><button className="btn" onClick={change}>Change password</button></div>
      </Panel>
    </>
  );
}

// ---------------- Introduction + sign in ----------------

/** The UniRise introduction page wrapped around a form; the sign-in page also shows the landing sections below it. */
function IntroPage({ children, showcase = false }: { children: React.ReactNode; showcase?: boolean }) {
  return (
    <div className="intro">
      <div className="intro-bg" aria-hidden><div className="intro-blob a" /><div className="intro-blob b" /></div>
      <header className="intro-head"><Logo /><ThemeToggle /></header>
      <main className="intro-main">
        <LandingHero />
        <section className="login-box">{children}</section>
      </main>
      {showcase && <LandingShowcase />}
    </div>
  );
}

const DEMO = [
  { email: 'director@sit.edu.in', pw: 'Admin@1234', label: 'Prof. R. Venkatesh, Director', note: 'Top-Level Management · Sample Institute of Technology' },
  { email: 'anita.rao@sit.edu.in', pw: 'Faculty@123', label: 'Dr. Anita Rao, Professor', note: 'Faculty · Sample Institute of Technology' },
  { email: 'vc@greenfield.ac.in', pw: 'Admin@1234', label: 'Prof. A. Iyengar, Vice-Chancellor', note: 'Top-Level Management · Greenfield University' },
];

export function Login() {
  const { user } = useStore();
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  if (user) return <Navigate to="/" replace />;
  const submit = async (e?: React.FormEvent, em = email, p = pw) => {
    e?.preventDefault();
    setBusy(true);
    const err = await login(em, p);
    setBusy(false);
    if (err) setError(err);
  };
  return (
    <IntroPage showcase>
      <div className="panel">
        <h2 className="panel-title">Sign in</h2>
        <p className="login-sub">Use the email and password registered with your institution.</p>
        {error && <Alert kind="error">{error}</Alert>}
        <form onSubmit={submit}>
          <Field label="Email"><Input value={email} onChange={setEmail} type="email" autoComplete="username" autoFocus /></Field>
          <div style={{ height: 12 }} />
          <Field label="Password"><input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" /></Field>
          <button className="btn" type="submit" disabled={busy} style={{ width: '100%', marginTop: 18, padding: '11px 18px' }}>{busy ? 'Signing in…' : 'Login'}</button>
        </form>
        <p className="login-sub" style={{ marginTop: 14, textAlign: 'center' }}>New to UniRise? <Link to="/register">Request access</Link></p>
        <div className="demo-list">
          <p className="eyebrow" style={{ fontSize: 12.5, marginBottom: 4 }}>Demo · sample accounts</p>
          {DEMO.map((d) => (
            <button key={d.email} type="button" className="demo-pick" onClick={() => submit(undefined, d.email, d.pw)}>
              <span><b>{d.label}</b><small>{d.note}</small></span>
              <span className="arrow" aria-hidden>→</span>
            </button>
          ))}
          <p className="muted" style={{ fontSize: 13.5, marginTop: 12 }}>Sample passwords: Admin@1234 (management), Faculty@123 (faculty, e.g. anita.rao@sit.edu.in). Each institution sees only its own data.</p>
        </div>
      </div>
    </IntroPage>
  );
}

// ---------------- Request access ----------------

export function Register() {
  const { user } = useStore();
  const [institutions, setInstitutions] = useState<{ id: string; name: string }[]>([]);
  const [departments, setDepartments] = useState<string[]>([]);
  const [f, setF] = useState<Registration>({ institutionId: '', role: 'faculty', title: 'Dr.', name: '', email: '', password: '', employeeCode: '', department: '', designation: 'Assistant Professor', note: '' });
  const [again, setAgain] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { publicInstitutions().then(setInstitutions).catch(() => setError('Could not load institutions. Try again.')); }, []);
  useEffect(() => {
    if (!f.institutionId) { setDepartments([]); return; }
    publicDepartments(f.institutionId).then(setDepartments).catch(() => setDepartments([]));
  }, [f.institutionId]);
  if (user) return <Navigate to="/" replace />;
  const u = (p: Partial<Registration>) => setF({ ...f, ...p });
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (f.password !== again) { setError('The passwords do not match.'); return; }
    setBusy(true);
    try { await register(f); setDone(true); setError(''); } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  };
  return (
    <IntroPage>
      <div className="panel">
        <h2 className="panel-title">Request access</h2>
        {done ? (
          <>
            <Alert kind="success">Request sent. The UniRise platform administrator will verify your affiliation with the institution. You can sign in once it is approved.</Alert>
            <div className="btn-row"><Link className="btn" to="/login">Back to sign in</Link></div>
          </>
        ) : (
          <form onSubmit={submit}>
            <p className="login-sub">Your request goes to the platform administrator, who checks your affiliation before giving access.</p>
            {error && <Alert kind="error">{error}</Alert>}
            <div className="grid g2">
              <Field label="Institution" required className="span2"><Select value={f.institutionId} onChange={(v) => u({ institutionId: v, department: '' })} options={institutions.map((i) => ({ value: i.id, label: i.name }))} placeholder="--Select--" /></Field>
              <Field label="I am" required className="span2"><Select value={f.role} onChange={(v) => u({ role: v as Registration['role'] })} options={[{ value: 'faculty', label: 'Faculty' }, { value: 'management', label: 'Top-Level Management' }]} /></Field>
              <Field label="Title"><Select value={f.title} onChange={(v) => u({ title: v })} options={['Dr.', 'Prof.', 'Mr.', 'Ms.', 'Mrs.']} /></Field>
              <Field label="Full name" required><Input value={f.name} onChange={(v) => u({ name: v })} autoComplete="name" /></Field>
              <Field label="Institutional email" required className="span2" hint="Use your institution's email address where you have one"><Input value={f.email} onChange={(v) => u({ email: v })} type="email" autoComplete="email" /></Field>
              {f.role === 'faculty' ? <>
                <Field label="Employee code" required><Input value={f.employeeCode} onChange={(v) => u({ employeeCode: v })} /></Field>
                <Field label="Department" required><Select value={f.department} onChange={(v) => u({ department: v })} options={departments} placeholder={f.institutionId ? '--Select--' : 'Choose institution first'} /></Field>
                <Field label="Designation" className="span2"><Select value={f.designation} onChange={(v) => u({ designation: v })} options={['Professor', 'Associate Professor', 'Assistant Professor', 'Professor of Practice', 'Adjunct Faculty']} /></Field>
              </> : (
                <Field label="Designation" required className="span2"><Input value={f.designation === 'Assistant Professor' ? '' : f.designation} onChange={(v) => u({ designation: v })} placeholder="Director, Dean (Research), Registrar…" /></Field>
              )}
              <Field label="Password" required hint="At least 8 characters, with letters and a number"><input type="password" value={f.password} onChange={(e) => u({ password: e.target.value })} autoComplete="new-password" /></Field>
              <Field label="Repeat password" required><input type="password" value={again} onChange={(e) => setAgain(e.target.value)} autoComplete="new-password" /></Field>
              <Field label="Note for the administrator" className="span2"><TextArea value={f.note} onChange={(v) => u({ note: v })} placeholder="Optional: anything that helps verify your affiliation" /></Field>
            </div>
            <button className="btn" type="submit" disabled={busy} style={{ width: '100%', marginTop: 16, padding: '11px 18px' }}>{busy ? 'Sending…' : 'Send request'}</button>
            <p className="login-sub" style={{ marginTop: 12, textAlign: 'center' }}>Already approved? <Link to="/login">Sign in</Link></p>
          </form>
        )}
      </div>
    </IntroPage>
  );
}

// ---------------- Office of Research sign in (separate route, not linked from the public pages) ----------------

export function AdminLogin() {
  const { user } = useStore();
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  if (user) return <Navigate to="/" replace />;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const err = await adminLogin(email, pw);
    setBusy(false);
    if (err) setError(err);
  };
  return (
    <div className="intro">
      <header className="intro-head"><Logo /><span style={{ display: 'flex', gap: 10, alignItems: 'center' }}><span className="role-chip">Office of Research</span><ThemeToggle /></span></header>
      <main className="login-wrap" style={{ display: 'grid', placeItems: 'center', flex: 1, padding: 24 }}>
        <div className="login-box" style={{ width: 'min(420px, 100%)' }}>
          <div className="panel">
            <h2 className="panel-title">Office of Research sign in</h2>
            <p className="login-sub">For Office of Research staff only. Sessions end after 30 minutes without activity.</p>
            {error && <Alert kind="error">{error}</Alert>}
            <form onSubmit={submit}>
              <Field label="Office of Research email"><Input value={email} onChange={setEmail} type="email" autoComplete="username" autoFocus /></Field>
              <div style={{ height: 12 }} />
              <Field label="Password"><input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" /></Field>
              <button className="btn" type="submit" disabled={busy} style={{ width: '100%', marginTop: 18, padding: '11px 18px' }}>{busy ? 'Signing in…' : 'Sign in'}</button>
            </form>
          </div>
        </div>
      </main>
    </div>
  );
}
