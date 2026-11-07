import { lazy, Suspense, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Alert, Field, Input, Modal, Panel, Select, useToast } from '../../components/ui';
import { activityByYear, ActivitySpark, Avatar, SdgIcon, splitList } from '../../components/research';
import { fmtDate, inr, isSanctioned } from '../../lib/analytics';
import { creditedFaculty } from '../../lib/domain';
import { saveFaculty, useStore } from '../../lib/store';
import type { EntityKind, Faculty, Grant, Honour, IntellectualProperty, Publication, SeedMoney } from '../../lib/types';
import { EMPTY_SCHOLAR, SDGS, ipTypeLabel } from '../../lib/types';
import { RecordDetail } from './RecordDetail';
import { NetworkGraph, outputsOf } from '../../components/network';

const CollabMap = lazy(() => import('../../components/CollabMap'));

type Tab = 'overview' | 'network' | 'projects' | 'publications' | 'grants' | 'fdps' | 'conferences' | 'awards' | 'ipr';
type NetTab = 'graph' | 'map' | 'profiles' | 'units';

const PUB_GROUPS: { label: string; types: Publication['entryType'][] }[] = [
  { label: 'Journal articles', types: ['Journal Article'] },
  { label: 'Conference papers', types: ['Conference Paper'] },
  { label: 'Books and book chapters', types: ['Book', 'Book Chapter'] },
  { label: 'Technical reports', types: ['Technical Report'] },
];

/** Route wrapper: management opens any profile in its institution by id. */
export function ResearcherProfileRoute() {
  const { id } = useParams();
  return <ResearcherProfile key={id} facultyId={id!} />;
}
/** A faculty member's own research profile. */
export function MyResearchProfile() {
  const { user } = useStore();
  return <ResearcherProfile facultyId={user!.facultyId!} />;
}

/**
 * Research profile of one faculty member: header with photograph, identifiers, Google Scholar metrics and activity
 * per year, then tabs for overview, network, projects, publications, grants and honours. Approved records only.
 */
export function ResearcherProfile({ facultyId }: { facultyId: string }) {
  const { db, user } = useStore();
  const [tab, setTab] = useState<Tab>('overview');
  const [open, setOpen] = useState<{ kind: EntityKind; id: string } | null>(null);
  const [netTab, setNetTab] = useState<NetTab>('graph');
  const [editing, setEditing] = useState(false);
  const f = db.faculty.find((x) => x.id === facultyId);
  const b = db.biodata.find((x) => x.facultyId === facultyId);
  const isMgmt = user?.role === 'management' || user?.role === 'office'; // institution-wide viewers

  const data = useMemo(() => {
    const mine = <T extends { status: string }>(kind: EntityKind, xs: T[]) => xs.filter((r) => r.status === 'Approved' && creditedFaculty(kind, r as never).includes(facultyId));
    const pubs = mine('publications', db.publications).sort((a, z) => z.year - a.year || z.month.localeCompare(a.month));
    const grants = mine('grants', db.grants).sort((a, z) => z.appliedDate.localeCompare(a.appliedDate));
    const seed = mine('seedMoney', db.seedMoney).sort((a, z) => z.appliedDate.localeCompare(a.appliedDate));
    const awards = db.awards.filter((a) => a.status === 'Approved' && a.facultyId === facultyId).sort((a, z) => z.awardDate.localeCompare(a.awardDate));
    const ipr = db.ipr.filter((a) => a.status === 'Approved' && a.facultyId === facultyId).sort((a, z) => z.filingDate.localeCompare(a.filingDate));
    const fdps = db.fdps.filter((a) => a.status === 'Approved' && a.facultyId === facultyId).sort((a, z) => z.fromDate.localeCompare(a.fromDate));
    const confs = db.conferences.filter((a) => a.status === 'Approved' && a.facultyId === facultyId).sort((a, z) => z.fromDate.localeCompare(a.fromDate));
    const projects = [
      ...grants.filter(isSanctioned).map((g) => ({ kind: 'grants' as const, r: g as Grant | SeedMoney, start: g.sanctionDate || g.appliedDate })),
      ...seed.map((s) => ({ kind: 'seedMoney' as const, r: s as Grant | SeedMoney, start: s.appliedDate })),
    ].sort((a, z) => z.start.localeCompare(a.start));
    const src = outputsOf(db, facultyId);
    const externalPeople = [...src.people.values()].filter((p) => p.type === 'external').map((p) => ({ p, n: src.items.filter((i) => i.who.includes(p.key)).length })).sort((a, z) => z.n - a.n || a.p.name.localeCompare(z.p.name));
    return { pubs, grants, seed, awards, ipr, fdps, confs, projects, activity: activityByYear(db, facultyId), network: networkOf(db, facultyId, pubs, grants, seed), externalPeople };
  }, [db, facultyId]);

  if (!f) return <Panel><Alert kind="error">Faculty member not found.</Alert></Panel>;
  if (!isMgmt && user?.facultyId !== facultyId) return <Panel><Alert kind="error">You can only view your own profile.</Alert></Panel>;

  const scholar = b?.scholar ?? EMPTY_SCHOLAR;
  const hasMetrics = scholar.citations != null || scholar.hIndex != null || scholar.i10Index != null;
  const tabs: { id: Tab; label: string; n?: number; icon: ReactNode }[] = [
    { id: 'overview', label: 'Overview', icon: I.person },
    { id: 'network', label: 'Network', n: data.network.internal.length + data.network.external.length, icon: I.network },
    { id: 'projects', label: 'Projects', n: data.projects.length, icon: I.box },
    { id: 'publications', label: 'Publications', n: data.pubs.length, icon: I.book },
    { id: 'grants', label: 'Grants and Fellowships', n: data.grants.length, icon: I.coin },
    { id: 'fdps', label: 'FDPs', n: data.fdps.length, icon: I.cap },
    { id: 'conferences', label: 'Conferences', n: data.confs.length, icon: I.screen },
    { id: 'awards', label: 'Honours & Awards', n: data.awards.length, icon: I.trophy },
    { id: 'ipr', label: 'Intellectual Property', n: data.ipr.length, icon: I.bulb },
  ];
  const profileLink = (id: string, label: ReactNode) => (isMgmt ? <Link to={`/faculty/${id}`}>{label}</Link> : <>{label}</>);

  return (
    <div className="rp">
      <header className="rp-head">
        <div className="rp-head-inner">
          <div className="rp-photo"><Avatar name={f.name} photo={b?.photo} size={150} /></div>
          <div className="rp-id">
            <h1 className="rp-name">{f.title} {f.name}</h1>
            <p className="rp-role">{f.designation}, {isMgmt ? <Link to={`/faculty?dept=${encodeURIComponent(f.department)}`}>{f.department}</Link> : f.department}</p>
            <p className="rp-inst">{db.settings.institutionName}</p>
            <dl className="rp-ids">
              <div><dt>Email</dt><dd><a href={`mailto:${f.email}`}>{f.email}</a></dd></div>
              <div><dt>ORCID</dt><dd>{f.orcid ? <a href={`https://orcid.org/${f.orcid}`} target="_blank" rel="noreferrer"><span className="orcid-dot" aria-hidden>iD</span>https://orcid.org/{f.orcid}</a> : <span className="muted">Not available</span>}</dd></div>
              {f.scopusId && <div><dt>Scopus</dt><dd><a href={`https://www.scopus.com/authid/detail.uri?authorId=${encodeURIComponent(f.scopusId)}`} target="_blank" rel="noreferrer">Author ID {f.scopusId}</a></dd></div>}
              <div><dt>Google Scholar</dt><dd>{b?.googleScholar ? <a href={b.googleScholar} target="_blank" rel="noreferrer">View Google Scholar profile ↗</a> : <span className="muted">Not available</span>}</dd></div>
            </dl>
            <div className="rp-actions no-print">
              {!isMgmt && <Link className="btn sm" to="/biodata/edit">Update profile</Link>}
              <Link className="btn sm secondary" to={isMgmt ? `/faculty/${f.id}/performance` : '/performance'}>Performance</Link>
              <Link className="btn sm secondary" to={isMgmt ? `/faculty/${f.id}/biodata` : '/biodata'}>CV / Print</Link>
              {user?.role === 'office' && <button type="button" className="btn sm" onClick={() => setEditing(true)}>Edit official details</button>}
            </div>
          </div>
          <aside className="rp-side">
            <section className="rp-metrics" aria-label="Citation metrics">
              <table>
                <thead><tr><th scope="col">Metric</th><th scope="col" className="num">All</th></tr></thead>
                <tbody>
                  <tr><th scope="row">Citations</th><td className="num">{metric(scholar.citations)}</td></tr>
                  <tr><th scope="row">h-index</th><td className="num">{metric(scholar.hIndex)}</td></tr>
                  <tr><th scope="row">i10-index</th><td className="num">{metric(scholar.i10Index)}</td></tr>
                </tbody>
              </table>
              {hasMetrics && <p className="rp-metrics-note">Updated {fmtDate(scholar.updatedAt)}</p>}
            </section>
            <section className="rp-activity">
              <ActivitySpark data={data.activity} height={64} />
              <p>Research activity per year</p>
            </section>
          </aside>
        </div>
      </header>

      <nav className="rp-tabs no-print" aria-label="Profile sections">
        <div className="rp-tabs-inner" role="tablist">
          {tabs.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>
              {t.icon}<span>{t.label}{t.n != null && ` (${t.n})`}</span>
            </button>
          ))}
        </div>
      </nav>

      <div className="rp-body" role="tabpanel">
        {tab === 'overview' && (
          <>
            <Section icon={I.person} title="Personal profile">
              {b?.summary ? <p className="rp-bio">{b.summary}</p> : <p className="muted">No biography has been added yet.</p>}
              <div className="rp-facts">
                <Fact label="Research interests">{chips(b?.researchInterests)}</Fact>
                <Fact label="Areas of expertise">{chips(b?.expertise)}</Fact>
                <Fact label="Research keywords">{chips(b?.keywords)}</Fact>
                <Fact label="Affiliation"><p>{f.designation}, {f.department}<br />{db.settings.institutionName}{f.joiningDate && <span className="muted"> · since {f.joiningDate.slice(0, 4)}</span>}</p></Fact>
                {!!b?.qualifications.length && <Fact label="Education"><ul className="rp-plain">{b.qualifications.map((q, i) => <li key={i}>{q.degree}{q.specialization && `, ${q.specialization}`} <span className="muted">· {q.institution} {q.year}</span></li>)}</ul></Fact>}
              </div>
            </Section>
            <Section title="Expertise related to UN Sustainable Development Goals">
              <p className="rp-sdg-lead">In 2015, UN member states agreed to 17 Sustainable Development Goals to end poverty, protect the planet and ensure prosperity for all. As stated in this profile, this researcher’s work contributes to:</p>
              {b?.sdgs.length ? (
                <ul className="rp-sdgs">{b.sdgs.map((n) => <li key={n}><SdgIcon n={n} size={64} /><span><b>SDG {n}</b>{SDGS[n - 1].title}</span></li>)}</ul>
              ) : <p className="muted">No goals have been added to this profile yet.</p>}
            </Section>
            {data.pubs.length > 0 && (
              <Section icon={I.book} title="Recent research outputs">
                <ol className="rp-list">{data.pubs.slice(0, 5).map((p) => <PubItem key={p.id} p={p} onOpen={() => setOpen({ kind: 'publications', id: p.id })} />)}</ol>
                {data.pubs.length > 5 && <button type="button" className="link-btn" onClick={() => setTab('publications')}>All {data.pubs.length} publications ›</button>}
              </Section>
            )}
          </>
        )}

        {tab === 'network' && (
          <Section icon={I.network} title="Collaborations" sub="Built from approved publications, grants and seed-money projects. A line joins two people who share an output; thicker lines mean more shared outputs.">
            <div className="net-tabs" role="tablist">
              {([['graph', 'Visualization'], ['map', 'Map'], ['profiles', 'Profiles'], ['units', 'Research units']] as [NetTab, string][]).map(([id, l]) => (
                <button key={id} type="button" role="tab" aria-selected={netTab === id} className={netTab === id ? 'on' : ''} onClick={() => setNetTab(id)}>{l}</button>
              ))}
            </div>
            {netTab === 'graph' && <NetworkGraph db={db} facultyId={facultyId} linkProfiles={isMgmt} />}
            {netTab === 'map' && <Suspense fallback={<p className="muted">Loading map…</p>}><CollabMap db={db} facultyId={facultyId} /></Suspense>}
            {netTab === 'profiles' && (
              <>
                <h3 className="net-h">Profiles at {db.settings.institutionName}</h3>
                {data.network.internal.length ? (
                  <ul className="rp-net">{data.network.internal.map((c) => (
                    <li key={c.f.id}>
                      <Avatar name={c.f.name} photo={db.biodata.find((x) => x.facultyId === c.f.id)?.photo} size={44} />
                      <span><b>{profileLink(c.f.id, `${c.f.title} ${c.f.name}`)}</b><small>{c.f.department}</small></span>
                      <span className="rp-net-n">{c.pubs ? `${c.pubs} publication${c.pubs > 1 ? 's' : ''}` : ''}{c.pubs && c.grants ? ' · ' : ''}{c.grants ? `${c.grants} grant${c.grants > 1 ? 's' : ''}` : ''}</span>
                    </li>
                  ))}</ul>
                ) : <p className="muted">No shared publications or grants with colleagues yet.</p>}
                <h3 className="net-h">External persons</h3>
                {data.externalPeople.length ? (
                  <table className="tbl"><thead><tr><th>Name</th><th>Institution</th><th>Country</th><th className="num">Shared outputs</th></tr></thead>
                    <tbody>{data.externalPeople.map(({ p, n }) => <tr key={p.key}><td>{p.name}</td><td>{p.institution || '—'}</td><td>{p.country || '—'}</td><td className="num">{n}</td></tr>)}</tbody></table>
                ) : <p className="muted">No external co-authors or co-investigators recorded.</p>}
                {data.network.students > 0 && <p className="note">{data.network.students} publication{data.network.students > 1 ? 's' : ''} with student co-authors.</p>}
              </>
            )}
            {netTab === 'units' && (
              <>
                <h3 className="net-h">Departments at {db.settings.institutionName}</h3>
                {(() => {
                  const depts = new Map<string, number>();
                  data.network.internal.forEach((c) => depts.set(c.f.department, (depts.get(c.f.department) ?? 0) + c.pubs + c.grants));
                  const rows = [...depts].sort((a, z) => z[1] - a[1]);
                  return rows.length ? <table className="tbl"><thead><tr><th>Department</th><th className="num">Joint outputs with its faculty</th></tr></thead><tbody>{rows.map(([d, n]) => <tr key={d}><td>{d}</td><td className="num">{n}</td></tr>)}</tbody></table> : <p className="muted">No internal collaborations yet.</p>;
                })()}
                <h3 className="net-h">External research units</h3>
                {data.network.external.length ? (
                  <table className="tbl"><thead><tr><th>Institution</th><th className="num">Joint outputs</th></tr></thead>
                    <tbody>{data.network.external.map((x) => <tr key={x.name}><td>{x.name}</td><td className="num">{x.n}</td></tr>)}</tbody></table>
                ) : <p className="muted">No external collaborations recorded.</p>}
              </>
            )}
          </Section>
        )}

        {tab === 'projects' && (
          <Section icon={I.box} title="Research projects" sub="Sanctioned grants and seed-money projects">
            {data.projects.length ? (
              <ol className="rp-list">{data.projects.map(({ kind, r, start }) => {
                const g = kind === 'grants' ? (r as Grant) : null;
                const s = kind === 'seedMoney' ? (r as SeedMoney) : null;
                const role = r.investigators.find((i) => i.code === facultyId)?.role ?? 'Investigator';
                const status = g ? (g.outcome === 'Completed' ? 'Completed' : 'Ongoing') : 'Seed money';
                return (
                  <li key={r.id}>
                    <button type="button" className="rp-title link-btn" onClick={() => setOpen({ kind, id: r.id })}>{r.title}</button>
                    <div className="rp-meta">{g ? `${g.agency} · ${g.grantType}` : 'Institution seed money'} · {role} · from {fmtDate(start)}{g?.durationMonths ? ` · ${g.durationMonths} months` : ''}</div>
                    <div className="rp-tags"><span className={`badge ${status === 'Completed' ? 'Approved' : 'Submitted'}`}>{status}</span><span className="tag">{inr(g ? g.sanctionedAmount : s!.sanctionedAmount)} sanctioned</span></div>
                  </li>
                );
              })}</ol>
            ) : <p className="muted">No sanctioned projects yet.</p>}
          </Section>
        )}

        {tab === 'publications' && (
          data.pubs.length ? PUB_GROUPS.map((grp) => {
            const list = data.pubs.filter((p) => grp.types.includes(p.entryType));
            return list.length ? (
              <Section key={grp.label} icon={I.book} title={`${grp.label} (${list.length})`}>
                <ol className="rp-list">{list.map((p) => <PubItem key={p.id} p={p} onOpen={() => setOpen({ kind: 'publications', id: p.id })} />)}</ol>
              </Section>
            ) : null;
          }) : <Section icon={I.book} title="Publications"><p className="muted">No approved publications yet.</p></Section>
        )}

        {tab === 'grants' && (
          <Section icon={I.coin} title="Grants and fellowships" sub="Every approved proposal, with its funding outcome">
            {data.grants.length ? (
              <ol className="rp-list">{data.grants.map((g) => (
                <li key={g.id}>
                  <button type="button" className="rp-title link-btn" onClick={() => setOpen({ kind: 'grants', id: g.id })}>{g.title}</button>
                  <div className="rp-meta">{g.agency} · {g.grantType} · {g.investigators.find((i) => i.code === facultyId)?.role ?? 'Investigator'} · applied {fmtDate(g.appliedDate)} for {inr(g.appliedAmount)}</div>
                  <div className="rp-tags"><span className={`badge ${isSanctioned(g) ? 'Approved' : g.outcome === 'Applied' ? 'Submitted' : 'Rejected'}`}>{g.outcome}</span>{isSanctioned(g) && <span className="tag">{inr(g.sanctionedAmount)} sanctioned</span>}</div>
                </li>
              ))}</ol>
            ) : <p className="muted">No approved grant entries yet.</p>}
          </Section>
        )}

        {tab === 'fdps' && (
          <Section icon={I.cap} title="Faculty development programmes" sub={`${data.fdps.length} approved · ${data.fdps.reduce((x, f) => x + f.hours, 0)} hours`}>
            {data.fdps.length ? (
              <ol className="rp-list">{data.fdps.map((x) => (
                <li key={x.id}>
                  <button type="button" className="rp-title link-btn" onClick={() => setOpen({ kind: 'fdps', id: x.id })}>{x.title}</button>
                  <div className="rp-meta">{x.role} · {x.programmeType} · {x.organiser} · {fmtDate(x.fromDate)}–{fmtDate(x.toDate)}</div>
                  <div className="rp-tags"><span className="tag">{x.hours} hours</span><span className="tag">{x.mode}</span><span className="tag">{x.level}</span></div>
                </li>
              ))}</ol>
            ) : <p className="muted">No approved FDP participation yet.</p>}
          </Section>
        )}

        {tab === 'conferences' && (
          <Section icon={I.screen} title="Conferences and presentations">
            {data.confs.length ? (
              <ol className="rp-list">{data.confs.map((c) => (
                <li key={c.id}>
                  <button type="button" className="rp-title link-btn" onClick={() => setOpen({ kind: 'conferences', id: c.id })}>{c.paperTitle || c.conferenceName}</button>
                  <div className="rp-meta">{c.participation}{c.paperTitle ? ` · ${c.conferenceName}` : ''} · {c.venue}, {c.country} · {fmtDate(c.fromDate)}</div>
                  <div className="rp-tags"><span className="tag">{c.level}</span><span className="tag">{c.mode}</span>{c.award && <span className="tag">{c.award}</span>}</div>
                </li>
              ))}</ol>
            ) : <p className="muted">No approved conference participation yet.</p>}
          </Section>
        )}

        {tab === 'awards' && (
          <Section icon={I.trophy} title="Honours and awards">
            {data.awards.length ? (
              <ol className="rp-list">{data.awards.map((a: Honour) => (
                <li key={a.id}>
                  <button type="button" className="rp-title link-btn" onClick={() => setOpen({ kind: 'awards', id: a.id })}>{a.title}</button>
                  <div className="rp-meta">{a.awardedBy} · {fmtDate(a.awardDate)}</div>
                  {a.citation && <div className="rp-cite">{a.citation}</div>}
                  <div className="rp-tags"><span className="tag">{a.level}</span><span className="tag">{a.category}</span></div>
                </li>
              ))}</ol>
            ) : <p className="muted">No approved honours or awards yet.</p>}
          </Section>
        )}

        {tab === 'ipr' && (
          <Section icon={I.bulb} title="Intellectual property">
            {data.ipr.length ? (
              <ol className="rp-list">{data.ipr.map((x: IntellectualProperty) => (
                <li key={x.id}>
                  <button type="button" className="rp-title link-btn" onClick={() => setOpen({ kind: 'ipr', id: x.id })}>{x.title}</button>
                  <div className="rp-meta">{x.office} · application {x.applicationNumber} · filed {fmtDate(x.filingDate)}{x.grantDate ? ` · granted / registered ${fmtDate(x.grantDate)}` : ''}</div>
                  {x.description && <div className="rp-cite">{x.description}</div>}
                  {x.coOwners && <div className="rp-cite">With {x.coOwners}</div>}
                  <div className="rp-tags"><span className="tag">{ipTypeLabel(x)}</span><span className="tag">{x.stage}</span>{x.licensed && <span className="tag">Licensed</span>}</div>
                </li>
              ))}</ol>
            ) : <p className="muted">No approved intellectual property yet.</p>}
          </Section>
        )}
      </div>
      {open && <RecordDetail kind={open.kind} id={open.id} onClose={() => setOpen(null)} />}
      {editing && <OfficialDetails f={f} onClose={() => setEditing(false)} />}
    </div>
  );
}

/** Office of Research: official details of a faculty member, and deactivating (removing from the directory) or restoring them. */
function OfficialDetails({ f, onClose }: { f: Faculty; onClose: () => void }) {
  const { db } = useStore();
  const toast = useToast();
  const [x, setX] = useState<Faculty>({ ...f });
  const [error, setError] = useState('');
  const save = async (next: Faculty, msg: string) => {
    try { await saveFaculty(next); toast(msg); onClose(); } catch (e) { setError((e as Error).message); }
  };
  return (
    <Modal title={`Official details · ${f.title} ${f.name}`} onClose={onClose}>
      {error && <Alert kind="error">{error}</Alert>}
      <div className="grid g2">
        <Field label="Title"><Select value={x.title} onChange={(v) => setX({ ...x, title: v })} options={['Dr.', 'Prof.', 'Mr.', 'Ms.', 'Mrs.']} /></Field>
        <Field label="Full name"><Input value={x.name} onChange={(v) => setX({ ...x, name: v })} /></Field>
        <Field label="Designation"><Select value={x.designation} onChange={(v) => setX({ ...x, designation: v })} options={['Professor', 'Associate Professor', 'Assistant Professor', 'Professor of Practice', 'Adjunct Faculty']} /></Field>
        <Field label="Department"><Select value={x.department} onChange={(v) => setX({ ...x, department: v })} options={db.settings.departments} /></Field>
      </div>
      <div className="btn-row">
        {f.active
          ? <button className="btn danger" onClick={() => confirm(`Deactivate ${f.name}? They can no longer sign in and are removed from the directory and statistics. Their records are kept.`) && save({ ...x, active: false }, `${f.name} deactivated.`)}>Deactivate faculty</button>
          : <button className="btn ok" onClick={() => save({ ...x, active: true }, `${f.name} reactivated.`)}>Reactivate faculty</button>}
        <button className="btn secondary" onClick={onClose}>Cancel</button>
        <button className="btn ok" onClick={() => save(x, 'Official details saved.')}>Save</button>
      </div>
      <p className="note">Faculty update their own profile and research records; those changes come to you under Approval.</p>
    </Modal>
  );
}

const metric = (v: number | null) => (v == null ? <span className="muted">Not available</span> : v.toLocaleString('en-IN'));

function chips(s: string | undefined) {
  const items = splitList(s);
  return items.length ? <ul className="chips">{items.map((x) => <li key={x}>{x}</li>)}</ul> : <p className="muted">Not added.</p>;
}

function Section({ icon, title, sub, children }: { icon?: ReactNode; title: string; sub?: string; children: ReactNode }) {
  return (
    <section className="rp-section">
      <h2>{icon}{title}</h2>
      {sub && <p className="rp-sub">{sub}</p>}
      {children}
    </section>
  );
}
const Fact = ({ label, children }: { label: string; children: ReactNode }) => <div className="rp-fact"><h3>{label}</h3>{children}</div>;

function PubItem({ p, onOpen }: { p: Publication; onOpen: () => void }) {
  return (
    <li>
      {p.doi ? <a className="rp-title" href={p.doi} target="_blank" rel="noreferrer">{p.title}</a> : <span className="rp-title">{p.title}</span>}
      <div className="rp-meta">{p.authors.map((a) => a.name).join(', ')}</div>
      <div className="rp-meta"><i>{p.venue}</i> · {p.month} {p.year}</div>
      <div className="rp-tags">
        <span className="tag">{p.entryType}</span>
        {p.indexing !== 'Not Indexed' && <span className="tag">{p.indexing}</span>}
        {p.quartile !== 'NA' && <span className="tag">{p.quartile}</span>}
        {p.openAccess && <span className="tag">Open access</span>}
        <button type="button" className="link-btn" onClick={onOpen}>Details</button>
      </div>
    </li>
  );
}

/** Collaborators found in approved publications and grants: colleagues by shared output, outside institutions by count. */
function networkOf(db: ReturnType<typeof useStore>['db'], me: string, pubs: Publication[], grants: Grant[], seed: SeedMoney[]) {
  const internal = new Map<string, { pubs: number; grants: number }>();
  const external = new Map<string, number>();
  let students = 0;
  const bump = (id: string, k: 'pubs' | 'grants') => { if (id === me) return; const c = internal.get(id) ?? { pubs: 0, grants: 0 }; c[k]++; internal.set(id, c); };
  const ext = (inst: string) => inst && inst !== db.settings.institutionName && external.set(inst, (external.get(inst) ?? 0) + 1);
  for (const p of pubs) {
    new Set(p.authors.filter((a) => a.kind === 'Faculty' && a.code).map((a) => a.code)).forEach((id) => bump(id, 'pubs'));
    new Set(p.authors.filter((a) => a.kind === 'External').map((a) => a.institution)).forEach(ext);
    if (p.authors.some((a) => a.kind === 'Student')) students++;
  }
  for (const g of [...grants, ...seed]) {
    new Set(g.investigators.filter((i) => i.kind === 'Faculty' && i.code).map((i) => i.code)).forEach((id) => bump(id, 'grants'));
    new Set(g.investigators.filter((i) => i.kind === 'External').map((i) => i.institution)).forEach(ext);
  }
  const byId = new Map(db.faculty.map((f) => [f.id, f]));
  return {
    internal: [...internal].filter(([id]) => byId.has(id)).map(([id, c]) => ({ f: byId.get(id)!, ...c })).sort((a, z) => z.pubs + z.grants - (a.pubs + a.grants) || a.f.name.localeCompare(z.f.name)),
    external: [...external].map(([name, n]) => ({ name, n })).sort((a, z) => z.n - a.n || a.name.localeCompare(z.name)),
    students,
  };
}

const ic = (d: ReactNode) => <svg className="rp-ic" viewBox="0 0 24 24" aria-hidden>{d}</svg>;
const I = {
  person: ic(<><circle cx="12" cy="8" r="3.6" /><path d="M5 20.5c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5" /></>),
  network: ic(<><circle cx="12" cy="5.5" r="2.3" /><circle cx="5" cy="18" r="2.3" /><circle cx="19" cy="18" r="2.3" /><path d="m10.9 7.5-4.8 8.4M13.1 7.5l4.8 8.4M7.3 18h9.4" /></>),
  box: ic(<><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9Z" /><path d="m4 7.5 8 4.5 8-4.5M12 12v9" /></>),
  book: ic(<><path d="M4 5.5c2.7-1 5.3-1 8 .7v13.3c-2.7-1.7-5.3-1.7-8-.7Z" /><path d="M20 5.5c-2.7-1-5.3-1-8 .7v13.3c2.7-1.7 5.3-1.7 8-.7Z" /></>),
  coin: ic(<><circle cx="12" cy="12" r="8" /><path d="M14.8 9.2c-.6-.8-1.6-1.2-2.8-1.2-1.6 0-2.8.8-2.8 2s1.2 1.7 2.8 2 2.8.8 2.8 2-1.2 2-2.8 2c-1.2 0-2.2-.4-2.8-1.2M12 6.5V8M12 16v1.5" /></>),
  cap: ic(<><path d="m12 4 9 4.5-9 4.5-9-4.5Z" /><path d="M7 10.8v4.4c1.4 1.3 3.1 1.9 5 1.9s3.6-.6 5-1.9v-4.4M21 8.5v5" /></>),
  screen: ic(<><rect x="3.5" y="4" width="17" height="11" rx="1.8" /><path d="M12 15v3.5M8 20.5h8M7.5 8.5h9M7.5 11.5h5" /></>),
  bulb: ic(<><path d="M9 18h6M10 21h4" /><path d="M12 3a6 6 0 0 0-3.6 10.8c.8.6 1.1 1.4 1.1 2.2h5c0-.8.3-1.6 1.1-2.2A6 6 0 0 0 12 3Z" /></>),
  trophy: ic(<><path d="M7.5 4h9v5a4.5 4.5 0 0 1-9 0Z" /><path d="M7.5 6H4.5a3 3 0 0 0 3 3.5M16.5 6h3a3 3 0 0 1-3 3.5M12 13.5V17M8.5 20h7M9.5 17h5v3h-5Z" /></>),
};
