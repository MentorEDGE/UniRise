import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Attainment, PageTitle, Panel, StatusBadge } from '../../components/ui';
import { academicYearOf, academicYearRange, biodataCompleteness, facultyStats, fmtDate } from '../../lib/analytics';
import { ENTITIES } from '../../lib/entities';
import { creditedFaculty, useStore } from '../../lib/store';
import type { AnyRecord, EntityKind } from '../../lib/types';
import { ENTITY_LABEL } from '../../lib/types';
import { RecordDetail } from '../shared/RecordDetail';
import { Tile } from '../mgmt/Analytics';

const KINDS: EntityKind[] = ['publications', 'grants', 'seedMoney', 'fdps', 'conferences', 'awards'];

export function FacultyHome() {
  const { db, user } = useStore();
  const me = db.faculty.find((f) => f.id === user!.facultyId)!;
  const [open, setOpen] = useState<{ k: EntityKind; id: string } | null>(null);
  const ay = academicYearOf(new Date().toISOString().slice(0, 10), db.settings.academicYearStartMonth);
  const range = academicYearRange(ay, db.settings.academicYearStartMonth);
  const s = useMemo(() => facultyStats(db, { ...range, department: '' }).find((x) => x.faculty.id === me.id), [db, range.from, me.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const t = db.settings.targets;
  const mine = KINDS.flatMap((k) => (db[k] as AnyRecord[]).filter((r) => r.facultyId === me.id).map((r) => ({ k, r })));
  const action = mine.filter(({ r }) => r.status === 'Rework' || r.status === 'Draft').sort((a, b) => (a.r.status === 'Rework' ? -1 : 1) - (b.r.status === 'Rework' ? -1 : 1));
  const recent = [...mine].sort((a, b) => b.r.updatedAt.localeCompare(a.r.updatedAt)).slice(0, 8);
  const coauthored = db.publications.filter((p) => p.facultyId !== me.id && creditedFaculty('publications', p).includes(me.id) && p.status === 'Approved').length;
  const bio = biodataCompleteness(db.biodata.find((b) => b.facultyId === me.id), me);

  return (
    <>
      <PageTitle>Home</PageTitle>
      <Panel size="wide">
        <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
          <div><b>Welcome, {me.title} {me.name}</b><div className="muted">{me.designation}, {me.department} · {me.id}</div></div>
          <div className="row-actions">
            <Link className="btn sm" to="/publications/entry">+ Publication</Link>
            <Link className="btn sm" to="/grants/entry">+ Grant</Link>
            <Link className="btn sm" to="/fdp/entry">+ FDP</Link>
            <Link className="btn sm" to="/conferences/entry">+ Conference</Link>
            <Link className="btn sm" to="/awards/entry">+ Honour / Award</Link>
            {db.settings.seedMoneyWindowOpen && <Link className="btn sm" to="/seed-money/entry">+ Seed Money</Link>}
          </div>
        </div>
      </Panel>
      {s && (
        <div style={{ maxWidth: 1180, margin: '0 auto 14px' }}>
          <div className="tiles">
            <Tile label={`Publications AY ${ay}`} value={s.publications} sub={<Attainment value={s.publications} target={t.publicationsPerFaculty} />} to="/publications" />
            <Tile label="FDP hours" value={s.fdpHours} sub={<Attainment value={s.fdpHours} target={t.fdpHoursPerFaculty} />} to="/fdp" />
            <Tile label="Conferences" value={s.conferences} sub={<Attainment value={s.conferences} target={t.conferencesPerFaculty} />} to="/conferences" />
            <Tile label="Grant proposals" value={s.grantsApplied} sub={`${s.grantsSanctioned} sanctioned`} to="/grants" />
            <Tile label="Honours & Awards" value={s.awards} sub="Approved this year" to="/awards" />
            <Tile label="Score" value={s.score} sub="See My Performance" to="/performance" />
            <Tile label="Profile" value={`${bio}%`} sub={<Attainment value={bio} target={100} />} to="/biodata/edit" />
          </div>
          <p className="note" style={{ textAlign: 'center' }}>Approved entries in AY {ay}. Targets are set by management. {coauthored > 0 && `${coauthored} approved publications credit you as a co-author.`}</p>
        </div>
      )}
      <div className="cards">
        <section className="card">
          <h3>Needs your action ({action.length})</h3><p className="sub">Drafts to submit and entries sent back for rework</p>
          {action.length ? (
            <table className="tbl"><tbody>{action.map(({ k, r }) => (
              <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => setOpen({ k, id: r.id })}>
                <td><StatusBadge status={r.status} /></td><td>{ENTITY_LABEL[k]}</td><td className="title-cell">{ENTITIES[k].title(r)}
                  {r.status === 'Rework' && <div className="muted">“{[...r.history].reverse().find((h) => h.remark)?.remark}”</div>}</td>
              </tr>
            ))}</tbody></table>
          ) : <p className="muted">Nothing needs your action.</p>}
          {bio < 80 && <p className="note">Your profile is {bio}% complete. <Link to="/biodata/edit">Complete it</Link> for accreditation records.</p>}
        </section>
        <section className="card">
          <h3>Notices</h3>
          {db.notices.map((x) => <div className="notice" key={x.id}><b>{x.title}</b>{x.body} <small>· {fmtDate(x.at)}</small></div>)}
          {!db.notices.length && <p className="muted">No notices.</p>}
        </section>
        <section className="card span-all">
          <h3>Recent entries</h3>
          <table className="tbl">
            <thead><tr><th>Type</th><th>ID</th><th>Title</th><th>Status</th><th>Updated</th></tr></thead>
            <tbody>{recent.map(({ k, r }) => (
              <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => setOpen({ k, id: r.id })}><td>{ENTITY_LABEL[k]}</td><td>{r.id}</td><td className="title-cell">{ENTITIES[k].title(r)}</td><td><StatusBadge status={r.status} /></td><td>{fmtDate(r.updatedAt)}</td></tr>
            ))}</tbody>
          </table>
        </section>
      </div>
      {open && <RecordDetail kind={open.k} id={open.id} onClose={() => setOpen(null)} />}
    </>
  );
}
