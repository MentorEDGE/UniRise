import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Alert, Attainment, Field, Input, NumberInput, PageTitle, Panel, Select, TextArea, useToast } from '../../components/ui';
import { biodataCompleteness, fmtDate, inr, isSanctioned } from '../../lib/analytics';
import { creditedFaculty, saveBiodata, saveFaculty, useStore } from '../../lib/store';
import type { Biodata, Experience, Faculty, Membership, Qualification } from '../../lib/types';

function useTarget() {
  const { db, user } = useStore();
  const { id } = useParams();
  const facultyId = id ?? user?.facultyId ?? '';
  const f = db.faculty.find((x) => x.id === facultyId);
  const b = db.biodata.find((x) => x.facultyId === facultyId);
  return { db, user, f, b, facultyId, canEdit: user?.role === 'management' || user?.facultyId === facultyId };
}

export function BiodataView() {
  const { db, f, b, canEdit, facultyId, user } = useTarget();
  if (user?.role === 'faculty' && facultyId !== user.facultyId) return <Panel><Alert kind="error">Profile details are private. You can only see your own.</Alert></Panel>;
  if (!f) return <Panel><Alert kind="error">Faculty member not found.</Alert></Panel>;
  const approved = <T extends { status: string }>(xs: T[]) => xs.filter((x) => x.status === 'Approved');
  const pubs = approved(db.publications).filter((p) => creditedFaculty('publications', p).includes(facultyId)).sort((a, z) => z.year - a.year);
  const grants = approved(db.grants).filter((g) => creditedFaculty('grants', g).includes(facultyId)).sort((a, z) => z.appliedDate.localeCompare(a.appliedDate));
  const fdps = approved(db.fdps).filter((x) => x.facultyId === facultyId).sort((a, z) => z.fromDate.localeCompare(a.fromDate));
  const confs = approved(db.conferences).filter((x) => x.facultyId === facultyId).sort((a, z) => z.fromDate.localeCompare(a.fromDate));
  const honours = approved(db.awards).filter((x) => x.facultyId === facultyId).sort((a, z) => z.awardDate.localeCompare(a.awardDate));
  const legacyAwards = b?.awards ?? []; // noted in the profile before Honours & Awards became its own section
  const pct = biodataCompleteness(b, f);
  const editPath = user?.role === 'management' ? `/faculty/${f.id}/biodata/edit` : '/biodata/edit';
  return (
    <>
      <PageTitle>{user?.role === 'faculty' ? 'My Profile' : 'Faculty Profile'}</PageTitle>
      <div className="panel wide no-print" style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 220 }}><b>Profile completeness</b><Attainment value={pct} target={100} /></div>
        {canEdit && <Link className="btn" to={editPath}>Edit Profile</Link>}
        <button className="btn secondary" onClick={() => window.print()}>Print / Save as PDF</button>
      </div>
      <article className="cv">
        <h1>{f.title} {f.name}</h1>
        <div>{f.designation}, {f.department}<br />{db.settings.institutionName}</div>
        <div className="muted" style={{ marginTop: 4 }}>
          Employee Code: {f.id} · {f.email} · {f.phone}{f.orcid && ` · ORCID ${f.orcid}`}{f.scopusId && ` · Scopus ID ${f.scopusId}`}
        </div>
        {b?.summary && <><h2>Summary</h2><p style={{ margin: 0 }}>{b.summary}</p></>}
        {b?.researchInterests && <p><b>Research interests:</b> {b.researchInterests}</p>}
        <h2>Personal Details</h2>
        <dl className="kv">
          <dt>Date of Birth</dt><dd>{fmtDate(b?.dob ?? '') || '—'}</dd><dt>Gender</dt><dd>{b?.gender || '—'}</dd>
          <dt>Address</dt><dd>{b?.address || '—'}</dd><dt>Date of Joining</dt><dd>{fmtDate(f.joiningDate)}</dd>
          <dt>Google Scholar</dt><dd>{b?.googleScholar ? <a href={b.googleScholar} target="_blank" rel="noreferrer">{b.googleScholar}</a> : '—'}</dd>
          <dt>Ph.D. guidance</dt><dd>{b?.phdGuided ?? 0} awarded, {b?.phdOngoing ?? 0} ongoing</dd>
        </dl>
        <h2>Educational Qualifications</h2>
        {b?.qualifications.length ? <ol>{b.qualifications.map((q, i) => <li key={i}><b>{q.degree}</b>{q.specialization && ` in ${q.specialization}`}, {q.institution} ({q.year})</li>)}</ol> : <p className="muted">Not entered.</p>}
        <h2>Experience</h2>
        {b?.experience.length ? <ol>{b.experience.map((x, i) => <li key={i}>{x.designation}, {x.organisation} ({x.from} – {x.to})</li>)}</ol> : <p className="muted">Not entered.</p>}
        <h2>Publications ({pubs.length})</h2>
        {pubs.length ? <ol>{pubs.map((p) => <li key={p.id}>{p.authors.map((a) => a.name.replace(/^(Dr\.|Prof\.|Mr\.|Ms\.)\s*/, '')).join(', ')}. “{p.title}”, <i>{p.venue}</i>, {p.month} {p.year}. {p.indexing !== 'Not Indexed' && `[${p.indexing}${p.quartile !== 'NA' ? `, ${p.quartile}` : ''}]`} {p.doi}</li>)}</ol> : <p className="muted">No approved publications.</p>}
        <h2>Research Grants ({grants.length})</h2>
        {grants.length ? <ol>{grants.map((g) => <li key={g.id}>“{g.title}”, {g.agency}, {g.investigators.find((i) => i.code === facultyId)?.role ?? 'Investigator'}, applied {fmtDate(g.appliedDate)} for {inr(g.appliedAmount)} — {g.outcome}{isSanctioned(g) && ` (${inr(g.sanctionedAmount)})`}</li>)}</ol> : <p className="muted">No approved grant entries.</p>}
        <h2>Faculty Development Programmes ({fdps.length}, {fdps.reduce((a, x) => a + x.hours, 0)} hours)</h2>
        {fdps.length ? <ol>{fdps.map((x) => <li key={x.id}>{x.role}: {x.programmeType} on “{x.title}”, {x.organiser}, {fmtDate(x.fromDate)}–{fmtDate(x.toDate)} ({x.hours} h, {x.mode})</li>)}</ol> : <p className="muted">No approved FDPs.</p>}
        <h2>Conference Participation ({confs.length})</h2>
        {confs.length ? <ol>{confs.map((c) => <li key={c.id}>{c.participation}{c.paperTitle && `: “${c.paperTitle}”`}, {c.conferenceName}, {c.venue}, {c.country}, {fmtDate(c.fromDate)}{c.award && ` — ${c.award}`}</li>)}</ol> : <p className="muted">No approved conference entries.</p>}
        <h2>Honours &amp; Awards ({honours.length + legacyAwards.length})</h2>
        {honours.length + legacyAwards.length ? (
          <ol>
            {honours.map((a) => <li key={a.id}><b>{a.title}</b>, {a.awardedBy} ({a.level}, {fmtDate(a.awardDate)}){a.citation && ` — ${a.citation}`}</li>)}
            {legacyAwards.map((a, i) => <li key={`l${i}`}>{a.title}, {a.by} ({a.year})</li>)}
          </ol>
        ) : <p className="muted">No approved honours or awards.</p>}
        <h2>Professional Memberships</h2>
        {b?.memberships.length ? <ol>{b.memberships.map((m, i) => <li key={i}>{m.type}, {m.body} (since {m.since})</li>)}</ol> : <p className="muted">Not entered.</p>}
        <p className="muted" style={{ marginTop: 18, fontSize: 11 }}>Generated {fmtDate(new Date().toISOString())}. Publications, grants, FDPs, conferences and honours list approved entries only. Profile last updated {fmtDate(b?.updatedAt ?? '')}.</p>
      </article>
    </>
  );
}

function Repeat<T extends object>({ title, rows, onChange, blank, cols }: {
  title: string; rows: T[]; onChange: (r: T[]) => void; blank: T; cols: { key: keyof T; label: string; placeholder?: string }[];
}) {
  return (
    <Panel title={title} size="wide" actions={<button type="button" className="btn sm" onClick={() => onChange([...rows, { ...blank }])}>+ Add</button>}>
      <div className="tbl-wrap">
        <table className="tbl">
          <thead><tr>{cols.map((c) => <th key={String(c.key)}>{c.label}</th>)}<th /></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                {cols.map((c) => <td key={String(c.key)}><input type="text" aria-label={`${c.label} ${i + 1}`} placeholder={c.placeholder} value={String(r[c.key] ?? '')} onChange={(e) => onChange(rows.map((x, j) => (j === i ? { ...x, [c.key]: e.target.value } : x)))} /></td>)}
                <td><button type="button" className="link-btn" onClick={() => onChange(rows.filter((_, j) => j !== i))}>Remove</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <div className="empty">None added.</div>}
      </div>
    </Panel>
  );
}

export function BiodataEdit() {
  const { f, b, canEdit, facultyId, user } = useTarget();
  const nav = useNavigate();
  const toast = useToast();
  const [bio, setBio] = useState<Biodata>(() => structuredClone(b ?? { facultyId, dob: '', gender: '', address: '', summary: '', researchInterests: '', googleScholar: '', phdGuided: 0, phdOngoing: 0, qualifications: [], experience: [], awards: [], memberships: [], updatedAt: '' }));
  const [fac, setFac] = useState<Faculty | undefined>(() => (f ? { ...f } : undefined));
  const [error, setError] = useState('');
  if (!f || !fac) return <Panel><Alert kind="error">Faculty member not found.</Alert></Panel>;
  if (!canEdit) return <Panel><Alert kind="error">You can only edit your own profile.</Alert></Panel>;
  const u = (p: Partial<Biodata>) => setBio({ ...bio, ...p });
  const save = async () => {
    if (fac.orcid && !/^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/.test(fac.orcid)) { setError('ORCID must look like 0000-0002-1825-0097.'); return; }
    if (fac.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(fac.email)) { setError('Enter a valid email address.'); return; }
    if (bio.dob && bio.dob > new Date().toISOString().slice(0, 10)) { setError('Date of birth cannot be in the future.'); return; }
    try {
      await saveFaculty(fac);
      await saveBiodata({ ...bio, qualifications: bio.qualifications.filter((q) => q.degree.trim()), experience: bio.experience.filter((x) => x.organisation.trim()), awards: bio.awards.filter((a) => a.title.trim()), memberships: bio.memberships.filter((m) => m.body.trim()) });
      toast('Profile saved.');
      nav(user?.role === 'management' ? `/faculty/${f.id}/biodata` : '/biodata');
    } catch (e) { setError((e as Error).message); }
  };
  return (
    <>
      <PageTitle>Edit Profile</PageTitle>
      {error && <div className="panel wide"><Alert kind="error">{error}</Alert></div>}
      <Panel title="Official Details" size="wide">
        <div className="grid">
          <Field label="Employee Code"><input type="text" readOnly value={f.id} /></Field>
          <Field label="Name"><input type="text" readOnly value={`${f.title} ${f.name}`} /></Field>
          <Field label="Designation"><input type="text" readOnly value={f.designation} /></Field>
          <Field label="Department"><input type="text" readOnly value={f.department} /></Field>
          <Field label="Email"><Input value={fac.email} onChange={(v) => setFac({ ...fac, email: v })} type="email" /></Field>
          <Field label="Phone"><Input value={fac.phone} onChange={(v) => setFac({ ...fac, phone: v })} /></Field>
          <Field label="ORCID ID"><Input value={fac.orcid} onChange={(v) => setFac({ ...fac, orcid: v })} placeholder="0000-0000-0000-0000" /></Field>
          <Field label="Scopus Author ID"><Input value={fac.scopusId} onChange={(v) => setFac({ ...fac, scopusId: v })} /></Field>
        </div>
        <p className="note">Name, designation and department are maintained by management.</p>
      </Panel>
      <Panel title="Personal Details" size="wide">
        <div className="grid">
          <Field label="Date of Birth"><input type="date" value={bio.dob} onChange={(e) => u({ dob: e.target.value })} /></Field>
          <Field label="Gender"><Select value={bio.gender} onChange={(v) => u({ gender: v })} options={['Female', 'Male', 'Other', 'Prefer not to say']} placeholder="--Select--" /></Field>
          <Field label="Google Scholar URL" className="span2"><Input value={bio.googleScholar} onChange={(v) => u({ googleScholar: v })} /></Field>
          <Field label="Address" className="span2"><TextArea value={bio.address} onChange={(v) => u({ address: v })} /></Field>
          <Field label="Ph.D. students guided (awarded)"><NumberInput value={bio.phdGuided} onChange={(v) => u({ phdGuided: v })} min={0} /></Field>
          <Field label="Ph.D. students ongoing"><NumberInput value={bio.phdOngoing} onChange={(v) => u({ phdOngoing: v })} min={0} /></Field>
          <Field label="Profile summary" className="span2"><TextArea value={bio.summary} onChange={(v) => u({ summary: v })} rows={3} /></Field>
          <Field label="Research interests" className="span2" hint="Separate with semicolons"><TextArea value={bio.researchInterests} onChange={(v) => u({ researchInterests: v })} rows={3} /></Field>
        </div>
      </Panel>
      <Repeat<Qualification> title="Educational Qualifications" rows={bio.qualifications} onChange={(r) => u({ qualifications: r })} blank={{ degree: '', specialization: '', institution: '', year: '' }}
        cols={[{ key: 'degree', label: 'Degree', placeholder: 'Ph.D.' }, { key: 'specialization', label: 'Specialisation' }, { key: 'institution', label: 'Institution / University' }, { key: 'year', label: 'Year' }]} />
      <Repeat<Experience> title="Experience" rows={bio.experience} onChange={(r) => u({ experience: r })} blank={{ organisation: '', designation: '', from: '', to: '' }}
        cols={[{ key: 'organisation', label: 'Organisation' }, { key: 'designation', label: 'Designation' }, { key: 'from', label: 'From (year)' }, { key: 'to', label: 'To (year / Present)' }]} />
      <div className="panel wide no-print"><p className="note" style={{ margin: 0 }}>Honours and awards are recorded under <b>Honours &amp; Awards</b>, with a certificate, and appear here once approved.{user?.role === 'faculty' && <> <Link to="/awards/entry">Add an honour or award</Link></>}</p></div>
      <Repeat<Membership> title="Professional Memberships" rows={bio.memberships} onChange={(r) => u({ memberships: r })} blank={{ body: '', type: '', since: '' }}
        cols={[{ key: 'body', label: 'Professional body' }, { key: 'type', label: 'Membership type' }, { key: 'since', label: 'Since (year)' }]} />
      <div className="btn-row">
        <button className="btn secondary" onClick={() => nav(-1)}>Cancel</button>
        <button className="btn ok" onClick={save}>Save Profile</button>
      </div>
    </>
  );
}
