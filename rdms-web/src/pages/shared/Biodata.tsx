import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Alert, Attainment, Field, Input, NumberInput, PageTitle, Panel, Select, TextArea, useToast } from '../../components/ui';
import { biodataCompleteness, displayPhone, fmtDate, inr, isSanctioned } from '../../lib/analytics';
import { creditedFaculty, proposeProfileChange, useStore } from '../../lib/store';
import { StatusBadge } from '../../components/ui';
import { PROFILE_LINKS, STATUS_LABEL, linkAllowed } from '../../lib/types';
import { ProgressTracker } from '../../components/workflow';
import { blankBiodata, normalizeBiodata, phdCounts } from '../../lib/domain';
import type { Biodata, Course, Engagement, Experience, Faculty, MediaItem, Membership, Qualification, Supervisee } from '../../lib/types';
import { COURSE_LEVELS, ENGAGEMENT_TYPES, MAX_HIGHLIGHTS, SDGS, SUPERVISION_DEGREES, SUPERVISION_STATUS, ipTypeLabel } from '../../lib/types';
import { highlightOptions } from '../../components/research';
import { Avatar, SdgIcon } from '../../components/research';

function useTarget() {
  const { db, user } = useStore();
  const { id } = useParams();
  const facultyId = id ?? user?.facultyId ?? '';
  const f = db.faculty.find((x) => x.id === facultyId);
  const b = db.biodata.find((x) => x.facultyId === facultyId);
  // Only the faculty member edits their own profile; every change goes to the Office of Research for approval.
  return { db, user, f, b, facultyId, canEdit: user?.role === 'faculty' && user.facultyId === facultyId };
}

export function BiodataView() {
  const { db, f, b, canEdit, facultyId, user } = useTarget();
  const [params] = useSearchParams();
  // "Download CV (PDF)" opens this page with ?print=1: the browser's print dialog offers "Save as PDF".
  useEffect(() => { if (params.get('print') === '1' && f) { const t = setTimeout(() => window.print(), 600); return () => clearTimeout(t); } }, [params, f]);
  if (user?.role === 'faculty' && facultyId !== user.facultyId) return <Panel><Alert kind="error">Profile details are private. You can only see your own.</Alert></Panel>;
  if (!f) return <Panel><Alert kind="error">Faculty member not found.</Alert></Panel>;
  const approved = <T extends { status: string }>(xs: T[]) => xs.filter((x) => x.status === 'Approved');
  const pubs = approved(db.publications).filter((p) => creditedFaculty('publications', p).includes(facultyId)).sort((a, z) => z.year - a.year);
  const grants = approved(db.grants).filter((g) => creditedFaculty('grants', g).includes(facultyId)).sort((a, z) => z.appliedDate.localeCompare(a.appliedDate));
  const fdps = approved(db.fdps).filter((x) => x.facultyId === facultyId).sort((a, z) => z.fromDate.localeCompare(a.fromDate));
  const confs = approved(db.conferences).filter((x) => x.facultyId === facultyId).sort((a, z) => z.fromDate.localeCompare(a.fromDate));
  const honours = approved(db.awards).filter((x) => x.facultyId === facultyId).sort((a, z) => z.awardDate.localeCompare(a.awardDate));
  const ipr = approved(db.ipr ?? []).filter((x) => x.facultyId === facultyId).sort((a, z) => z.filingDate.localeCompare(a.filingDate));
  const legacyAwards = b?.awards ?? []; // noted in the profile before Honours & Awards became its own section
  const pct = biodataCompleteness(b, f);
  const editPath = '/biodata/edit';
  return (
    <>
      <PageTitle sub="Print it, or save it as a PDF from the print dialog.">Curriculum Vitae</PageTitle>
      <div className="panel wide no-print" style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 220 }}><b>Profile completeness</b><Attainment value={pct} target={100} /></div>
        {canEdit && <Link className="btn" to={editPath}>Edit Profile</Link>}
        <button className="btn secondary" onClick={() => window.print()}>Print / Save as PDF</button>
      </div>
      <article className="cv">
        <h1>{f.title} {f.name}</h1>
        <div>{f.designation}, {f.department}<br />{db.settings.institutionName}</div>
        <div className="muted" style={{ marginTop: 4 }}>
          Employee Code: {f.id} · {f.email} · {displayPhone(f.phone)}{f.orcid && ` · ORCID ${f.orcid}`}{f.scopusId && ` · Scopus ID ${f.scopusId}`}
        </div>
        {b?.summary && <><h2>Summary</h2><p style={{ margin: 0 }}>{b.summary}</p></>}
        {b?.researchInterests && <p><b>Research interests:</b> {b.researchInterests}</p>}
        {b?.expertise && <p><b>Areas of expertise:</b> {b.expertise}</p>}
        {!!b?.sdgs?.length && <p><b>Sustainable Development Goals:</b> {b.sdgs.map((n) => `SDG ${n} ${SDGS[n - 1].title}`).join('; ')}</p>}
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
        <h2>Intellectual Property ({ipr.length})</h2>
        {ipr.length ? <ol>{ipr.map((x) => <li key={x.id}>{ipTypeLabel(x)}: <b>{x.title}</b>, {x.office}, application / registration no. {x.applicationNumber}, filed {fmtDate(x.filingDate)} — {x.stage}{x.grantDate && ` (${fmtDate(x.grantDate)})`}{x.coOwners && `; with ${x.coOwners}`}</li>)}</ol> : <p className="muted">No approved intellectual property.</p>}
        {!!b?.teaching.length && <><h2>Teaching</h2><ol>{b.teaching.map((c, i) => <li key={i}>{c.code && `${c.code} `}{c.title}{c.level && ` (${c.level})`}</li>)}</ol></>}
        {!!b?.supervision.length && <><h2>Research Supervision ({b.supervision.length})</h2><ol>{b.supervision.map((x, i) => <li key={i}>{x.name}, {x.degree} ({x.status}{x.year && `, ${x.year}`}){x.topic && ` — ${x.topic}`}</li>)}</ol></>}
        {!!b?.engagement.length && <><h2>Engagement</h2><ol>{b.engagement.map((x, i) => <li key={i}>{x.type}: {x.role}{x.organisation && `, ${x.organisation}`} ({x.from}{x.to ? `–${x.to}` : ''})</li>)}</ol></>}
        {!!b?.media.length && <><h2>Selected Media Coverage</h2><ol>{b.media.map((m, i) => <li key={i}>“{m.headline}”, {m.outlet}{m.date && `, ${fmtDate(m.date)}`}</li>)}</ol></>}
        <h2>Professional Memberships</h2>
        {b?.memberships.length ? <ol>{b.memberships.map((m, i) => <li key={i}>{m.type}, {m.body} (since {m.since})</li>)}</ol> : <p className="muted">Not entered.</p>}
        <p className="muted" style={{ marginTop: 18, fontSize: 11 }}>Generated {fmtDate(new Date().toISOString())}. Publications, grants, FDPs, conferences, honours and intellectual property list approved entries only. Profile last updated {fmtDate(b?.updatedAt ?? '')}.</p>
      </article>
    </>
  );
}

function Repeat<T extends object>({ title, rows, onChange, blank, cols, note }: {
  title: string; rows: T[]; onChange: (r: T[]) => void; blank: T; cols: { key: keyof T; label: string; placeholder?: string; options?: string[]; type?: 'date' | 'url' }[]; note?: ReactNode;
}) {
  return (
    <Panel title={title} size="wide" actions={<button type="button" className="btn sm" onClick={() => onChange([...rows, { ...blank }])}>+ Add</button>}>
      <div className="tbl-wrap">
        <table className="tbl">
          <thead><tr>{cols.map((c) => <th key={String(c.key)}>{c.label}</th>)}<th /></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                {cols.map((c) => {
                  const set = (v: string) => onChange(rows.map((x, j) => (j === i ? { ...x, [c.key]: v } : x)));
                  const label = `${c.label} ${i + 1}`;
                  return <td key={String(c.key)}>{c.options
                    ? <select aria-label={label} value={String(r[c.key] ?? '')} onChange={(e) => set(e.target.value)}>{c.options.map((o) => <option key={o}>{o}</option>)}</select>
                    : <input type={c.type ?? 'text'} aria-label={label} placeholder={c.placeholder} value={String(r[c.key] ?? '')} onChange={(e) => set(e.target.value)} />}</td>;
                })}
                <td><button type="button" className="link-btn" onClick={() => onChange(rows.filter((_, j) => j !== i))}>Remove</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <div className="empty">None added.</div>}
      </div>
      {note && <p className="note">{note}</p>}
    </Panel>
  );
}

export function BiodataEdit() {
  const { db, f, b, canEdit, facultyId } = useTarget();
  const nav = useNavigate();
  const toast = useToast();
  // Continue an open proposal if there is one; otherwise start from the approved profile.
  const open = db.profileChanges.find((c) => c.facultyId === facultyId && ['Draft', 'Submitted', 'UnderReview', 'Rework'].includes(c.status));
  const last = [...db.profileChanges].filter((c) => c.facultyId === facultyId).sort((x, y) => y.updatedAt.localeCompare(x.updatedAt))[0];
  const [bio, setBio] = useState<Biodata>(() => structuredClone(open ? normalizeBiodata(open.biodata) : b ? normalizeBiodata(b) : blankBiodata(facultyId, '')));
  const [photoError, setPhotoError] = useState('');
  const [fac, setFac] = useState<Faculty | undefined>(() => (f ? { ...f, ...(open?.contact ?? {}) } : undefined));
  const [error, setError] = useState('');
  if (!f || !fac) return <Panel><Alert kind="error">Faculty member not found.</Alert></Panel>;
  if (!canEdit) return <Panel><Alert kind="error">Only the faculty member can update their profile. Top-Level Management has read-only access.</Alert></Panel>;
  const u = (p: Partial<Biodata>) => setBio({ ...bio, ...p });
  const phd = phdCounts(bio.supervision.filter((x) => x.name.trim()));
  const remark = last && ['Rework', 'Rejected'].includes(last.status) ? [...last.history].reverse().find((h) => h.remark)?.remark : undefined;
  const save = async (submit: boolean) => {
    if (fac.orcid && !/^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/.test(fac.orcid)) { setError('ORCID must look like 0000-0002-1825-0097.'); return; }
    if (fac.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(fac.email)) { setError('Enter a valid email address.'); return; }
    if (bio.dob && bio.dob > new Date().toISOString().slice(0, 10)) { setError('Date of birth cannot be in the future.'); return; }
    const badLink = PROFILE_LINKS.find((l) => bio.links[l.key] && !linkAllowed(l.key, bio.links[l.key]));
    if (badLink) { setError(`Check the ${badLink.label} link: it must be an https:// address${badLink.hosts.length ? ` on ${badLink.hosts.join(' or ')}` : ''}.`); return; }
    if (bio.media.some((m) => m.url && !/^https?:\/\//.test(m.url))) { setError('Media links must start with http:// or https://.'); return; }
    try {
      await proposeProfileChange({ ...bio, qualifications: bio.qualifications.filter((q) => q.degree.trim()), experience: bio.experience.filter((x) => x.organisation.trim()), memberships: bio.memberships.filter((m) => m.body.trim()), teaching: bio.teaching.filter((c) => c.title.trim()), supervision: bio.supervision.filter((x) => x.name.trim()), engagement: bio.engagement.filter((x) => x.organisation.trim() || x.role.trim()), media: bio.media.filter((x) => x.headline.trim()) },
        { email: fac.email, phone: fac.phone, orcid: fac.orcid, scopusId: fac.scopusId }, submit);
      toast(submit ? 'Profile update submitted. It appears on your profile once the Office of Research approves it.' : 'Draft saved. Submit it when you are ready.');
      nav('/my-profile');
    } catch (e) { setError((e as Error).message); }
  };
  return (
    <>
      <PageTitle sub="Your official details, personal details and research profile.">Edit Profile</PageTitle>
      <div className="panel wide">
        {last ? (
          <p style={{ margin: 0 }}><b>Latest profile update {last.id}:</b> <StatusBadge status={last.status} history={last.history} /> <span className="muted">· {fmtDate(last.updatedAt)} · changes: {last.changed.join(', ')}</span></p>
        ) : <p style={{ margin: 0 }}>Changes you make here are sent to the Office of Research. Your public profile keeps its approved details until they approve the update.</p>}
        {remark && <Alert kind="info">Office of Research comment ({STATUS_LABEL[last!.status]}): <b>{remark}</b></Alert>}
        {last && <ProgressTracker status={last.status} history={last.history} />}
        {open?.status === 'Submitted' && <p className="note" style={{ marginBottom: 0 }}>Your update is waiting for approval. Saving again replaces the pending update.</p>}
        {open?.status === 'UnderReview' && <Alert kind="info">The Office of Research is reviewing your update {open.id}. You can make further changes after their decision.</Alert>}
        {open && open.status !== 'Submitted' && open.status !== 'UnderReview' && <p className="note" style={{ marginBottom: 0 }}>You are editing your unsent update {open.id}.</p>}
      </div>
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
        <p className="note">Name, designation and department come from your verified access request and are maintained by the Office of Research.</p>
      </Panel>
      <Panel title="Personal Details" size="wide">
        <div className="grid">
          <Field label="Date of Birth"><input type="date" value={bio.dob} onChange={(e) => u({ dob: e.target.value })} /></Field>
          <Field label="Gender"><Select value={bio.gender} onChange={(v) => u({ gender: v })} options={['Female', 'Male', 'Other', 'Prefer not to say']} placeholder="--Select--" /></Field>
          <Field label="Address" className="span2"><TextArea value={bio.address} onChange={(v) => u({ address: v })} /></Field>
          <Field label="Ph.D. students guided (awarded)" hint={phd ? 'Counted from your supervision list below' : 'Or list your scholars under Supervision to count them automatically'}>{phd ? <input type="text" readOnly value={phd.guided} /> : <NumberInput value={bio.phdGuided} onChange={(v) => u({ phdGuided: v })} min={0} />}</Field>
          <Field label="Ph.D. students ongoing" hint={phd ? 'Counted from your supervision list below' : undefined}>{phd ? <input type="text" readOnly value={phd.ongoing} /> : <NumberInput value={bio.phdOngoing} onChange={(v) => u({ phdOngoing: v })} min={0} />}</Field>
          <Field label="Profile summary" className="span2"><TextArea value={bio.summary} onChange={(v) => u({ summary: v })} rows={3} /></Field>
          <Field label="Research interests" className="span2" hint="Separate with semicolons"><TextArea value={bio.researchInterests} onChange={(v) => u({ researchInterests: v })} rows={3} /></Field>
        </div>
      </Panel>
      <Panel title="Researcher Profile" size="wide">
        <p className="note" style={{ marginTop: 0 }}>Shown on the research profile and used by Faculty Search.</p>
        <div className="photo-row">
          <Avatar name={f.name} photo={bio.photo} size={96} />
          <div>
            <label className="btn sm secondary" style={{ cursor: 'pointer' }}>
              {bio.photo ? 'Change photograph' : 'Upload photograph'}
              <input type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (!file) return;
                try { u({ photo: await shrinkPhoto(file) }); setPhotoError(''); } catch { setPhotoError('That file could not be read as an image. Use a JPEG, PNG or WebP photograph.'); }
              }} />
            </label>
            {bio.photo && <button type="button" className="link-btn" style={{ marginLeft: 10 }} onClick={() => u({ photo: '' })}>Remove</button>}
            <p className="hint">A head-and-shoulders photograph. It is resized to 320 pixels before saving.</p>
            {photoError && <Alert kind="error">{photoError}</Alert>}
          </div>
        </div>
        <div className="grid">
          <Field label="Areas of expertise" className="span2" hint="Separate with semicolons"><TextArea value={bio.expertise} onChange={(v) => u({ expertise: v })} rows={2} /></Field>
          <Field label="Research keywords" className="span2" hint="Separate with commas"><TextArea value={bio.keywords} onChange={(v) => u({ keywords: v })} rows={2} /></Field>
          <Field label="Primary interest" className="span2" hint="One area, shown first on your profile"><Input value={bio.primaryInterest} onChange={(v) => u({ primaryInterest: v })} /></Field>
          <Field label="Office location" className="span2" hint="e.g. Block A · Room 214"><Input value={bio.office} onChange={(v) => u({ office: v })} /></Field>
        </div>
        <fieldset className="weight-group" id="follow">
          <legend>Follow me: social and research links</legend>
          <p className="note" style={{ marginTop: 0 }}>Shown as “Follow me” on your research profile. Leave blank any you do not use.</p>
          <div className="grid">
            {PROFILE_LINKS.map((l) => (
              <Field key={l.key} label={l.label} hint={l.hint} error={bio.links[l.key] && !linkAllowed(l.key, bio.links[l.key]) ? (l.hosts.length ? `Use an https:// address on ${l.hosts.join(' or ')}` : 'Use an https:// address') : undefined}>
                <Input value={bio.links[l.key] ?? ''} onChange={(v) => u({ links: { ...bio.links, [l.key]: v.trim() } })} type="url" />
              </Field>
            ))}
          </div>
        </fieldset>
        <div className="avail-checks">
          <label className="check"><input type="checkbox" checked={bio.availableToSupervise} onChange={(e) => u({ availableToSupervise: e.target.checked })} /> <span><b>Available to supervise</b> research students</span></label>
          <label className="check"><input type="checkbox" checked={bio.availableForMedia} onChange={(e) => u({ availableForMedia: e.target.checked })} /> <span><b>Available for media comment</b> in my areas of expertise</span></label>
        </div>
        <fieldset className="sdg-pick">
          <legend>Sustainable Development Goals your work contributes to</legend>
          <div className="sdg-pick-grid">
            {SDGS.map((g) => (
              <label key={g.n} className="check">
                <input type="checkbox" checked={bio.sdgs.includes(g.n)} onChange={(e) => u({ sdgs: e.target.checked ? [...bio.sdgs, g.n].sort((x, y) => x - y) : bio.sdgs.filter((n) => n !== g.n) })} />
                <SdgIcon n={g.n} size={26} /> <span>SDG {g.n} · {g.title}</span>
              </label>
            ))}
          </div>
        </fieldset>
      </Panel>
      <Panel title="Google Scholar" size="wide">
        <div className="grid">
          <Field label="Google Scholar profile URL" className="span2" hint="https://scholar.google.com/citations?user=…"><Input value={bio.googleScholar} onChange={(v) => u({ googleScholar: v })} /></Field>
          <Field label="Citations (all)"><MetricInput value={bio.scholar.citations} onChange={(v) => u({ scholar: { ...bio.scholar, citations: v } })} /></Field>
          <Field label="h-index (all)"><MetricInput value={bio.scholar.hIndex} onChange={(v) => u({ scholar: { ...bio.scholar, hIndex: v } })} /></Field>
          <Field label="i10-index (all)"><MetricInput value={bio.scholar.i10Index} onChange={(v) => u({ scholar: { ...bio.scholar, i10Index: v } })} /></Field>
        </div>
        <p className="note">Enter the three numbers exactly as shown in the “Cited by” box of your Google Scholar profile, or leave a box blank. They appear on your profile after the Office of Research approves the update.
          {bio.scholar.updatedAt ? ` Last updated ${fmtDate(bio.scholar.updatedAt)}.` : ''}</p>
      </Panel>
      <Repeat<Qualification> title="Educational Qualifications" rows={bio.qualifications} onChange={(r) => u({ qualifications: r })} blank={{ degree: '', specialization: '', institution: '', year: '' }}
        cols={[{ key: 'degree', label: 'Degree', placeholder: 'Ph.D.' }, { key: 'specialization', label: 'Specialisation' }, { key: 'institution', label: 'Institution / University' }, { key: 'year', label: 'Year' }]} />
      <Repeat<Experience> title="Experience" rows={bio.experience} onChange={(r) => u({ experience: r })} blank={{ organisation: '', designation: '', from: '', to: '' }}
        cols={[{ key: 'organisation', label: 'Organisation' }, { key: 'designation', label: 'Designation' }, { key: 'from', label: 'From (year)' }, { key: 'to', label: 'To (year / Present)' }]} />
      <div className="panel wide no-print"><p className="note" style={{ margin: 0 }}>Honours and awards are recorded under <b>Honours &amp; Awards</b>, with a certificate, and appear here once approved.{canEdit && <> <Link to="/awards/entry">Add an honour or award</Link></>}</p></div>
      <HighlightsPicker bio={bio} onChange={(h) => u({ highlights: h })} />
      <Repeat<Course> title="Teaching" rows={bio.teaching} onChange={(r) => u({ teaching: r })} blank={{ code: '', title: '', level: 'Undergraduate' }}
        cols={[{ key: 'code', label: 'Course code', placeholder: 'CSE3101' }, { key: 'title', label: 'Course title' }, { key: 'level', label: 'Level', options: COURSE_LEVELS }]} />
      <Repeat<Supervisee> title="Research Supervision" rows={bio.supervision} onChange={(r) => u({ supervision: r })} blank={{ name: '', degree: 'PhD', status: 'Current', year: '', topic: '' }}
        cols={[{ key: 'name', label: 'Student name' }, { key: 'degree', label: 'Degree', options: SUPERVISION_DEGREES }, { key: 'status', label: 'Status', options: SUPERVISION_STATUS }, { key: 'year', label: 'Year (started / completed)' }, { key: 'topic', label: 'Thesis topic' }]}
        note="Tick “Available to supervise” under Researcher Profile to appear in searches for supervisors." />
      <Repeat<Engagement> title="Engagement" rows={bio.engagement} onChange={(r) => u({ engagement: r })} blank={{ type: 'Editorial board', role: '', organisation: '', from: '', to: '' }}
        cols={[{ key: 'type', label: 'Type', options: ENGAGEMENT_TYPES }, { key: 'role', label: 'Role', placeholder: 'Associate Editor' }, { key: 'organisation', label: 'Journal / body / organisation' }, { key: 'from', label: 'From (year)' }, { key: 'to', label: 'To (year / Present)' }]}
        note="Editorial boards, professional societies, industry or advisory roles, and contributions to policy consultations." />
      <Repeat<MediaItem> title="Media Coverage" rows={bio.media} onChange={(r) => u({ media: r })} blank={{ headline: '', outlet: '', date: '', url: '' }}
        cols={[{ key: 'headline', label: 'Headline' }, { key: 'outlet', label: 'Outlet' }, { key: 'date', label: 'Date', type: 'date' }, { key: 'url', label: 'Link (optional)', type: 'url', placeholder: 'https://…' }]} />
      <Repeat<Membership> title="Professional Memberships" rows={bio.memberships} onChange={(r) => u({ memberships: r })} blank={{ body: '', type: '', since: '' }}
        cols={[{ key: 'body', label: 'Professional body' }, { key: 'type', label: 'Membership type' }, { key: 'since', label: 'Since (year)' }]} />
      <div className="btn-row">
        <button className="btn secondary" onClick={() => nav(-1)}>Cancel</button>
        <button className="btn secondary" onClick={() => save(false)}>Save as Draft</button>
        <button className="btn ok" onClick={() => save(true)}>Submit for Approval</button>
      </div>
    </>
  );
}

/** Blank means "not available"; otherwise a whole number of 0 or more. */
function MetricInput({ value, onChange }: { value: number | null; onChange: (v: number | null) => void }) {
  return <input type="number" min={0} step={1} inputMode="numeric" placeholder="Not available" value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? null : Math.max(0, Math.round(Number(e.target.value))))} />;
}

/** Reads an image file and returns a JPEG data URL no larger than 320 px on its longer side. */
function shrinkPhoto(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, 320 / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('bad image')); };
    img.src = url;
  });
}

/** Faculty choose up to six of their own approved outputs to show first on their profile. */
function HighlightsPicker({ bio, onChange }: { bio: Biodata; onChange: (h: string[]) => void }) {
  const { db } = useStore();
  const opts = highlightOptions(db, bio.facultyId);
  const on = new Set(bio.highlights);
  return (
    <Panel title="Highlights" size="wide">
      <p className="note" style={{ marginTop: 0 }}>Choose up to {MAX_HIGHLIGHTS} of your approved publications, grants, patents or honours to show first on your profile ({on.size} of {MAX_HIGHLIGHTS} chosen).</p>
      {opts.length ? (
        <div className="hl-pick">
          {opts.map((o) => (
            <label key={o.key} className={`check ${on.has(o.key) ? 'on' : ''}`}>
              <input type="checkbox" checked={on.has(o.key)} disabled={!on.has(o.key) && on.size >= MAX_HIGHLIGHTS}
                onChange={(e) => onChange(e.target.checked ? [...bio.highlights, o.key] : bio.highlights.filter((k) => k !== o.key))} />
              <span><span className="tag">{o.kindLabel}</span> {o.title} <span className="muted">· {o.year}</span></span>
            </label>
          ))}
        </div>
      ) : <p className="muted">You have no approved records yet. They appear here once the Office of Research approves them.</p>}
    </Panel>
  );
}
