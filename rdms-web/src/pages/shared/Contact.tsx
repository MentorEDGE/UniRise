import { useState } from 'react';
import type { ReactNode } from 'react';
import { sendEnquiry } from '../../lib/store';
import { ENQUIRY_EMAIL, PublicFooter, PublicHeader } from './Landing';

/**
 * "Talk to Our Team" (UniRise site): same layout and wording as mentoredge.co.in/contact, with the enquiry going to
 * corporate@mentoredge.co.in. The server stores and emails each enquiry (server/mail.ts); no credentials in the browser.
 */

const svg = (d: ReactNode) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>{d}</svg>;
const PHONE = svg(<><path d="M13 2a9 9 0 0 1 9 9" /><path d="M13 6a5 5 0 0 1 5 5" /><path d="M13.83 16.57a1 1 0 0 0 1.21-.3l.36-.47A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.47.35a1 1 0 0 0-.29 1.23 14 14 0 0 0 6.39 6.39" /></>);
const WHATSAPP = <svg viewBox="0 0 24 24" aria-hidden><path fill="currentColor" d="M17.47 14.38c-.3-.15-1.75-.86-2.02-.96-.27-.1-.47-.15-.67.15-.2.3-.77.96-.94 1.16-.17.2-.35.22-.64.07-.3-.15-1.25-.46-2.38-1.47-.88-.79-1.47-1.76-1.65-2.05-.17-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.08-.15-.67-1.62-.92-2.22-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.79.37-.27.3-1.04 1.02-1.04 2.48 0 1.46 1.07 2.88 1.21 3.08.15.2 2.1 3.2 5.08 4.48.71.31 1.26.49 1.69.63.71.22 1.36.19 1.87.12.57-.09 1.75-.72 2-1.41.25-.7.25-1.29.17-1.41-.07-.13-.27-.2-.57-.35M12.05 21.5h-.01a9.43 9.43 0 0 1-4.8-1.32l-.35-.2-3.57.93.95-3.48-.22-.36a9.4 9.4 0 0 1-1.44-5.02c0-5.2 4.24-9.44 9.45-9.44 2.52 0 4.89.99 6.67 2.77a9.37 9.37 0 0 1 2.77 6.68c0 5.2-4.24 9.44-9.45 9.44m8.04-17.48A11.3 11.3 0 0 0 12.05.7C5.78.7.68 5.8.68 12.06c0 2 .52 3.96 1.52 5.68L.58 23.3l5.7-1.5a11.33 11.33 0 0 0 5.77 1.47h.01c6.26 0 11.36-5.1 11.37-11.37 0-3.03-1.18-5.89-3.33-8.03" /></svg>;
const MAIL = svg(<><rect width="20" height="16" x="2" y="4" rx="2" /><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" /></>);
const BUILDING = svg(<><path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z" /><path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2" /><path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2" /><path d="M10 6h4M10 10h4M10 14h4M10 18h4" /></>);
const ARROW = svg(<><path d="M7 7h10v10" /><path d="M7 17 17 7" /></>);

const TYPES = ['University / college', 'Research institute', 'Company', 'Startup', 'Non-profit organisation', 'Other'];
const INTERESTS = ['UniRise institutional partnership', 'Faculty development', 'Student research & mentorship', 'Industry–academia collaboration', 'Other / let’s discuss'];
const SIZES = ['Fewer than 50', '50 – 200', '200 – 500', '500 – 1,000', 'More than 1,000'];

const EMPTY = { institutionName: '', institutionType: '', contactName: '', designation: '', email: '', phone: '', country: 'India', state: '', city: '', facultyCount: '', interest: 'UniRise institutional partnership', message: '', consent: '', website: '' };
type Form = typeof EMPTY;
type Key = keyof Form;
const REQUIRED: Key[] = ['institutionName', 'institutionType', 'contactName', 'email', 'country', 'state', 'city', 'facultyCount', 'interest'];

function check(f: Form): Partial<Record<Key, string>> {
  const e: Partial<Record<Key, string>> = {};
  for (const k of REQUIRED) if (!f[k].trim()) e[k] = 'This field is required.';
  if (f.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) e.email = 'Enter a valid email address.';
  if (f.phone && !/^[+\d][\d\s()-]{6,}$/.test(f.phone.trim())) e.phone = 'Enter a valid phone number.';
  if (!f.consent) e.consent = 'Please agree so we can contact you about this enquiry.';
  return e;
}

export function TalkToOurTeam() {
  const [f, setF] = useState<Form>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<Key, string>>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const set = (k: Key, v: string) => { setF({ ...f, [k]: v }); if (errors[k]) setErrors({ ...errors, [k]: undefined }); };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const v = check(f);
    setErrors(v);
    if (Object.keys(v).length) { setError('Please check the highlighted fields.'); return; }
    setBusy(true); setError('');
    try { await sendEnquiry(f); setDone(true); } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  };
  const label = (k: Key, text: string, optional = false) => (
    <label className="ct-label" htmlFor={`ct-${k}`}>{text}{optional ? <span className="ct-opt"> (optional)</span> : <span className="ct-req" aria-hidden> *</span>}</label>
  );
  const err = (k: Key) => errors[k] && <small className="ct-err" role="alert">{errors[k]}</small>;
  const input = (k: Key, text: string, placeholder: string, opts: { type?: string; optional?: boolean; auto?: string } = {}) => (
    <div className="ct-field">
      {label(k, text, opts.optional)}
      <input id={`ct-${k}`} className={errors[k] ? 'bad' : ''} type={opts.type ?? 'text'} placeholder={placeholder} value={f[k]} autoComplete={opts.auto} aria-invalid={!!errors[k]} onChange={(e) => set(k, e.target.value)} />
      {err(k)}
    </div>
  );
  const select = (k: Key, text: string, first: string, options: string[]) => (
    <div className="ct-field">
      {label(k, text)}
      <select id={`ct-${k}`} className={errors[k] ? 'bad' : ''} value={f[k]} aria-invalid={!!errors[k]} onChange={(e) => set(k, e.target.value)}>
        <option value="">{first}</option>{options.map((o) => <option key={o}>{o}</option>)}
      </select>
      {err(k)}
    </div>
  );

  return (
    <div className="me">
      <PublicHeader />
      <main>
        <section className="ct">
          <div className="ct-container">
            <h1 className="ct-title">Contact</h1>

            <div className="ct-reach">
              <div className="me-blob ct-b1" aria-hidden />
              <div className="me-blob ct-b2" aria-hidden />
              <div className="ct-reach-grid">
                <div className="ct-reach-item">
                  <span className="ct-ic violet">{PHONE}</span>
                  <div><p className="ct-reach-label">Call us toll-free</p><a className="ct-reach-link violet" href="tel:18004101410">1800 410 1410</a></div>
                </div>
                <div className="ct-reach-item">
                  <span className="ct-ic green">{WHATSAPP}</span>
                  <div><p className="ct-reach-label">WhatsApp us</p><a className="ct-reach-link green" href="https://wa.me/917890090080" target="_blank" rel="noreferrer">+91 78900 90080</a></div>
                </div>
                <div className="ct-reach-item">
                  <span className="ct-ic violet">{MAIL}</span>
                  <div style={{ minWidth: 0 }}><p className="ct-reach-label">Mail us at</p><a className="ct-reach-link violet small" href={`mailto:${ENQUIRY_EMAIL}`}>{ENQUIRY_EMAIL}</a></div>
                </div>
              </div>
            </div>

            <section className="ct-body">
              <div className="ct-intro">
                <span className="ct-badge">{BUILDING}</span>
                <p className="ct-eyebrow">For organisations</p>
                <h2>Bring Research And Opportunity Together</h2>
                <p className="ct-lead">Tell us about your organisation and the goals you’d like to explore together.</p>
                <p className="ct-small">From institutional partnerships and faculty development to student research and industry–academia collaboration, let’s start a conversation.</p>
                <div className="ct-alt">
                  <p>Prefer to email us?</p>
                  <a href={`mailto:${ENQUIRY_EMAIL}`}>{MAIL}{ENQUIRY_EMAIL}</a>
                </div>
              </div>

              {done ? (
                <div className="ct-form" role="status">
                  <h3>Thank you, {f.contactName.split(' ')[0]}.</h3>
                  <p className="ct-note">Your enquiry for <b>{f.institutionName}</b> has been sent to the UniRise team. We will contact you at <b>{f.email}</b> to discuss onboarding and implementation.</p>
                  <div className="ct-actions"><button type="button" className="ct-submit" onClick={() => { setF(EMPTY); setDone(false); }}>Send another enquiry</button></div>
                </div>
              ) : (
                <form className="ct-form" onSubmit={submit} noValidate>
                  <div className="ct-head">
                    <h3>Tell Us About Your Organisation</h3>
                    <p className="ct-note">Fields marked <span aria-hidden>*</span><span className="sr-only">with an asterisk</span> are required.</p>
                  </div>
                  <fieldset disabled={busy}>
                    <legend className="sr-only">Organisation and contact details</legend>
                    <div className="ct-grid">
                      {input('institutionName', 'Organisation name', 'Your organisation', { auto: 'organization' })}
                      {select('institutionType', 'Organisation type', 'Select organisation type', TYPES)}
                      {input('contactName', 'Contact name', 'Your full name', { auto: 'name' })}
                      {input('designation', 'Designation', 'Your role or title', { optional: true, auto: 'organization-title' })}
                      {input('email', 'Work email', 'you@organisation.com', { type: 'email', auto: 'email' })}
                      {input('phone', 'Phone', '+91 98765 43210', { type: 'tel', optional: true, auto: 'tel' })}
                      {input('country', 'Country', 'Country', { auto: 'country-name' })}
                      {input('state', 'State', 'State', { auto: 'address-level1' })}
                      {input('city', 'City', 'City', { auto: 'address-level2' })}
                      {select('facultyCount', 'Approximate number of faculty members', 'Select a range', SIZES)}
                    </div>
                    {select('interest', 'Area of interest', 'What would you like to explore?', INTERESTS)}
                    <div className="ct-field">
                      {label('message', 'Message', true)}
                      <textarea id="ct-message" rows={4} maxLength={2000} placeholder="Share your goals, the people you’d like to support, or any questions for our team." value={f.message} onChange={(e) => set('message', e.target.value)} />
                      <p className="ct-count">{f.message.length} / 2,000 characters</p>
                    </div>
                    <input className="me-hp" tabIndex={-1} autoComplete="off" aria-hidden value={f.website} onChange={(e) => set('website', e.target.value)} />
                    <label className="ct-consent">
                      <input type="checkbox" checked={!!f.consent} onChange={(e) => set('consent', e.target.checked ? 'yes' : '')} />
                      <span>I agree that MentorEDGE may use these details to contact me about this enquiry, as described in the <a href="https://mentoredge.co.in/privacy" target="_blank" rel="noreferrer">Privacy Policy</a>.<span className="ct-req"> *</span></span>
                    </label>
                    {err('consent')}
                    {error && <p className="ct-err" role="alert">{error}</p>}
                    <div className="ct-actions">
                      <button type="submit" className="ct-submit" disabled={busy}>{busy ? 'Sending…' : 'Send enquiry'}{!busy && ARROW}</button>
                      <p className="ct-note">No account needed. This form is for organisational enquiries.</p>
                    </div>
                  </fieldset>
                </form>
              )}
            </section>
          </div>
        </section>
      </main>
      <PublicFooter />
    </div>
  );
}
