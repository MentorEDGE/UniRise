import { useEffect, useRef, useState } from 'react';
import { setPasswordPrompt } from '../lib/store';

/**
 * The dialog that asks for the password before a sensitive Office action (2026-11-24): changing accounts or roles,
 * creating temporary passwords, official details, the email sender. Confirming unlocks such actions for 5 minutes.
 */
export function ConfirmPasswordHost() {
  const [open, setOpen] = useState(false);
  const [pw, setPw] = useState('');
  const [tries, setTries] = useState(0);
  const resolver = useRef<((v: string | null) => void) | null>(null);
  useEffect(() => {
    setPasswordPrompt(() => new Promise<string | null>((resolve) => {
      if (resolver.current) setTries((t) => t + 1); // asked again: the last password was wrong
      resolver.current = resolve; setPw(''); setOpen(true);
    }));
    return () => setPasswordPrompt(null);
  }, []);
  const finish = (v: string | null) => { const r = resolver.current; if (v === null) { resolver.current = null; setTries(0); } setOpen(false); r?.(v); };
  useEffect(() => { if (!open) return; const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') finish(null); }; document.addEventListener('keydown', esc); return () => document.removeEventListener('keydown', esc); });
  if (!open) return null;
  return (
    <div className="modal-back" style={{ zIndex: 200 }}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="confirm-pw-title" style={{ maxWidth: 420 }}>
        <div className="modal-head"><span id="confirm-pw-title">Confirm it’s you</span><button type="button" onClick={() => finish(null)} aria-label="Close">×</button></div>
        <div className="modal-body">
          <form onSubmit={(e) => { e.preventDefault(); if (pw) finish(pw); }}>
            <p className="note" style={{ marginTop: 0 }}>For your institution’s security, enter your password to continue. You won’t be asked again for 5 minutes.</p>
            {tries > 0 && <div className="alert error" role="alert">That password is incorrect. After 5 wrong attempts you will be signed out.</div>}
            <div className="field"><label htmlFor="confirm-pw">Your password</label><input id="confirm-pw" type="password" autoComplete="current-password" autoFocus value={pw} onChange={(e) => setPw(e.target.value)} /></div>
            <div className="btn-row"><button type="button" className="btn secondary" onClick={() => finish(null)}>Cancel</button><button type="submit" className="btn ok" disabled={!pw}>Continue</button></div>
          </form>
        </div>
      </div>
    </div>
  );
}
