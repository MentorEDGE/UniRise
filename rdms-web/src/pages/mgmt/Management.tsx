import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { BarCard } from '../../components/charts';
import { Alert, Attainment, DataTable, PageTitle, Panel, StatusBadge, Tabs } from '../../components/ui';
import { dateOf, facultyStats, fmtDate, lakh, trend, plural } from '../../lib/analytics';
import { listColumns } from '../../lib/entities';
import { creditedFaculty, useStore } from '../../lib/store';
import type { AnyRecord, EntityKind } from '../../lib/types';
import { ENTITY_LABEL } from '../../lib/types';
import { RecordDetail } from '../shared/RecordDetail';
import { Tile } from './Analytics';
import { useAnalyticsFilter } from './filters';

const KINDS: EntityKind[] = ['publications', 'grants', 'seedMoney', 'fdps', 'conferences', 'awards', 'ipr'];

/** Performance view of one faculty member (scores, targets, trends); the research profile links here. */
export function Faculty360({ facultyId: given }: { facultyId?: string }) {
  const params = useParams();
  const facultyId = given ?? params.id!;
  const { db, user } = useStore();
  const { filter, bar, years, ay } = useAnalyticsFilter({ allowDept: false });
  const [tab, setTab] = useState<EntityKind>('publications');
  const [openId, setOpenId] = useState<string | null>(null);
  const f = db.faculty.find((x) => x.id === facultyId);
  const s = useMemo(() => facultyStats(db, { ...filter, department: '' }).find((x) => x.faculty.id === facultyId), [db, filter, facultyId]);
  const rows = useMemo(() => trend(db, '', [...years].sort().slice(-6), facultyId), [db, years, facultyId]);
  if (!f) return <Panel><Alert kind="error">Faculty member not found.</Alert></Panel>;
  const isMgmt = user?.role === 'management' || user?.role === 'office'; // institution-wide viewers
  const isSelf = user?.facultyId === facultyId;
  // Faculty see only their own profile; management sees everyone in the institution.
  if (!isMgmt && !isSelf) return <Panel><Alert kind="error">You can only view your own profile.</Alert></Panel>;
  const kinds: EntityKind[] = KINDS;
  const dept = (v: string) => (isMgmt ? ` · dept. avg ${v}` : '');
  const deptStats = facultyStats(db, { ...filter, department: f.department });
  const avg = (k: 'publications' | 'fdpHours' | 'conferences' | 'score') => deptStats.reduce((a, x) => a + x[k], 0) / (deptStats.length || 1);
  const records = (db[tab] as AnyRecord[]).filter((r) => creditedFaculty(tab, r).includes(facultyId) && (isMgmt || r.status === 'Approved'))
    .filter((r) => { const d = dateOf(tab, r); return (!filter.from || d >= filter.from) && (!filter.to || d <= filter.to); })
    .sort((a, b) => dateOf(tab, b).localeCompare(dateOf(tab, a)));
  const t = db.settings.targets;
  return (
    <>
      <PageTitle sub={isMgmt ? `${f.title} ${f.name} · approved records only` : 'Your approved records, score and targets, year by year.'}>{isMgmt ? 'Faculty Performance' : 'My Performance'}</PageTitle>
      <Panel size="wide">
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{f.title} {f.name} {!f.active && <span className="badge Draft">Former faculty · {f.exitReason || 'left'}</span>}</div>
            <div>{f.designation}, {f.department}</div>
            <div className="muted">{f.id} · {f.email}{f.orcid && <> · ORCID <a href={`https://orcid.org/${f.orcid}`} target="_blank" rel="noreferrer">{f.orcid}</a></>}{f.scopusId && ` · Scopus ${f.scopusId}`} · joined {fmtDate(f.joiningDate)}</div>
          </div>
          <div className="row-actions" style={{ alignItems: 'start' }}>
            <Link className="btn sm" to={isMgmt ? `/faculty/${f.id}` : '/my-profile'}>Research profile</Link>
            {isMgmt && <Link className="btn sm secondary" to={`/faculty/${f.id}/biodata`}>CV</Link>}
          </div>
        </div>
        <div style={{ marginTop: 10 }}>{bar}</div>
      </Panel>
      {!f.active && <Panel size="wide"><Alert kind="info">{f.title} {f.name} is former faculty ({(f.exitReason || 'left').toLowerCase()}{f.exitDate ? `, last working day ${fmtDate(f.exitDate)}` : ''}). Their records stay in the institution's database, listed below, but are not used in any performance figures, analysis or reports.</Alert></Panel>}
      {f.active && s && (
        <div style={{ maxWidth: 1180, margin: '0 auto 14px' }}>
          <div className="tiles">
            <Tile label="Score" value={s.score} sub={isMgmt ? `Dept. avg ${avg('score').toFixed(1)}` : 'Weighted score'} />
            <Tile label="Publications" value={s.publications} sub={`Target ${t.publicationsPerFaculty}${dept(avg('publications').toFixed(1))}`} />
            <Tile label="Q1 + Q2" value={s.q1q2} sub={`${s.scopusWos} Scopus / WoS indexed`} />
            <Tile label="Grants" value={`${s.grantsApplied} / ${s.grantsSanctioned}`} sub={`applied / sanctioned · ${lakh(s.sanctionedAmount)} share`} />
            <Tile label="FDP hours" value={s.fdpHours} sub={`Target ${t.fdpHoursPerFaculty}${dept(avg('fdpHours').toFixed(0))}`} />
            <Tile label="Conferences" value={s.conferences} sub={`${s.confPresented} presented`} />
            <Tile label="Honours & Awards" value={s.awards} sub="approved" />
            <Tile label="Intellectual Property" value={s.ipr} sub={`${plural(s.patents, 'patent')} · approved`} />
            <Tile label="Seed Money" value={s.seedMoney} sub={`${plural(s.seedMoney, 'project')} approved`} />
            <Tile label="Profile" value={`${s.biodata}%`} sub="complete" />
          </div>
        </div>
      )}
      {f.active && <div className="cards" style={{ marginBottom: 14 }}>
        <BarCard title="Publications by year" data={rows} xKey="ay" xLabel="Academic year" stacked series={[{ key: 'journal', label: 'Journal' }, { key: 'confPaper', label: 'Conference paper' }, { key: 'bookChapter', label: 'Book / chapter' }, { key: 'report', label: 'Tech report' }]} height={200} />
        <BarCard title="FDP hours by year" data={rows} xKey="ay" xLabel="Academic year" series={[{ key: 'fdpHours', label: 'FDP hours' }]} height={200} />
        <BarCard title="Conferences by year" data={rows} xKey="ay" xLabel="Academic year" stacked series={[{ key: 'national', label: 'National' }, { key: 'international', label: 'International' }]} height={200} />
        {/* Progress against the institution's annual targets (Institution → Targets & Scoring), for the chosen year. */}
        <section className="card targets-card" aria-label="Targets">
          <h3>{isMgmt ? 'Targets' : 'My targets'}{ay === 'all' ? '' : ` · AY ${ay}`}</h3>
          {ay === 'all' || !s ? <p className="sub">Targets are per academic year. Choose a year above to see progress.</p> : <>
            <p className="sub">Approved records this academic year, against the institution's annual targets{isMgmt ? '; department average in brackets' : ''}</p>
            <div className="tbl-wrap"><table className="tbl targets">
              <tbody>
                {([
                  ['Publications', s.publications, t.publicationsPerFaculty, avg('publications')],
                  ['FDP hours', s.fdpHours, t.fdpHoursPerFaculty, avg('fdpHours')],
                  ['Conferences', s.conferences, t.conferencesPerFaculty, avg('conferences')],
                  ['Grant proposals', s.grantsApplied, t.grantAppliedPerFaculty, null],
                ] as const).map(([label, value, target, deptAvg]) => {
                  const left = Math.max(0, Math.ceil(target - value));
                  return (
                    <tr key={label}>
                      <td style={{ width: '34%' }}>{label}</td>
                      <td><Attainment value={value} target={target} /></td>
                      <td className="num" style={{ whiteSpace: 'nowrap' }}>{Math.round(value * 10) / 10} / {target}{isMgmt && deptAvg != null ? <span className="muted"> ({deptAvg.toFixed(1)})</span> : null}</td>
                      <td className={left ? 'muted' : 'ok'} style={{ whiteSpace: 'nowrap' }}>{target <= 0 ? '' : left ? `${left} to go` : '✓ met'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table></div>
          </>}
        </section>
      </div>}
      <Panel size="wide" title={`Records${ay === 'all' ? '' : ` in AY ${ay}`}`}>
        <Tabs value={tab} onChange={setTab} tabs={kinds.map((k) => ({ id: k, label: ENTITY_LABEL[k] }))} />
        <DataTable rows={records} columns={listColumns(db, tab, { showOwner: false }).filter((c) => !(user?.role === 'management' && c.key === 'status')).map((c) => (c.key === 'status' ? { ...c, render: (r: AnyRecord) => <StatusBadge status={r.status} history={r.history} /> } : c))}
          rowKey={(r) => r.id} onRowClick={(r) => setOpenId(r.id)} exportName={`${f.id}_${tab}`} empty={isMgmt ? 'No records in this period.' : 'No approved records in this period.'} />
      </Panel>
      {openId && <RecordDetail kind={tab} id={openId} onClose={() => setOpenId(null)} />}
    </>
  );
}
