import { useState } from 'react';
import { Alert, Field, Input, NumberInput, PageTitle, Panel, TextArea, useToast } from '../../components/ui';
import { DEFAULT_WEIGHTS } from '../../lib/seed';
import { addNotice, deleteNotice, saveSettings, useStore } from '../../lib/store';
import type { Settings, Targets, Weights } from '../../lib/types';
import { MONTHS } from '../../lib/types';
import { fmtDate } from '../../lib/analytics';

/** Institution & Departments, Targets & Scoring and Notices: administered by the institution's Office of Research. */
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

