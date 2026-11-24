import { useEffect, useState } from 'react';
import { Alert, Field } from './ui';

/**
 * Two-step sign-in screens (2026-11-24): the code box, setting up an authenticator app (QR code and key), and the
 * one-time recovery codes. Used while signing in and from the Account page.
 */

/** A 6-digit code from the app, or a recovery code. */
export function CodeInput({ value, onChange, recovery }: { value: string; onChange: (v: string) => void; recovery?: boolean }) {
  return (
    <input id="two-step-code" value={value} onChange={(e) => onChange(e.target.value)} autoFocus autoComplete="one-time-code"
      inputMode={recovery ? 'text' : 'numeric'} maxLength={recovery ? 14 : 7} placeholder={recovery ? 'XXXXX-XXXXX' : '123456'}
      style={{ fontFamily: 'monospace', fontSize: 20, letterSpacing: recovery ? 1 : 6, maxWidth: 220 }} />
  );
}

/** The QR code and the key to type in, for an authenticator app (Google Authenticator, Microsoft Authenticator, …). */
export function AppSetup({ uri, secret }: { uri: string; secret: string }) {
  const [qr, setQr] = useState('');
  // The QR library is loaded only here (setup is rare), keeping it out of the main bundle.
  useEffect(() => { import('qrcode').then((q) => q.default.toDataURL(uri, { margin: 1, width: 200 })).then(setQr).catch(() => setQr('')); }, [uri]);
  return (
    <div className="two-step-setup">
      <ol className="steps">
        <li>Install an authenticator app on your phone, such as <b>Google Authenticator</b> or <b>Microsoft Authenticator</b>.</li>
        <li>In the app, add an account and scan this QR code.</li>
      </ol>
      {qr && <img src={qr} width={200} height={200} alt="QR code for your authenticator app" style={{ display: 'block', margin: '8px 0', background: '#fff', padding: 6, borderRadius: 8 }} />}
      <p className="note">Can’t scan it? Type this key into the app instead:</p>
      <code style={{ display: 'inline-block', fontSize: 15, letterSpacing: 1, overflowWrap: 'anywhere', padding: '6px 8px' }}>{secret.replace(/(.{4})/g, '$1 ').trim()}</code>
      <ol className="steps" start={3}><li>Enter the 6-digit code the app shows.</li></ol>
    </div>
  );
}

/** The recovery codes, shown once, with copy and download; Continue only after the person confirms they saved them. */
export function RecoveryCodes({ codes, onDone, doneLabel = 'Continue' }: { codes: string[]; onDone: () => void; doneLabel?: string }) {
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const text = `UniRise recovery codes (each works once)\n\n${codes.join('\n')}\n`;
  const download = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    a.download = 'unirise-recovery-codes.txt';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  return (
    <div>
      <Alert kind="success">Two-step sign-in is on.</Alert>
      <p>Save these <b>recovery codes</b> somewhere safe. If you lose your phone, each one lets you sign in once. They are shown only now.</p>
      <ol className="recovery-codes">{codes.map((c) => <li key={c}><code>{c}</code></li>)}</ol>
      <div className="btn-row left">
        <button type="button" className="btn secondary sm" onClick={() => { navigator.clipboard?.writeText(text).then(() => setCopied(true)).catch(() => {}); }}>{copied ? 'Copied' : 'Copy'}</button>
        <button type="button" className="btn secondary sm" onClick={download}>Download</button>
      </div>
      <label className="check-inline" style={{ marginTop: 12 }}><input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} /> I have saved my recovery codes</label>
      <div className="btn-row"><button type="button" className="btn ok" disabled={!saved} onClick={onDone}>{doneLabel}</button></div>
    </div>
  );
}

/** The code step: verify with the app, or switch to a recovery code. */
export function CodeStep({ onSubmit, busy, error, intro }: { onSubmit: (code: string) => void; busy: boolean; error: string; intro: string }) {
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState(false);
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (code.trim()) onSubmit(code.trim()); }} noValidate>
      <p className="login-sub" style={{ marginTop: 0 }}>{intro}</p>
      {error && <Alert kind="error">{error}</Alert>}
      <Field label={recovery ? 'Recovery code' : 'Code from your authenticator app'}><CodeInput value={code} onChange={setCode} recovery={recovery} /></Field>
      <button type="button" className="link-btn" style={{ marginTop: 6 }} onClick={() => { setRecovery(!recovery); setCode(''); }}>
        {recovery ? 'Use the authenticator app instead' : 'Lost your phone? Use a recovery code'}
      </button>
      <button className="btn auth-submit" type="submit" disabled={busy || !code.trim()}>{busy ? 'Checking…' : 'Continue'}</button>
    </form>
  );
}
