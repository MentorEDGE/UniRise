import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { Alert, Field, Input, PageTitle, Panel, useToast } from '../../components/ui';
import { API_BASE, changePassword, checkPasswordLink, finishSignIn, login, setPasswordFromLink, twoStepEnableAtSignIn, twoStepSetupAtSignIn, twoStepVerify, useStore } from '../../lib/store';
import type { TwoStepNeeded } from '../../lib/store';
import { AppSetup, CodeStep, CodeInput, RecoveryCodes } from '../../components/TwoStep';
import { SignedInDevices, TwoStepSettings } from './Security';
import { DEMO_PASSWORD } from '../../lib/demo';
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
      <PageTitle sub="Your account details and password. Changing your password signs you out on every other device.">Account & Password</PageTitle>
      <Panel title="Your account">
        <dl className="kv">
          <dt>Name</dt><dd>{user?.name}</dd>
          <dt>Email</dt><dd>{user?.email}</dd>
          <dt>Role</dt><dd>{user?.role === 'management' ? 'Top-Level Management' : user?.role === 'faculty' ? 'Faculty' : 'Office of Research'}</dd>
          {institution && <><dt>Institution</dt><dd>{institution.name}</dd></>}
        </dl>
        <p className="note">Your role and institution are set by your institution’s Office of Research. Ask them if either is wrong.</p>
      </Panel>
      <Panel title="Change password">
        {user?.mustChangePassword && <Alert kind="info"><b>Choose your own password to continue.</b> You signed in with a temporary password. Enter it as the current password, then choose a new one; the rest of UniRise opens once it is changed.</Alert>}
        {error && <Alert kind="error">{error}</Alert>}
        <div className="grid g3">
          <Field label="Current password"><input type="password" value={pw.old} onChange={(e) => setPw({ ...pw, old: e.target.value })} autoComplete="current-password" /></Field>
          <Field label="New password" hint="At least 10 characters, with letters and a number. Avoid common words and passwords used on other sites."><input type="password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} autoComplete="new-password" /></Field>
          <Field label="Repeat new password"><input type="password" value={pw.again} onChange={(e) => setPw({ ...pw, again: e.target.value })} autoComplete="new-password" /></Field>
        </div>
        <div className="btn-row"><button className="btn" onClick={change}>Change password</button></div>
      </Panel>
      {!user?.mustChangePassword && <><TwoStepSettings /><SignedInDevices /></>}
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
  { email: 'office@abc.edu.in', pw: DEMO_PASSWORD, label: 'Office of Research, ABC', note: 'Office of Research · ABC Institute of Technology' },
  { email: 'director@abc.edu.in', pw: DEMO_PASSWORD, label: 'Director, ABC', note: 'Top-Level Management · ABC Institute of Technology' },
  { email: 'john.doe@abc.edu.in', pw: DEMO_PASSWORD, label: 'Dr. John Doe, Professor', note: 'Faculty · ABC Institute of Technology' },
  { email: 'vc@xyz.ac.in', pw: DEMO_PASSWORD, label: 'Vice-Chancellor, XYZ', note: 'Top-Level Management · XYZ University' },
];
/**
 * On a page served from its own API (a local run) a sample account signs in at once. On the shared dev site the buttons
 * only fill in the email and the person types the demo password.
 */
const DEMO_FILLS_PASSWORD = !API_BASE;

/**
 * The second step of signing in (2026-11-24): a code from the authenticator app, or, the first time for the Office and
 * management, setting the app up (QR code), then the recovery codes before entering UniRise.
 */
function SecondStep({ need, onRestart }: { need: TwoStepNeeded; onRestart: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null);
  const [code, setCode] = useState('');
  const [done, setDone] = useState<Awaited<ReturnType<typeof twoStepEnableAtSignIn>> | null>(null);
  useEffect(() => { if (need.twoStep === 'setup') twoStepSetupAtSignIn().then(setSetup).catch((e) => setError((e as Error).message)); }, [need.twoStep]);
  const restart = <p className="note" style={{ marginTop: 12 }}><button type="button" className="link-btn" onClick={onRestart}>Sign in as someone else</button></p>;
  if (done) return (<><h1 className="auth-title">Save your recovery codes</h1><RecoveryCodes codes={done.recoveryCodes} onDone={() => void finishSignIn(done)} doneLabel="Continue to UniRise" /></>);
  if (need.twoStep === 'verify') return (
    <>
      <h1 className="auth-title">Two-step sign-in</h1>
      <CodeStep intro={`Enter the 6-digit code from the authenticator app on your phone for ${need.email}.`} busy={busy} error={error}
        onSubmit={async (c) => { setBusy(true); setError(''); const err = await twoStepVerify(c); setBusy(false); if (err) setError(err); }} />
      {restart}
    </>
  );
  return (
    <>
      <h1 className="auth-title">Set up two-step sign-in</h1>
      <p className="login-sub">Your role reaches your whole institution’s data, so signing in also needs a code from an authenticator app on your phone. This takes about a minute, once.</p>
      {error && <Alert kind="error">{error}</Alert>}
      {setup && (
        <form onSubmit={async (e) => { e.preventDefault(); if (!code.trim()) return; setBusy(true); setError(''); try { setDone(await twoStepEnableAtSignIn(code.trim())); } catch (x) { setError((x as Error).message); } finally { setBusy(false); } }} noValidate>
          <AppSetup uri={setup.uri} secret={setup.secret} />
          <Field label="6-digit code"><CodeInput value={code} onChange={setCode} /></Field>
          <button className="btn auth-submit" type="submit" disabled={busy || !code.trim()}>{busy ? 'Checking…' : 'Turn on and continue'}</button>
        </form>
      )}
      {restart}
    </>
  );
}

/** One sign-in for faculty, Top-Level Management and the Office of Research. The role comes from the account. */
export function Login() {
  const { user } = useStore();
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [show, setShow] = useState(false);
  const [forgot, setForgot] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const pwRef = useRef<HTMLInputElement>(null);
  const [second, setSecond] = useState<TwoStepNeeded | null>(null); // the password was right; two-step sign-in comes next
  const [params] = useSearchParams();
  // Signed in: each role lands on its own workspace ("/" renders it).
  if (user) return <Navigate to="/" replace />;
  if (second) return <AuthPage><div className="panel auth-card"><SecondStep need={second} onRestart={() => { setSecond(null); setPw(''); }} /></div></AuthPage>;
  const submit = async (e?: React.FormEvent, em = email, p = pw) => {
    e?.preventDefault();
    if (!em.trim() || !p) { setError('Enter your email and password.'); return; }
    setBusy(true); setError('');
    const err = await login(em.trim(), p);
    setBusy(false);
    if (err && typeof err === 'object') setSecond(err);
    else if (err) setError(err);
  };
  return (
    <AuthPage>
      <div className="panel auth-card">
        <h1 className="auth-title">Welcome back</h1>
        <p className="login-sub">Sign in with the email and password given to you by your Office of Research.</p>
        {params.get('set') === '1' && !error && <Alert kind="success">Your password is set. Sign in with it to continue.</Alert>}
        {error && <Alert kind="error">{error}</Alert>}
        <form onSubmit={submit} noValidate>
          <Field label="Institutional email"><Input value={email} onChange={(v) => { setEmail(v); setError(''); }} type="email" autoComplete="username" autoFocus placeholder="name@institution.edu.in" /></Field>
          <div style={{ height: 14 }} />
          <Field label="Password">
            <div className="pw-wrap">
              <input ref={pwRef} type={show ? 'text' : 'password'} value={pw} onChange={(e) => { setPw(e.target.value); setError(''); }} autoComplete="current-password" />
              <button type="button" className="pw-toggle" onClick={() => setShow(!show)} aria-pressed={show} aria-label={show ? 'Hide password' : 'Show password'}>{show ? 'Hide' : 'Show'}</button>
            </div>
          </Field>
          <div className="auth-row">
            <span className="auth-new">New to UniRise? <Link to="/talk-to-our-team">Talk to our team</Link></span>
            <button type="button" className="link-btn" onClick={() => setForgot(!forgot)} aria-expanded={forgot}>Forgot password?</button>
          </div>
          {forgot && (
            <div className="forgot-box">
              <p className="note" style={{ margin: 0 }}>Your institution’s <b>Office of Research</b> can reset your password. Contact them and they will email you a temporary password, which you change when you next sign in.</p>
            </div>
          )}
          <button className="btn auth-submit" type="submit" disabled={busy}>{busy ? <><span className="spinner" aria-hidden /> Signing in…</> : 'Sign In'}</button>
        </form>
        <div className="demo-list">
          <p className="eyebrow" style={{ fontSize: 12.5, marginBottom: 4 }}>Demo · sample accounts</p>
          {!DEMO_FILLS_PASSWORD && <p className="note" style={{ margin: '0 0 6px' }}>Choose an account, then enter the demo password given to you by the UniRise team.</p>}
          {DEMO.map((d) => (
            <button key={d.email} type="button" className="demo-pick" disabled={busy}
              onClick={() => { if (DEMO_FILLS_PASSWORD) { submit(undefined, d.email, d.pw); return; } setEmail(d.email); setPw(''); setError(''); pwRef.current?.focus(); }}>
              <span><b>{d.label}</b><small>{d.note}</small></span>
              <span className="arrow" aria-hidden>→</span>
            </button>
          ))}
        </div>
      </div>
    </AuthPage>
  );
}

/**
 * The page an emailed password link opens: an invitation from the Office of Research ("Set your password") or a reset
 * the person asked for ("Choose a new password"). The link's secret is in the URL fragment, so it never reaches the
 * web host; the API checks it, sets the password, and the person is signed in straight away.
 */
export function SetPassword() {
  const [params] = useSearchParams();
  const token = params.get('t') ?? '';
  const navigate = useNavigate();
  const [link, setLink] = useState<{ purpose: 'invite' | 'reset'; email: string; name: string; institution: string } | null>(null);
  const [gone, setGone] = useState('');
  const [pw, setPw] = useState({ next: '', again: '' });
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    checkPasswordLink(token).then((l) => { if (live) setLink(l); }).catch((e) => { if (live) setGone((e as Error).message); });
    return () => { live = false; };
  }, [token]);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pw.next !== pw.again) { setError('The two passwords do not match.'); return; }
    setBusy(true); setError('');
    const err = await setPasswordFromLink(token, pw.next);
    setBusy(false);
    if (err && typeof err === 'object') navigate('/login?set=1', { replace: true }); // two-step sign-in comes next, on the sign-in page
    else if (err) setError(err); else navigate('/', { replace: true });
  };
  const invite = link?.purpose === 'invite';
  return (
    <AuthPage>
      <div className="panel auth-card">
        <h1 className="auth-title">{invite ? 'Set your password' : 'Choose a new password'}</h1>
        {!link && !gone && <p className="muted">Checking your link…</p>}
        {gone && <>
          <Alert kind="error">{gone}</Alert>
          <Link to="/login" className="btn secondary">Go to sign in</Link>
        </>}
        {link && (
          <>
            <p className="login-sub">{invite ? `Welcome, ${link.name}. ` : ''}This sets the password for <b>{link.email}</b> at {link.institution}.</p>
            {error && <Alert kind="error">{error}</Alert>}
            <form onSubmit={submit} noValidate>
              <input type="email" value={link.email} autoComplete="username" readOnly hidden />
              <Field label="New password" hint="At least 10 characters, with letters and a number. Avoid common words and passwords used on other sites.">
                <div className="pw-wrap">
                  <input type={show ? 'text' : 'password'} value={pw.next} onChange={(e) => { setPw({ ...pw, next: e.target.value }); setError(''); }} autoComplete="new-password" autoFocus />
                  <button type="button" className="pw-toggle" onClick={() => setShow(!show)} aria-pressed={show} aria-label={show ? 'Hide password' : 'Show password'}>{show ? 'Hide' : 'Show'}</button>
                </div>
              </Field>
              <div style={{ height: 14 }} />
              <Field label="Repeat new password"><input type={show ? 'text' : 'password'} value={pw.again} onChange={(e) => { setPw({ ...pw, again: e.target.value }); setError(''); }} autoComplete="new-password" /></Field>
              <button className="btn auth-submit" type="submit" disabled={busy}>{busy ? <><span className="spinner" aria-hidden /> Saving…</> : invite ? 'Set password and sign in' : 'Save and sign in'}</button>
            </form>
            <p className="note">Saving signs this account out on every other device.</p>
          </>
        )}
      </div>
    </AuthPage>
  );
}
