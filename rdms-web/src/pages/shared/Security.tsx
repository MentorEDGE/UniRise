import { useCallback, useEffect, useState } from 'react';
import { Alert, Field, Panel, useToast } from '../../components/ui';
import { AppSetup, CodeInput, RecoveryCodes } from '../../components/TwoStep';
import { accountTwoStep, signedInDevices } from '../../lib/store';
import type { SignedInDevice } from '../../lib/store';

/** Account page: two-step sign-in (2026-11-24). Required for the Office and management; faculty may turn it on. */
export function TwoStepSettings() {
  const toast = useToast();
  const [state, setState] = useState<{ enabled: boolean; required: boolean; recoveryCodesLeft: number } | null>(null);
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [code, setCode] = useState('');
  const [mode, setMode] = useState<'' | 'off' | 'codes'>('');
  const [error, setError] = useState('');
  const load = useCallback(() => { accountTwoStep.state().then(setState).catch((e) => setError((e as Error).message)); }, []);
  useEffect(load, [load]);
  const run = async (f: () => Promise<void>) => { setError(''); try { await f(); } catch (e) { setError((e as Error).message); } };
  if (!state) return <Panel title="Two-step sign-in">{error ? <Alert kind="error">{error}</Alert> : <p className="muted">Loading…</p>}</Panel>;
  if (codes) return <Panel title="Two-step sign-in"><RecoveryCodes codes={codes} onDone={() => { setCodes(null); setSetup(null); setCode(''); setMode(''); load(); }} doneLabel="Done" /></Panel>;
  return (
    <Panel title="Two-step sign-in">
      {error && <Alert kind="error">{error}</Alert>}
      {state.enabled ? (
        <>
          <p><span className="badge Approved">On</span> Signing in needs your password and a code from your authenticator app. {state.recoveryCodesLeft} recovery code{state.recoveryCodesLeft === 1 ? '' : 's'} left.</p>
          {state.required && <p className="note">Required for your role, so it cannot be turned off. If you lose your phone, use a recovery code, or ask another Office of Research account to reset it.</p>}
          {mode ? (
            <form onSubmit={(e) => { e.preventDefault(); void run(async () => {
              if (mode === 'codes') setCodes((await accountTwoStep.newRecoveryCodes(code.trim())).recoveryCodes);
              else { await accountTwoStep.disable(code.trim()); toast('Two-step sign-in turned off.'); setMode(''); setCode(''); load(); }
            }); }} noValidate>
              <Field label="Current code from your authenticator app"><CodeInput value={code} onChange={setCode} /></Field>
              <div className="btn-row left"><button className="btn" type="submit" disabled={!code.trim()}>{mode === 'codes' ? 'Get new recovery codes' : 'Turn off'}</button><button type="button" className="btn secondary" onClick={() => { setMode(''); setCode(''); }}>Cancel</button></div>
            </form>
          ) : (
            <div className="btn-row left">
              <button type="button" className="btn secondary" onClick={() => setMode('codes')}>New recovery codes</button>
              {!state.required && <button type="button" className="btn danger" onClick={() => setMode('off')}>Turn off</button>}
            </div>
          )}
        </>
      ) : setup ? (
        <form onSubmit={(e) => { e.preventDefault(); void run(async () => setCodes((await accountTwoStep.enable(code.trim())).recoveryCodes)); }} noValidate>
          <AppSetup uri={setup.uri} secret={setup.secret} />
          <Field label="6-digit code"><CodeInput value={code} onChange={setCode} /></Field>
          <div className="btn-row left"><button className="btn ok" type="submit" disabled={!code.trim()}>Turn on</button><button type="button" className="btn secondary" onClick={() => { setSetup(null); setCode(''); }}>Cancel</button></div>
        </form>
      ) : (
        <>
          <p><span className="badge Draft">Off</span> Add a second step to signing in: a code from an authenticator app on your phone. Even someone who learns your password cannot sign in without your phone.</p>
          <button type="button" className="btn" onClick={() => void run(async () => setSetup(await accountTwoStep.setup()))}>Turn on two-step sign-in</button>
        </>
      )}
    </Panel>
  );
}

/** A browser's name in plain words, from its user-agent text. */
function describe(ua: string | null) {
  if (!ua) return 'Unknown browser';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /iPhone|iPad/.test(ua) ? 'iPhone/iPad' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${browser} on ${os}` : browser;
}
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—');

/** Account page: where the account is signed in, with sign-out for any other device (2026-11-24). */
export function SignedInDevices() {
  const toast = useToast();
  const [list, setList] = useState<SignedInDevice[] | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(() => { signedInDevices.list().then(setList).catch((e) => setError((e as Error).message)); }, []);
  useEffect(load, [load]);
  const others = (list ?? []).filter((d) => !d.current).length;
  return (
    <Panel title="Signed-in devices">
      {error && <Alert kind="error">{error}</Alert>}
      <p className="note" style={{ marginTop: 0 }}>Where your account is signed in now. If you don’t recognise one, sign it out and change your password.</p>
      {list && (
        <ul className="device-list">
          {list.map((d) => (
            <li key={d.id}>
              <div><b>{describe(d.browser)}</b>{d.current && <span className="badge Approved" style={{ marginLeft: 8 }}>This device</span>}</div>
              <div className="muted">Signed in {when(d.signedInAt)} · last active {when(d.lastActiveAt)}{d.ip ? ` · ${d.ip}` : ''}</div>
              {!d.current && <button type="button" className="btn secondary sm" onClick={async () => { try { await signedInDevices.end(d.id); toast('Signed out that device.'); load(); } catch (e) { setError((e as Error).message); } }}>Sign out</button>}
            </li>
          ))}
        </ul>
      )}
      {others > 0 && <button type="button" className="btn danger" onClick={async () => { try { await signedInDevices.endOthers(); toast('Signed out all other devices.'); load(); } catch (e) { setError((e as Error).message); } }}>Sign out all other devices ({others})</button>}
    </Panel>
  );
}
