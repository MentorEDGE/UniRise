import { useState } from 'react';
import { Alert, Field, Input, NumberInput, PageTitle, Panel, Select, Tabs, TextArea, useToast } from '../../components/ui';
import { schoolOf } from '../../lib/org';
import { ENTITY_LABEL, OPTION_LISTS, kindOn, listOf } from '../../lib/types';
import type { AnyRecord, CustomField, EntityKind, ListKey } from '../../lib/types';

const RECORD_KINDS: EntityKind[] = ['publications', 'grants', 'seedMoney', 'fdps', 'conferences', 'awards', 'ipr'];
import { DEFAULT_WEIGHTS } from '../../lib/seed';
import { addNotice, deleteNotice, saveSettings, useStore } from '../../lib/store';
import type { Settings, Targets, Weights } from '../../lib/types';
import { MONTHS } from '../../lib/types';
import { fmtDate, plural } from '../../lib/analytics';

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
  const [newSchool, setNewSchool] = useState('');
  const inUse = (d: string) => db.faculty.some((f) => f.department === d);
  const schools = s.schools ?? [];
  /** Puts a department in a school (and takes it out of any other). */
  const moveTo = (d: string, school: string) => setS({ ...s, schools: schools.map((x) => ({ ...x, departments: x.name === school ? [...x.departments.filter((y) => y !== d), d] : x.departments.filter((y) => y !== d) })) });
  return (
    <>
      <PageTitle sub="The institution's name, its schools (for a university) and its departments, as shown across UniRise.">Institution & Departments</PageTitle>
      <Panel title="Institution" size="wide">
        {error && <Alert kind="error">{error}</Alert>}
        <div className="grid">
          <Field label="Institution name" required className="span2" hint="Shown in the header instead of a logo"><Input value={s.institutionName} onChange={(v) => setS({ ...s, institutionName: v })} /></Field>
          <Field label="Tagline" className="span2"><Input value={s.institutionTagline} onChange={(v) => setS({ ...s, institutionTagline: v })} /></Field>
          <Field label="Academic year starts in"><select value={s.academicYearStartMonth} onChange={(e) => setS({ ...s, academicYearStartMonth: Number(e.target.value) })}>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select></Field>
          <Field label="Seed money window"><select value={s.seedMoneyWindowOpen ? 'open' : 'closed'} onChange={(e) => setS({ ...s, seedMoneyWindowOpen: e.target.value === 'open' })}><option value="open">Open – accepting proposals</option><option value="closed">Closed for this quarter</option></select></Field>
        </div>
      </Panel>
      <Panel title="Record types" size="wide">
        <p className="note" style={{ marginTop: 0 }}>The kinds of research activity your institution records. A type that is switched off disappears from every menu and form, and no new entries of it can be made. Entries already made stay in the records.</p>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
          {RECORD_KINDS.map((k) => (
            <label key={k} className="check-row">
              <input type="checkbox" checked={kindOn(s, k)} onChange={(e) => setS({ ...s, features: { ...(s.features ?? {}), [k]: e.target.checked } })} />
              <span><b>{ENTITY_LABEL[k]}</b> <span className="muted">· {plural((db[k] as AnyRecord[]).length, 'entry', 'entries')}</span></span>
            </label>
          ))}
        </div>
      </Panel>
      <Panel title="Schools" size="wide">
        <p className="note" style={{ marginTop: 0 }}>For a university organised in schools (or faculties), each holding some of the departments. Leave this empty for an institute or college. With schools, every list that can be narrowed by department can also be narrowed to a whole school.</p>
        {schools.length > 0 && (
          <div className="tbl-wrap"><table className="tbl">
            <thead><tr><th>School</th><th className="num">Departments</th><th className="num">Faculty</th><th /></tr></thead>
            <tbody>{schools.map((sc) => (
              <tr key={sc.name}><td>{sc.name}</td><td className="num">{sc.departments.length}</td>
                <td className="num">{db.faculty.filter((f) => sc.departments.includes(f.department)).length}</td>
                <td><button className="link-btn" disabled={sc.departments.length > 0} title={sc.departments.length ? 'Move its departments to another school first' : undefined}
                  onClick={() => setS({ ...s, schools: schools.filter((x) => x.name !== sc.name) })}>Remove</button></td></tr>
            ))}</tbody>
          </table></div>
        )}
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <div style={{ flex: 1 }}><Input value={newSchool} onChange={setNewSchool} placeholder="New school name, e.g. School of Engineering" aria-label="New school" /></div>
          <button className="btn" onClick={() => { const n = newSchool.trim(); if (n && !schools.some((x) => x.name.toLowerCase() === n.toLowerCase())) { setS({ ...s, schools: [...schools, { name: n, departments: [] }] }); setNewSchool(''); } }}>Add school</button>
        </div>
      </Panel>
      <Panel title="Departments" size="wide">
        <div className="tbl-wrap"><table className="tbl">
          <thead><tr><th>Department</th>{schools.length > 0 && <th>School</th>}<th className="num">Faculty</th><th /></tr></thead>
          <tbody>{s.departments.map((d) => (
            <tr key={d}><td>{d}</td>
              {schools.length > 0 && <td><Select value={schoolOf(s, d)} onChange={(v) => moveTo(d, v)} options={schools.map((x) => x.name)} placeholder="Choose a school…" aria-label={`School of ${d}`} /></td>}
              <td className="num">{db.faculty.filter((f) => f.department === d).length}</td>
              <td><button className="link-btn" disabled={inUse(d)} title={inUse(d) ? 'Move its faculty to another department first' : undefined}
                onClick={() => setS({ ...s, departments: s.departments.filter((x) => x !== d), schools: schools.map((x) => ({ ...x, departments: x.departments.filter((y) => y !== d) })) })}>Remove</button></td></tr>
          ))}</tbody>
        </table></div>
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <div style={{ flex: 1 }}><Input value={newDept} onChange={setNewDept} placeholder="New department name" aria-label="New department" /></div>
          <button className="btn" onClick={() => { const d = newDept.trim(); if (d && !s.departments.includes(d)) { setS({ ...s, departments: [...s.departments, d] }); setNewDept(''); } }}>Add</button>
        </div>
        {schools.length > 0 && s.departments.some((d) => !schoolOf(s, d)) && <p className="note">Choose a school for every department before saving.</p>}
      </Panel>
      <div className="btn-row"><button className="btn ok" onClick={save}>Save settings</button></div>
    </>
  );
}

/** Score weights, grouped the way the activities appear across UniRise. */
const WEIGHT_GROUPS: { title: string; items: [keyof Weights, string][] }[] = [
  { title: 'Publications', items: [['q1', 'Journal – Q1'], ['q2', 'Journal – Q2'], ['q3', 'Journal – Q3'], ['q4', 'Journal – Q4'], ['otherJournal', 'Journal – unranked'], ['book', 'Book'], ['chapter', 'Book chapter'], ['confPaper', 'Conference paper'], ['techReport', 'Technical report']] },
  { title: 'Grants & seed money', items: [['grantSanctioned', 'Grant sanctioned (base)'], ['grantPerLakh', 'Per ₹1 lakh sanctioned (max +20)'], ['seedMoney', 'Seed money approved']] },
  { title: 'Faculty development programmes', items: [['fdpAttended', 'Attended'], ['fdpOrganised', 'Organised'], ['fdpResource', 'Resource person']] },
  { title: 'Conferences', items: [['confPresented', 'Paper / poster presented'], ['confInvited', 'Invited talk / keynote'], ['confChair', 'Session chair'], ['confAttended', 'Attended'], ['confOrganised', 'Organised']] },
  { title: 'Honours & awards', items: [['awardInternational', 'International'], ['awardNational', 'National'], ['awardOther', 'State / institutional']] },
  { title: 'Intellectual property', items: [['patentGranted', 'Patent – granted'], ['patentFiled', 'Patent – filed / published'], ['design', 'Design – registered'], ['copyright', 'Copyright – registered'], ['trademark', 'Trademark – registered'], ['ipOther', 'Other IP – granted / registered']] },
];
const TARGET_LABELS: [keyof Targets, string][] = [['publicationsPerFaculty', 'Publications per faculty'], ['fdpHoursPerFaculty', 'FDP hours per faculty'], ['conferencesPerFaculty', 'Conferences per faculty'], ['grantAppliedPerFaculty', 'Grant proposals per faculty']];

export function TargetSettings() {
  const { s, setS, save, error } = useSettingsDraft();
  return (
    <>
      <PageTitle sub="Annual targets per faculty member, and the points each kind of approved activity earns.">Targets & Scoring</PageTitle>
      <Panel title="Annual targets (per faculty, per academic year)" size="wide">
        {error && <Alert kind="error">{error}</Alert>}
        <div className="grid">{TARGET_LABELS.map(([k, l]) => <Field key={k} label={l}><NumberInput value={s.targets[k]} min={0} step="0.5" onChange={(v) => setS({ ...s, targets: { ...s.targets, [k]: v } })} /></Field>)}</div>
      </Panel>
      <Panel title="Performance score weights" size="wide">
        <p className="note">Points for each approved entry. Co-authors each get the full points; sanctioned grant points are not split. Faculty can see their own score and their department average, not other people's scores.</p>
        {WEIGHT_GROUPS.map((g) => (
          <fieldset key={g.title} className="weight-group">
            <legend>{g.title}</legend>
            <div className="grid">{g.items.map(([k, l]) => <Field key={k} label={l}><NumberInput value={s.weights[k]} min={0} step="0.5" onChange={(v) => setS({ ...s, weights: { ...s.weights, [k]: v } })} /></Field>)}</div>
          </fieldset>
        ))}
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
      <PageTitle sub="Announcements shown to every faculty member on their workspace.">Notices</PageTitle>
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


const FIELD_TYPES: { value: CustomField['type']; label: string }[] = [
  { value: 'text', label: 'Text' }, { value: 'number', label: 'Number' }, { value: 'date', label: 'Date' },
  { value: 'yesno', label: 'Yes / No' }, { value: 'choice', label: 'Choice from a list' },
];

/**
 * Institution → Custom Fields (G29): up to 10 extra fields per record type. They appear on the entry form above the
 * Save buttons and in the record's details; the API checks them (required to submit, type, options).
 */
export function CustomFieldSettings() {
  const { s, setS, save, error } = useSettingsDraft();
  const [kind, setKind] = useState<EntityKind>('publications');
  const fields = s.customFields?.[kind] ?? [];
  const setFields = (next: CustomField[]) => setS({ ...s, customFields: { ...(s.customFields ?? {}), [kind]: next } });
  const change = (i: number, patch: Partial<CustomField>) => setFields(fields.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  const move = (i: number, d: number) => { const next = [...fields]; const [f] = next.splice(i, 1); next.splice(i + d, 0, f); setFields(next); };
  return (
    <>
      <PageTitle sub="Extra fields your institution needs on an entry, beyond the standard ones. Faculty fill them in on the form; the Office of Research sees them when reviewing.">Custom Fields</PageTitle>
      <Panel size="wide">
        {error && <Alert kind="error">{error}</Alert>}
        <Tabs value={kind} onChange={setKind} tabs={RECORD_KINDS.map((k) => ({ id: k, label: `${ENTITY_LABEL[k]}${s.customFields?.[k]?.length ? ` (${s.customFields[k]!.length})` : ''}` }))} />
        {fields.length === 0 && <p className="note">No custom fields for {ENTITY_LABEL[kind].toLowerCase()} entries yet.</p>}
        {fields.map((f, i) => (
          <fieldset key={f.id || `new-${i}`} className="custom-def">
            <div className="grid g2">
              <Field label="Label" required><Input value={f.label} onChange={(v) => change(i, { label: v })} placeholder="e.g. Funding scheme code" /></Field>
              <Field label="Type"><Select value={f.type} onChange={(v) => change(i, { type: v as CustomField['type'], options: v === 'choice' ? f.options ?? [] : undefined })} options={FIELD_TYPES} /></Field>
              {f.type === 'choice' && (
                <Field label="Options" hint="One per line, up to 20" className="span2">
                  <TextArea value={(f.options ?? []).join('\n')} onChange={(v) => change(i, { options: v.split('\n').slice(0, 21) })} /> {/* kept as typed (blank lines too, so Enter works); the API trims and drops blanks */}
                </Field>
              )}
            </div>
            <div className="btn-row left">
              <label className="check-inline"><input type="checkbox" checked={f.required} onChange={(e) => change(i, { required: e.target.checked })} /> Required to submit</label>
              <button type="button" className="link-btn" disabled={i === 0} onClick={() => move(i, -1)}>Move up</button>
              <button type="button" className="link-btn" disabled={i === fields.length - 1} onClick={() => move(i, 1)}>Move down</button>
              <button type="button" className="link-btn" onClick={() => setFields(fields.filter((_, j) => j !== i))}>Remove</button>
            </div>
          </fieldset>
        ))}
        <div className="btn-row left">
          <button type="button" className="btn secondary" disabled={fields.length >= 10} onClick={() => setFields([...fields, { id: '', label: '', type: 'text', required: false }])}>+ Add field</button>
          {fields.length >= 10 && <span className="muted">Up to 10 fields per record type.</span>}
        </div>
        <p className="note">Removing a field hides it everywhere; values already entered are kept with the entries. Renaming keeps the values.</p>
      </Panel>
      <div className="btn-row"><button className="btn ok" onClick={save}>Save settings</button></div>
    </>
  );
}

/**
 * Institution → Option Lists (G30): the institution's own wording of five plain-label lists. Lists that scoring,
 * reports or the API rely on stay fixed. Entries already made keep their value even if it is no longer in the list.
 */
export function OptionListSettings() {
  const { s, setS, save, error } = useSettingsDraft();
  const keys = Object.keys(OPTION_LISTS) as ListKey[];
  const setList = (k: ListKey, text: string) => setS({ ...s, lists: { ...(s.lists ?? {}), [k]: text.split('\n').slice(0, 51) } });
  return (
    <>
      <PageTitle sub="Word the choices on forms the way your institution does. Entries already made keep their value.">Option Lists</PageTitle>
      <Panel size="wide">
        {error && <Alert kind="error">{error}</Alert>}
        <div className="grid g2">
          {keys.map((k) => {
            const own = !!s.lists?.[k]?.some((x) => x.trim());
            return (
              <Field key={k} label={OPTION_LISTS[k].label} hint={own ? 'Your institution’s list · one per line, up to 50' : 'The default list · edit to make it your own'}>
                <TextArea value={(own ? s.lists![k]! : listOf(s, k)).join('\n')} onChange={(v) => setList(k, v)} />
                {own && <button type="button" className="link-btn" onClick={() => setS({ ...s, lists: { ...(s.lists ?? {}), [k]: [] } })}>Use the default list</button>}
              </Field>
            );
          })}
        </div>
        <p className="note">Fixed lists (publication types, quartiles, levels, conference roles, intellectual property types and conference funding) are used by scoring and reports, so they cannot be changed here.</p>
      </Panel>
      <div className="btn-row"><button className="btn ok" onClick={save}>Save settings</button></div>
    </>
  );
}
