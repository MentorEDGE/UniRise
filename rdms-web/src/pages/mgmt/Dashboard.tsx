import { useMemo } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { BarCard } from '../../components/charts';
import { PageTitle, Panel } from '../../components/ui';
import { academicYearRange, facultyStats, lakh, pct, plural, trend, uniqueCounts } from '../../lib/analytics';
import { useStore } from '../../lib/store';
import { departmentRows, Tile } from './Analytics';
import { useAnalyticsFilter } from './filters';

/** Change from the previous year, as "▲ 12% vs AY 2024-25" (or points for a percentage). */
function Change({ now, before, prevAy, points }: { now: number; before: number; prevAy: string; points?: boolean }) {
  if (!prevAy) return null;
  // A percentage change from zero has no meaning: say "up from none" instead of a made-up 100%.
  if (!points && !before && now) return <span className="chg up">▲ up from none <span className="muted">vs AY {prevAy}</span></span>;
  const d = points ? Math.round(now - before) : before ? Math.round(((now - before) / before) * 100) : 0;
  const cls = d > 0 ? 'up' : d < 0 ? 'down' : 'flat';
  return <span className={`chg ${cls}`}>{d > 0 ? '▲' : d < 0 ? '▼' : '•'} {d === 0 ? 'no change' : `${Math.abs(d)}${points ? ' pts' : '%'}`} <span className="muted">vs AY {prevAy}</span></span>;
}

interface Insight { tone: 'good' | 'watch' | 'info'; text: ReactNode; to?: string }

/**
 * Top-Level Management dashboard: the institution at a glance for one academic year. Every figure comes from
 * approved records of current faculty (former faculty are not counted), compared with the year before.
 */
export function ManagementDashboard() {
  const { db } = useStore();
  const { filter, bar, ay, years } = useAnalyticsFilter();
  const sm = db.settings.academicYearStartMonth;
  const sorted = useMemo(() => [...years].sort(), [years]);
  const prevAy = ay === 'all' ? '' : sorted[sorted.indexOf(ay) - 1] ?? '';
  const prevFilter = prevAy ? { ...academicYearRange(prevAy, sm), department: filter.department } : null;

  const u = useMemo(() => uniqueCounts(db, filter), [db, filter]);
  const up = useMemo(() => (prevFilter ? uniqueCounts(db, prevFilter) : null), [db, prevFilter?.from, filter.department]); // eslint-disable-line react-hooks/exhaustive-deps
  const stats = useMemo(() => facultyStats(db, filter), [db, filter]);
  const depts = useMemo(() => departmentRows(db, filter), [db, filter]);
  const rows = useMemo(() => trend(db, filter.department, sorted.slice(Math.max(0, sorted.indexOf(ay === 'all' ? sorted[sorted.length - 1] : ay) - 5), sorted.indexOf(ay === 'all' ? sorted[sorted.length - 1] : ay) + 1)), [db, filter.department, sorted, ay]);

  const n = stats.length || 1;
  const t = db.settings.targets;
  const q12 = (x: typeof u) => { const j = x.pubs.filter((p) => p.entryType === 'Journal Article'); return pct(j.filter((p) => p.quartile === 'Q1' || p.quartile === 'Q2').length, j.length); };
  const metPubs = stats.filter((s) => s.publications >= t.publicationsPerFaculty).length;
  const metFdp = stats.filter((s) => s.fdpHours >= t.fdpHoursPerFaculty).length;
  const idle = stats.filter((s) => s.publications + s.grantsApplied + s.fdps + s.conferences + s.awards + s.ipr === 0).length;
  const top = [...stats].sort((a, b) => b.score - a.score).slice(0, 5);
  const bestDept = [...depts].filter((d) => d.faculty).sort((a, b) => b.pubsPF - a.pubsPF)[0];
  const fundDept = [...depts].sort((a, b) => b.sanctioned - a.sanctioned)[0];

  const insights: Insight[] = [];
  if (up) {
    const now = u.pubs.length, before = up.pubs.length;
    const d = before ? Math.round(((now - before) / before) * 100) : 0;
    const text = !before
      ? (now ? <>{plural(now, 'publication')} this year, against none the year before.</> : <>No publications this year or the year before.</>)
      : d === 0 ? <>Research output held steady: {plural(now, 'publication')}, as the year before.</>
      : <>Research output {d > 0 ? 'rose' : 'fell'} <b>{Math.abs(d)}%</b>: {plural(now, 'publication')} against {before} the year before.</>;
    insights.push({ tone: now > 0 && now >= before ? 'good' : 'watch', text, to: '/publications?status=Approved' });
  }
  if (bestDept && !filter.department) insights.push({ tone: 'info', text: <><b>{bestDept.dept}</b> leads on output, with {bestDept.pubsPF.toFixed(1)} publications per faculty member.</>, to: '/analytics/departments' });
  insights.push({ tone: pct(metPubs, stats.length) >= 50 ? 'good' : 'watch', text: <><b>{pct(metPubs, stats.length)}%</b> of faculty met the publication target of {t.publicationsPerFaculty}; <b>{pct(metFdp, stats.length)}%</b> met the {t.fdpHoursPerFaculty}-hour FDP target.</>, to: '/analytics/participation' });
  if (u.grants.length) insights.push({ tone: 'info', text: <>{plural(u.sanctioned.length, 'grant')} sanctioned out of {plural(u.grants.length, 'proposal')} ({pct(u.sanctioned.length, u.grants.length)}% success), worth <b>{lakh(u.sanctionedAmount)}</b>{fundDept?.sanctioned && !filter.department ? <>; {fundDept.dept} brought in the most</> : null}.</>, to: '/grants?status=Approved' });
  if (up) { const d = q12(u) - q12(up); insights.push({ tone: d >= 0 ? 'good' : 'watch', text: <><b>{q12(u)}%</b> of journal articles were in Q1 or Q2 journals ({d >= 0 ? 'up' : 'down'} {Math.abs(d)} points).</> }); }
  if (top[0]?.score) insights.push({ tone: 'info', text: <>Top researcher by weighted score: <Link to={`/faculty/${top[0].faculty.id}`}>{top[0].faculty.title} {top[0].faculty.name}</Link> ({top[0].faculty.department}).</> });
  if (idle) insights.push({ tone: 'watch', text: <>{plural(idle, 'faculty member')} {idle === 1 ? 'has' : 'have'} no approved activity in this period.</>, to: '/analytics/participation' });

  return (
    <>
      <PageTitle sub="The institution at a glance: approved research activity of current faculty, compared with the year before.">Dashboard</PageTitle>
      <Panel size="wide">{bar}</Panel>
      <div className="dash">
        <div className="tiles">
          <Tile label="Active faculty" value={stats.length} sub={filter.department || `${db.settings.departments.length} departments`} to="/faculty" />
          <Tile label="Publications" value={u.pubs.length} sub={up ? <Change now={u.pubs.length} before={up.pubs.length} prevAy={prevAy} /> : `${(u.pubs.length / n).toFixed(1)} per faculty`} to="/publications?status=Approved" />
          <Tile label="Q1 + Q2 journals" value={`${q12(u)}%`} sub={up ? <Change now={q12(u)} before={q12(up)} prevAy={prevAy} points /> : 'of journal articles'} />
          <Tile label="Sanctioned funding" value={lakh(u.sanctionedAmount)} sub={up ? <Change now={u.sanctionedAmount} before={up.sanctionedAmount} prevAy={prevAy} /> : `${u.sanctioned.length} grants`} to="/grants?status=Approved" />
          <Tile label="Grant proposals" value={u.grants.length} sub={`${u.sanctioned.length} sanctioned · ${pct(u.sanctioned.length, u.grants.length)}% success`} to="/grants?status=Approved" />
          <Tile label="FDP hours" value={Math.round(u.fdpHours).toLocaleString('en-IN')} sub={up ? <Change now={u.fdpHours} before={up.fdpHours} prevAy={prevAy} /> : `${Math.round(u.fdpHours / n)} h per faculty`} to="/fdp?status=Approved" />
          <Tile label="Conferences" value={u.confs.length} sub={up ? <Change now={u.confs.length} before={up.confs.length} prevAy={prevAy} /> : `${u.confs.filter((c) => c.level === 'International').length} international`} to="/conferences?status=Approved" />
          <Tile label="Honours & IP" value={u.awards.length + u.ipr.length} sub={`${plural(u.awards.length, 'honour')} · ${plural(u.ipr.filter((x) => x.ipType === 'Patent').length, 'patent')}`} to="/awards?status=Approved" />
        </div>

        <div className="dash-grid">
          <section className="card dash-insights" aria-label="Insights">
            <h3>Insights</h3>
            <p className="sub">{ay === 'all' ? 'All years' : `AY ${ay}`}{filter.department ? ` · ${filter.department}` : ''}</p>
            <ul>
              {insights.map((x, i) => (
                <li key={i} className={x.tone}>
                  <span className="dot" aria-hidden />
                  <span>{x.text}{x.to && <> <Link to={x.to} className="more">Details</Link></>}</span>
                </li>
              ))}
            </ul>
          </section>
          <section className="card dash-top" aria-label="Top researchers">
            <h3>Top researchers</h3>
            <p className="sub">By weighted score this period</p>
            <ol>
              {top.map((s) => (
                <li key={s.faculty.id}>
                  <Link to={`/faculty/${s.faculty.id}`}>{s.faculty.title} {s.faculty.name}</Link>
                  <small>{s.faculty.department} · {plural(s.publications, 'publication')}</small>
                  <b>{s.score}</b>
                </li>
              ))}
            </ol>
            <Link className="more" to="/analytics/faculty">Full ranking</Link>
          </section>
        </div>

        <div className="cards dash-charts">
          <BarCard className="span-all" title="Research output over six years" sub="Approved publications and grant proposals per academic year" data={rows} xKey="ay" xLabel="Academic year" stacked
            series={[{ key: 'journal', label: 'Journal' }, { key: 'confPaper', label: 'Conference paper' }, { key: 'bookChapter', label: 'Book / chapter' }, { key: 'proposals', label: 'Grant proposals' }]} />
          <BarCard title="Publications per faculty member" sub="By department, this period" data={depts.map((d) => ({ d: d.short, pubs: Math.round(d.pubsPF * 10) / 10 }))} xKey="d" xLabel="Department"
            series={[{ key: 'pubs', label: 'Publications per faculty' }]} fmt={(v) => v.toLocaleString('en-IN', { maximumFractionDigits: 1 })} />
          <BarCard title="Sanctioned funding (₹ lakh)" sub="By department, this period" data={depts.map((d) => ({ d: d.short, funding: Math.round(d.sanctioned / 1e4) / 10 }))} xKey="d" xLabel="Department"
            series={[{ key: 'funding', label: 'Sanctioned (₹ lakh)', color: '#0d9488' }]} fmt={(v) => v.toLocaleString('en-IN', { maximumFractionDigits: 1 })} />
        </div>

        <nav className="dash-links" aria-label="Go to">
          {([['/faculty', 'Find Profiles', 'Search faculty by expertise, department or SDG'], ['/analytics/faculty', 'Faculty Performance', 'Scores, rankings and targets'], ['/analytics/departments', 'Department Comparison', 'Departments side by side'], ['/reports/annual', 'Annual Activity Report', 'Printable summary of the year']] as const).map(([to, title, sub]) => (
            <Link key={to} to={to}><b>{title}</b><span>{sub}</span></Link>
          ))}
        </nav>
      </div>
    </>
  );
}
