import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Alert, NumberInput, Select, TextArea, useToast } from '../../components/ui';
import { ENTITIES } from '../../lib/entities';
import { emptyBase, getDB, isEditable, saveRecord, useStore } from '../../lib/store';
import type { AnyRecord, Author, AuthorKind, EntityKind, Investigator } from '../../lib/types';
import { AUTHOR_KINDS } from '../../lib/types';

export type Errors = Record<string, string>;

/**
 * Loads `?id=` for editing (owner + Draft/Rework only) or starts a blank record,
 * and returns save handlers that run the form's validation first.
 */
export function useEntry<T extends AnyRecord>(kind: EntityKind, blank: (facultyId: string) => Omit<T, keyof ReturnType<typeof emptyBase>>, validate: (r: T, submit: boolean) => Errors) {
  const { db, user } = useStore();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const toast = useToast();
  const id = params.get('id');
  const initial = useMemo(() => {
    const existing = id ? (getDB()[kind] as AnyRecord[]).find((r) => r.id === id) : undefined;
    if (existing) return structuredClone(existing) as T;
    return { ...emptyBase(user!.facultyId!), ...blank(user!.facultyId!) } as unknown as T;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, kind]);
  const [rec, setRec] = useState<T>(initial);
  const [errors, setErrors] = useState<Errors>({});
  const [failure, setFailure] = useState('');
  const [note, setNote] = useState(''); // reply to the Office of Research, sent with a resubmission

  const existing = id ? (db[kind] as AnyRecord[]).find((r) => r.id === id) : undefined;
  let blocked = '';
  if (id && !existing) blocked = `Entry ${id} was not found.`;
  else if (existing && existing.facultyId !== user?.facultyId) blocked = 'You can only edit entries you created.';
  else if (existing && !isEditable(existing)) blocked = `Entry ${id} is ${existing.status.toLowerCase()} and can no longer be edited.`;

  const update = (patch: Partial<T>) => setRec((r) => ({ ...r, ...patch }));
  const [busy, setBusy] = useState(false);
  const save = async (submit: boolean) => {
    if (busy) return;
    const errs = validate(rec, submit);
    setErrors(errs);
    if (Object.keys(errs).length) { setFailure('Please correct the highlighted fields.'); window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    setBusy(true);
    try {
      const savedId = await saveRecord(kind, rec, submit, submit ? note : '');
      toast(submit ? `${ENTITIES[kind].label} ${savedId} ${existing?.status === 'Rework' ? 'resubmitted' : 'submitted for approval'}.` : `Draft ${savedId} saved.`);
      nav(ENTITIES[kind].viewPath);
    } catch (e) { setFailure((e as Error).message); window.scrollTo({ top: 0, behavior: 'smooth' }); } finally { setBusy(false); }
  };
  const banner = (
    <>
      {failure && <Alert kind="error">{failure}</Alert>}
      {existing?.status === 'Rework' && (
        <Alert kind="info">
          Changes requested by the Office of Research: <b>{[...existing.history].reverse().find((h) => h.remark && (h.action === 'Returned for correction' || h.action === 'Sent for rework'))?.remark}</b>
          <label style={{ display: 'block', marginTop: 8 }}>Your reply (optional, sent when you resubmit)<TextArea value={note} onChange={setNote} /></label>
        </Alert>
      )}
    </>
  );
  return { rec, update, setRec, errors, save, blocked, banner, isNew: !existing, resubmit: existing?.status === 'Rework' };
}

export function SaveBar({ onSave, isNew, resubmit }: { onSave: (submit: boolean) => void; isNew: boolean; resubmit?: boolean }) {
  const nav = useNavigate();
  return (
    <div className="btn-row">
      <button className="btn secondary" type="button" onClick={() => nav(-1)}>Cancel</button>
      <button className="btn" type="button" onClick={() => onSave(false)}>{isNew ? 'Save Draft' : 'Save'}</button>
      <button className="btn ok" type="button" onClick={() => onSave(true)}>{resubmit ? 'Resubmit for Approval' : 'Submit for Approval'}</button>
    </div>
  );
}

/** Fills name/department/email for internal faculty from the employee code. */
function lookupFaculty(code: string) {
  const f = getDB().faculty.find((x) => x.id.toLowerCase() === code.trim().toLowerCase());
  return f ? { code: f.id, name: `${f.title} ${f.name}`, institution: getDB().settings.institutionName, department: f.department, email: f.email } : null;
}
const isInternal = (k: AuthorKind) => k !== 'External';

export function AuthorTable({ value, onChange, error }: { value: Author[]; onChange: (v: Author[]) => void; error?: string }) {
  const { db } = useStore();
  const set = (i: number, patch: Partial<Author>) => onChange(value.map((a, j) => (j === i ? { ...a, ...patch } : a)));
  return (
    <div>
      <button type="button" className="btn sm" onClick={() => onChange([...value, { kind: 'Faculty', code: '', name: '', institution: db.settings.institutionName, department: '', email: '' }])}>Add New Author</button>
      <div className="tbl-wrap" style={{ marginTop: 6 }}>
        <table className="tbl">
          <thead><tr><th>#</th><th>Internal / External</th><th>Roll No / Employee Code</th><th>Author Name</th><th>Institution Name</th><th>Country (external)</th><th>Department / Course</th><th>Mail Id</th><th /></tr></thead>
          <tbody>
            {value.map((a, i) => (
              <tr key={i}>
                <td>{i + 1}</td>
                <td><Select value={a.kind} onChange={(v) => set(i, { kind: v as AuthorKind, institution: isInternal(v as AuthorKind) ? db.settings.institutionName : '' })} options={AUTHOR_KINDS} aria-label={`Author ${i + 1} type`} /></td>
                <td><input type="text" value={a.code} disabled={a.kind === 'External'} aria-label={`Author ${i + 1} code`}
                  onChange={(e) => set(i, { code: e.target.value })}
                  onBlur={(e) => { if (a.kind === 'Faculty') { const f = lookupFaculty(e.target.value); if (f) set(i, f); } }} list="faculty-codes" /></td>
                <td><input type="text" value={a.name} onChange={(e) => set(i, { name: e.target.value })} aria-label={`Author ${i + 1} name`} /></td>
                <td><input type="text" value={a.institution} onChange={(e) => set(i, { institution: e.target.value })} aria-label={`Author ${i + 1} institution`} /></td>
                <td><input type="text" value={a.country ?? ''} disabled={a.kind !== 'External'} list="country-names" onChange={(e) => set(i, { country: e.target.value })} aria-label={`Author ${i + 1} country`} /></td>
                <td><input type="text" value={a.department} onChange={(e) => set(i, { department: e.target.value })} aria-label={`Author ${i + 1} department`} /></td>
                <td><input type="email" value={a.email} onChange={(e) => set(i, { email: e.target.value })} aria-label={`Author ${i + 1} email`} /></td>
                <td className="row-actions">
                  <button type="button" className="link-btn" disabled={i === 0} onClick={() => { const v = [...value]; [v[i - 1], v[i]] = [v[i], v[i - 1]]; onChange(v); }} aria-label="Move up">↑</button>
                  <button type="button" className="link-btn" onClick={() => onChange(value.filter((_, j) => j !== i))} aria-label="Remove author">Remove</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <CountryList />
        {!value.length && <div className="empty">No authors yet.</div>}
      </div>
      <datalist id="faculty-codes">{db.faculty.filter((f) => f.active).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</datalist>
      {error && <div className="field"><span className="err">{error}</span></div>}
    </div>
  );
}

export function InvestigatorTable({ value, onChange, error }: { value: Investigator[]; onChange: (v: Investigator[]) => void; error?: string }) {
  const { db } = useStore();
  const set = (i: number, patch: Partial<Investigator>) => onChange(value.map((a, j) => (j === i ? { ...a, ...patch } : a)));
  const total = value.reduce((a, x) => a + (x.sharePct || 0), 0);
  return (
    <div>
      <button type="button" className="btn sm" onClick={() => onChange([...value, { kind: 'Faculty', code: '', name: '', role: 'Co-PI', institution: db.settings.institutionName, department: '', sharePct: 0 }])}>Add New Investigator</button>
      <div className="tbl-wrap" style={{ marginTop: 6 }}>
        <table className="tbl">
          <thead><tr><th>Internal / External</th><th>Roll No / Employee Code</th><th>Name</th><th>Investigator Type</th><th>Institution Name</th><th>Country (external)</th><th>Department</th><th className="num">Share %</th><th /></tr></thead>
          <tbody>
            {value.map((a, i) => (
              <tr key={i}>
                <td><Select value={a.kind} onChange={(v) => set(i, { kind: v as AuthorKind })} options={AUTHOR_KINDS} aria-label="Investigator type" /></td>
                <td><input type="text" value={a.code} disabled={a.kind === 'External'} list="faculty-codes-inv" aria-label="Employee code"
                  onChange={(e) => set(i, { code: e.target.value })}
                  onBlur={(e) => { if (a.kind === 'Faculty') { const f = lookupFaculty(e.target.value); if (f) set(i, { code: f.code, name: f.name, institution: f.institution, department: f.department }); } }} /></td>
                <td><input type="text" value={a.name} onChange={(e) => set(i, { name: e.target.value })} aria-label="Name" /></td>
                <td><Select value={a.role} onChange={(v) => set(i, { role: v as Investigator['role'] })} options={['PI', 'Co-PI', 'Co-I']} aria-label="Role" /></td>
                <td><input type="text" value={a.institution} onChange={(e) => set(i, { institution: e.target.value })} aria-label="Institution" /></td>
                <td><input type="text" value={a.country ?? ''} disabled={a.kind !== 'External'} list="country-names" onChange={(e) => set(i, { country: e.target.value })} aria-label="Country" /></td>
                <td><input type="text" value={a.department} onChange={(e) => set(i, { department: e.target.value })} aria-label="Department" /></td>
                <td style={{ width: 80 }}><NumberInput value={a.sharePct} onChange={(v) => set(i, { sharePct: v })} min={0} max={100} aria-label="Share percent" /></td>
                <td><button type="button" className="link-btn" disabled={i === 0} onClick={() => onChange(value.filter((_, j) => j !== i))}>Remove</button></td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr><td colSpan={6}>Total share</td><td className="num" style={{ color: total === 100 ? undefined : 'var(--bad)' }}>{total}%</td><td /></tr></tfoot>
        </table>
        <CountryList />
      </div>
      <datalist id="faculty-codes-inv">{db.faculty.filter((f) => f.active).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</datalist>
      {error && <div className="field"><span className="err">{error}</span></div>}
    </div>
  );
}

/** First row for the signed-in faculty member. */
export function selfAuthor(facultyId: string): Author {
  const db = getDB();
  const f = db.faculty.find((x) => x.id === facultyId)!;
  return { kind: 'Faculty', code: f.id, name: `${f.title} ${f.name}`, institution: db.settings.institutionName, department: f.department, email: f.email };
}
export function selfInvestigator(facultyId: string, sharePct = 100): Investigator {
  const a = selfAuthor(facultyId);
  return { kind: 'Faculty', code: a.code, name: a.name, role: 'PI', institution: a.institution, department: a.department, sharePct };
}

export function validateInvestigators(list: Investigator[], selfId: string, errs: Errors) {
  if (!list.length) errs.investigators = 'Add at least one investigator.';
  else if (!list.some((i) => i.code === selfId)) errs.investigators = 'You must be one of the investigators.';
  else if (list.reduce((a, x) => a + (x.sharePct || 0), 0) !== 100) errs.investigators = 'Investigator shares must add up to 100%.';
  else if (list.filter((i) => i.role === 'PI').length !== 1) errs.investigators = 'There must be exactly one PI.';
  else if (list.some((i) => !i.name.trim())) errs.investigators = 'Every investigator needs a name.';
}

export const BlockedEntry = ({ msg }: { msg: string }) => <div className="panel"><Alert kind="error">{msg}</Alert></div>;

/** Suggestions for the country of an external collaborator (shown on the collaboration map). Free text is allowed. */
const COUNTRIES = ['Australia', 'Austria', 'Bangladesh', 'Belgium', 'Brazil', 'Canada', 'China', 'Denmark', 'Egypt', 'Finland', 'France', 'Germany', 'Hong Kong', 'India', 'Indonesia', 'Iran', 'Ireland', 'Israel', 'Italy', 'Japan', 'Kenya', 'Malaysia', 'Mexico', 'Nepal', 'Netherlands', 'New Zealand', 'Nigeria', 'Norway', 'Oman', 'Pakistan', 'Poland', 'Portugal', 'Qatar', 'Russia', 'Saudi Arabia', 'Singapore', 'South Africa', 'South Korea', 'Spain', 'Sri Lanka', 'Sweden', 'Switzerland', 'Taiwan', 'Thailand', 'Turkey', 'United Arab Emirates', 'United Kingdom', 'United States', 'Vietnam'];
function CountryList() {
  return <datalist id="country-names">{COUNTRIES.map((c) => <option key={c} value={c} />)}</datalist>;
}
