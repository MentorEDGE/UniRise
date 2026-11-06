import { useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { Alert, Field, Input, PageTitle, Panel, useToast } from '../../components/ui';
import { changePassword, login, useStore } from '../../lib/store';
import { Logo } from '../../components/Logo';
import { ThemeToggle } from '../../components/ThemeToggle';

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
          <dt>Role</dt><dd>{user?.role === 'management' ? 'Top-Level Management' : user?.role === 'faculty' ? 'Faculty' : 'Office of Research'}</dd>
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

// ---------------- Sign in (separate page; the introduction page is "/" when signed out) ----------------

/** Shell of the sign-in and request-access pages: brand bar with a way back to the introduction page, centred card. */
function AuthPage({ children, wide = false }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="intro auth">
      <div className="intro-bg" aria-hidden><div className="intro-blob a" /><div className="intro-blob b" /></div>
      <header className="land-head">
        <Link to="/" className="land-logo" aria-label="UniRise by MentorEdge, introduction page"><Logo /></Link>
        <div className="land-actions">
          <Link to="/" className="auth-back">← Back to home</Link>
          <ThemeToggle />
        </div>
      </header>
      <main className={`auth-main ${wide ? 'wide' : ''}`}>{children}</main>
    </div>
  );
}

const DEMO = [
  { email: 'office@abc.edu.in', pw: 'Office@1234', label: 'Office of Research, ABC', note: 'Office of Research · ABC Institute of Technology' },
  { email: 'director@abc.edu.in', pw: 'Admin@1234', label: 'Director, ABC', note: 'Top-Level Management · ABC Institute of Technology' },
  { email: 'faculty.a@abc.edu.in', pw: 'Faculty@123', label: 'Faculty A, Professor', note: 'Faculty · ABC Institute of Technology' },
  { email: 'vc@xyz.ac.in', pw: 'Admin@1234', label: 'Vice-Chancellor, XYZ', note: 'Top-Level Management · XYZ University' },
];

/** One sign-in for faculty, Top-Level Management and the Office of Research. The role comes from the account. */
export function Login() {
  const { user } = useStore();
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [show, setShow] = useState(false);
  const [forgot, setForgot] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // Signed in: each role lands on its own workspace ("/" renders it).
  if (user) return <Navigate to="/" replace />;
  const submit = async (e?: React.FormEvent, em = email, p = pw) => {
    e?.preventDefault();
    if (!em.trim() || !p) { setError('Enter your email and password.'); return; }
    setBusy(true); setError('');
    const err = await login(em.trim(), p);
    setBusy(false);
    if (err) setError(err);
  };
  return (
    <AuthPage>
      <div className="panel auth-card">
        <h1 className="auth-title">Welcome back</h1>
        <p className="login-sub">Sign in with the email and password given to you by your Office of Research.</p>
        {error && <Alert kind="error">{error}</Alert>}
        <form onSubmit={submit} noValidate>
          <Field label="Institutional email"><Input value={email} onChange={(v) => { setEmail(v); setError(''); }} type="email" autoComplete="username" autoFocus placeholder="name@institution.edu.in" /></Field>
          <div style={{ height: 14 }} />
          <Field label="Password">
            <div className="pw-wrap">
              <input type={show ? 'text' : 'password'} value={pw} onChange={(e) => { setPw(e.target.value); setError(''); }} autoComplete="current-password" />
              <button type="button" className="pw-toggle" onClick={() => setShow(!show)} aria-pressed={show} aria-label={show ? 'Hide password' : 'Show password'}>{show ? 'Hide' : 'Show'}</button>
            </div>
          </Field>
          <div className="auth-row">
            <span className="auth-new">New to UniRise? <Link to="/talk-to-our-team">Talk to our team</Link></span>
            <button type="button" className="link-btn" onClick={() => setForgot(!forgot)} aria-expanded={forgot}>Forgot password?</button>
          </div>
          {forgot && <Alert kind="info">Ask your Office of Research to reset it (Office of Research staff: ask the UniRise team). They will give you a temporary password, which you can change under Account → Change Password after signing in.</Alert>}
          <button className="btn auth-submit" type="submit" disabled={busy}>{busy ? <><span className="spinner" aria-hidden /> Signing in…</> : 'Sign In'}</button>
        </form>
        <div className="demo-list">
          <p className="eyebrow" style={{ fontSize: 12.5, marginBottom: 4 }}>Demo · sample accounts</p>
          {DEMO.map((d) => (
            <button key={d.email} type="button" className="demo-pick" disabled={busy} onClick={() => submit(undefined, d.email, d.pw)}>
              <span><b>{d.label}</b><small>{d.note}</small></span>
              <span className="arrow" aria-hidden>→</span>
            </button>
          ))}
        </div>
      </div>
    </AuthPage>
  );
}
