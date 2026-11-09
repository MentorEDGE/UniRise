import { Link, useParams } from 'react-router-dom';
import { Alert, Panel } from '../../components/ui';
import { Avatar, resolveHighlights, splitList } from '../../components/research';
import { fmtDate, isSanctioned } from '../../lib/analytics';
import { creditedFaculty } from '../../lib/domain';
import { useStore } from '../../lib/store';
import { normalizeBiodata } from '../../lib/domain';

/**
 * One-page summary of a researcher (like a university "short profile"): who they are, how to reach them, what they
 * work on, and their latest approved work. Prints on a single page.
 */
export function ShortProfile() {
  const { db, user } = useStore();
  const { id } = useParams();
  const facultyId = id ?? user?.facultyId ?? '';
  const isViewer = user?.role === 'management' || user?.role === 'office';
  if (!isViewer && facultyId !== user?.facultyId) return <Panel><Alert kind="error">You can only see your own short profile.</Alert></Panel>;
  const f = db.faculty.find((x) => x.id === facultyId);
  if (!f) return <Panel><Alert kind="error">Faculty member not found.</Alert></Panel>;
  const raw = db.biodata.find((x) => x.facultyId === facultyId);
  const b = raw ? normalizeBiodata(raw) : undefined;
  const mine = <T extends { status: string }>(kind: Parameters<typeof creditedFaculty>[0], xs: T[]) => xs.filter((r) => r.status === 'Approved' && creditedFaculty(kind, r as never).includes(facultyId));
  const pubs = mine('publications', db.publications).sort((a, z) => z.year - a.year || z.month.localeCompare(a.month));
  const grants = mine('grants', db.grants).sort((a, z) => z.appliedDate.localeCompare(a.appliedDate));
  const projects = [...grants.filter(isSanctioned), ...mine('seedMoney', db.seedMoney)];
  const awards = db.awards.filter((a) => a.status === 'Approved' && a.facultyId === facultyId).sort((a, z) => z.awardDate.localeCompare(a.awardDate));
  const ipr = (db.ipr ?? []).filter((x) => x.status === 'Approved' && x.facultyId === facultyId);
  const highlights = resolveHighlights(db, facultyId, b?.highlights ?? []);
  const phd = b?.qualifications.find((q) => /ph/i.test(q.degree));
  const tags = [...new Set([...splitList(b?.expertise), ...splitList(b?.keywords)])].slice(0, 8);
  const back = isViewer ? `/faculty/${f.id}` : '/my-profile';
  return (
    <div className="sp-wrap">
      <div className="sp-bar no-print">
        <Link to={back}>‹ Back to the full profile</Link>
        <button type="button" className="btn sm" onClick={() => window.print()}>Print / Save as PDF</button>
      </div>
      <article className="sp">
        <header className="sp-head">
          <Avatar name={f.name} photo={b?.photo} size={108} />
          <div>
            <h1>{f.title} {f.name}</h1>
            <p className="sp-role">{f.designation}, {f.department}</p>
            <p className="sp-inst">{db.settings.institutionName}</p>
            <p className="sp-stats"><b>{pubs.length}</b> scholarly works · <b>{projects.length}</b> funded projects · <b>{ipr.length}</b> intellectual property · <b>{awards.length}</b> honours</p>
          </div>
        </header>
        <div className="sp-grid">
          <aside>
            <h2>Contact</h2>
            <p><a href={`mailto:${f.email}`}>{f.email}</a>{b?.office && <><br />{b.office}</>}</p>
            <h2>Position</h2>
            <p>{f.designation}<br />{f.department}</p>
            {phd && <><h2>Education</h2><p>{phd.degree}{phd.specialization && `, ${phd.specialization}`}<br />{phd.institution} {phd.year}</p></>}
            {f.orcid && <><h2>ORCID</h2><p><a href={`https://orcid.org/${f.orcid}`} target="_blank" rel="noreferrer">{f.orcid}</a></p></>}
            {(b?.availableToSupervise || b?.availableForMedia) && <><h2>Available for</h2><p>{[b?.availableToSupervise && 'Research supervision', b?.availableForMedia && 'Media comment'].filter(Boolean).join(' · ')}</p></>}
          </aside>
          <div>
            {b?.primaryInterest && <><h2>Primary interest</h2><p>{b.primaryInterest}</p></>}
            {tags.length > 0 && <><h2>Expertise</h2><ul className="sp-tags">{tags.map((t) => <li key={t}>{t}</li>)}</ul></>}
            {highlights.length > 0 && <><h2>Highlights</h2><ol className="sp-list">{highlights.map((h) => <li key={h.key}><span className="sp-kind">{h.year} · {h.kindLabel}</span>{h.title}</li>)}</ol></>}
            <h2>Recent scholarly works</h2>
            {pubs.length ? <ol className="sp-list">{pubs.slice(0, 4).map((p) => <li key={p.id}><span className="sp-kind">{p.year} · {p.entryType}</span>{p.title} <i className="muted">{p.venue}</i></li>)}</ol> : <p className="muted">None approved yet.</p>}
            <h2>Recent projects</h2>
            {projects.length ? <ol className="sp-list">{projects.slice(0, 4).map((g) => <li key={g.id}><span className="sp-kind">{g.appliedDate.slice(0, 4)} · {'agency' in g ? 'Research grant' : 'Seed money'}</span>{g.title}</li>)}</ol> : <p className="muted">None approved yet.</p>}
            {awards.length > 0 && <><h2>Latest honours</h2><ol className="sp-list">{awards.slice(0, 3).map((a) => <li key={a.id}><span className="sp-kind">{a.awardDate.slice(0, 4)}</span>{a.title}, {a.awardedBy}</li>)}</ol></>}
          </div>
        </div>
        <p className="sp-foot">Approved records only · generated {fmtDate(new Date().toISOString())}</p>
      </article>
    </div>
  );
}
