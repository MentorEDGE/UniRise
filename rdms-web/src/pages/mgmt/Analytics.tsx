import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { BarCard, LineCard, RankList, useQuartileColors } from '../../components/charts';
import { Attainment, DataTable, PageTitle, Panel } from '../../components/ui';
import type { Column } from '../../components/ui';
import {
  dateOf, facultyStats, fmtDate, lakh, pct, trend, uniqueCounts,
} from '../../lib/analytics';
import type { FacultyStats } from '../../lib/analytics';
import { useStore } from '../../lib/store';
import type { AnyRecord, EntityKind } from '../../lib/types';
import { ENTITY_LABEL } from '../../lib/types';
import { useAnalyticsFilter } from './filters';

const nf = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 1 });

export function Tile({ label, value, sub, to }: { label: string; value: React.ReactNode; sub?: React.ReactNode; to?: string }) {
  const body = <><div className="tile-label">{label}</div><div className="tile-value">{value}</div>{sub && <div className="tile-sub">{sub}</div>}</>;
  return to ? <Link className="tile" to={to}>{body}</Link> : <div className="tile">{body}</div>;
}

/** Last six academic years ending at the selected one (or the latest when "all"). */
function windowYears(years: string[], ay: string) {
  const sorted = [...years].sort();
  const end = ay === 'all' ? sorted.length - 1 : sorted.indexOf(ay);
  return sorted.slice(Math.max(0, end - 5), end + 1);
}

// ---------------- Institution overview ----------------

export function InstitutionAnalytics() {
  const { db } = useStore();
  const { filter, bar, ay, years } = useAnalyticsFilter();
  const u = useMemo(() => uniqueCounts(db, filter), [db, filter]);
  const stats = useMemo(() => facultyStats(db, filter), [db, filter]);
  const rows = useMemo(() => trend(db, filter.department, windowYears(years, ay)), [db, filter.department, years, ay]);
  const n = stats.length || 1;
  const journals = u.pubs.filter((p) => p.entryType === 'Journal Article');
  const q12 = journals.filter((p) => p.quartile === 'Q1' || p.quartile === 'Q2').length;
  const intl = u.pubs.filter((p) => p.authors.some((a) => a.kind === 'External')).length;
  const student = u.pubs.filter((p) => p.authors.some((a) => a.kind === 'Student' || a.kind === 'Ex-Student')).length;

  // Monthly activity inside the selected range.
  const quartileColors = useQuartileColors();
  const monthly = useMemo(() => {
    if (!filter.from) return [];
    const out: Record<string, Record<string, number | string>> = {};
    const start = new Date(filter.from + 'T00:00:00Z');
    for (let i = 0; i < 12; i++) {
      const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1));
      const k = d.toISOString().slice(0, 7);
      out[k] = { m: d.toLocaleString('en', { month: 'short', timeZone: 'UTC' }), publications: 0, fdps: 0, conferences: 0, grants: 0 };
    }
    const add = (kind: EntityKind, xs: AnyRecord[]) => xs.forEach((r) => { const k = dateOf(kind, r).slice(0, 7); if (out[k]) out[k][kind] = (out[k][kind] as number) + 1; });
    add('publications', u.pubs); add('fdps', u.fdps); add('conferences', u.confs); add('grants', u.grants);
    return Object.values(out);
  }, [u, filter.from]);

  return (
    <>
      <PageTitle>Institution Analytics</PageTitle>
      <Panel size="wide">{bar}</Panel>
      <div style={{ maxWidth: 1180, margin: '0 auto 14px' }}>
        <div className="tiles">
          <Tile label="Faculty" value={stats.length} sub={filter.department || 'All departments'} to="/faculty" />
          <Tile label="Publications" value={u.pubs.length} sub={`${nf(u.pubs.length / n)} per faculty`} to="/reports/publications" />
          <Tile label="Q1 + Q2 journals" value={`${pct(q12, journals.length)}%`} sub={`${q12} of ${journals.length} journal articles`} />
          <Tile label="Grant proposals" value={u.grants.length} sub={`${u.sanctioned.length} sanctioned · ${pct(u.sanctioned.length, u.grants.length)}% success`} to="/grants" />
          <Tile label="Sanctioned funding" value={lakh(u.sanctionedAmount)} sub={`${lakh(u.receivedAmount)} received`} />
          <Tile label="Seed money" value={lakh(u.seedAmount)} sub={`${u.seed.length} proposals approved`} />
          <Tile label="FDP hours" value={nf(u.fdpHours)} sub={`${u.fdps.length} programmes · ${nf(u.fdpHours / n)} h per faculty`} to="/fdp" />
          <Tile label="Conferences" value={u.confs.length} sub={`${u.confs.filter((c) => c.level === 'International').length} international`} to="/conferences" />
          <Tile label="Honours & Awards" value={u.awards.length} sub={`${u.awards.filter((a) => a.level === 'International').length} international · ${u.awards.filter((a) => a.level === 'National').length} national`} to="/reports/awards?r=awd-level" />
          <Tile label="Collaboration" value={`${pct(intl, u.pubs.length)}%`} sub={`external co-authors · ${pct(student, u.pubs.length)}% with students`} />
        </div>
      </div>
      <div className="cards">
        <BarCard title="Publications by type" sub="Per academic year; a co-authored paper counts once" data={rows} xKey="ay" xLabel="Academic year" stacked
          series={[{ key: 'journal', label: 'Journal' }, { key: 'confPaper', label: 'Conference paper' }, { key: 'bookChapter', label: 'Book / chapter' }, { key: 'report', label: 'Tech report' }]} />
        <BarCard title="Journal quality (quartile)" sub="Journal articles per academic year" data={rows} xKey="ay" xLabel="Academic year" stacked
          series={(['q1', 'q2', 'q3', 'q4', 'unranked'] as const).map((k, i) => ({ key: k, label: k === 'unranked' ? 'Unranked' : k.toUpperCase(), color: quartileColors[i] }))} />
        <BarCard title="Grant funding (₹ lakh)" sub="Applied vs sanctioned, by year the proposal was applied" data={rows} xKey="ay" xLabel="Academic year" fmt={nf}
          series={[{ key: 'appliedL', label: 'Applied' }, { key: 'sanctionedL', label: 'Sanctioned' }, { key: 'receivedL', label: 'Received' }]} />
        <BarCard title="FDP hours" sub="Total hours of approved FDPs, workshops and courses" data={rows} xKey="ay" xLabel="Academic year" series={[{ key: 'fdpHours', label: 'FDP hours' }]} />
        <BarCard title="Conference participation" sub="By level" data={rows} xKey="ay" xLabel="Academic year" stacked series={[{ key: 'national', label: 'National' }, { key: 'international', label: 'International' }]} />
        {monthly.length > 0 && (
          <LineCard title="Monthly activity" sub={`Approved entries per month, AY ${ay}`} data={monthly} xKey="m" xLabel="Month"
            series={[{ key: 'publications', label: 'Publications' }, { key: 'fdps', label: 'FDPs' }, { key: 'conferences', label: 'Conferences' }, { key: 'grants', label: 'Grant proposals' }]} />
        )}
        <section className="card">
          <h3>Top journals</h3><p className="sub">Most-used venues in the selected period</p>
          <RankList rows={Object.entries(journals.reduce<Record<string, number>>((a, p) => ((a[p.venue] = (a[p.venue] ?? 0) + 1), a), {})).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => ({ key: k, label: k, value: v }))} />
        </section>
        <section className="card">
          <h3>Top funding agencies</h3><p className="sub">Sanctioned amount</p>
          <RankList fmt={lakh} rows={Object.entries(u.sanctioned.reduce<Record<string, number>>((a, g) => ((a[g.agency] = (a[g.agency] ?? 0) + g.sanctionedAmount), a), {})).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => ({ key: k, label: k, value: v }))} />
        </section>
      </div>
    </>
  );
}

// ---------------- Department comparison ----------------

interface DeptRow { dept: string; short: string; faculty: number; pubs: number; pubsPF: number; q12: number; proposals: number; sanctioned: number; fdpHoursPF: number; confPF: number; score: number; scorePF: number; pubAtt: number; fdpAtt: number; confAtt: number; biodata: number }

/** Short, unique labels for chart axes: initials for multi-word names (CSE), the first letters otherwise (Phys, Chem). */
export function shortNames(depts: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  const used = new Set<string>();
  for (const d of depts) {
    const words = d.split(/[\s&,]+/).filter((w) => w.length > 2 && !['and', 'the', 'for'].includes(w.toLowerCase()));
    let base = words.length > 1 ? words.map((w) => w[0]).join('').toUpperCase() : (words[0] ?? d).slice(0, 4);
    let n = base.length === 1 ? 4 : base.length;
    while (used.has(base)) { n += 1; base = words.length > 1 ? `${base}${words[words.length - 1][n - words.length] ?? n}` : (words[0] ?? d).slice(0, n); }
    used.add(base); out[d] = base;
  }
  return out;
}

export function departmentRows(db: ReturnType<typeof useStore>['db'], filter: { from: string; to: string }): DeptRow[] {
  const t = db.settings.targets;
  return db.settings.departments.map((dept) => {
    const f = { ...filter, department: dept };
    const s = facultyStats(db, f);
    const u = uniqueCounts(db, f);
    const n = s.length || 1;
    const sum = (k: keyof FacultyStats) => s.reduce((a, x) => a + (x[k] as number), 0);
    return {
      dept, short: shortNames(db.settings.departments)[dept], faculty: s.length,
      pubs: u.pubs.length, pubsPF: u.pubs.length / n, q12: u.pubs.filter((p) => p.quartile === 'Q1' || p.quartile === 'Q2').length,
      proposals: u.grants.length, sanctioned: u.sanctionedAmount, fdpHoursPF: sum('fdpHours') / n, confPF: sum('conferences') / n,
      score: sum('score'), scorePF: sum('score') / n,
      pubAtt: pct(s.filter((x) => x.publications >= t.publicationsPerFaculty).length, s.length),
      fdpAtt: pct(s.filter((x) => x.fdpHours >= t.fdpHoursPerFaculty).length, s.length),
      confAtt: pct(s.filter((x) => x.conferences >= t.conferencesPerFaculty).length, s.length),
      biodata: Math.round(sum('biodata') / n),
    };
  });
}

export function DepartmentAnalytics() {
  const { db } = useStore();
  const { filter, bar } = useAnalyticsFilter({ allowDept: false });
  const rows = useMemo(() => departmentRows(db, filter), [db, filter]);
  const chart = rows.map((r) => ({ ...r, pubsPF: Math.round(r.pubsPF * 10) / 10, fdpHoursPF: Math.round(r.fdpHoursPF), confPF: Math.round(r.confPF * 10) / 10, scorePF: Math.round(r.scorePF * 10) / 10, sanctionedL: Math.round(r.sanctioned / 1e4) / 10 }));
  const cols: Column<DeptRow>[] = [
    { key: 'dept', label: 'Department', render: (r) => <Link to={`/analytics/faculty?dept=${encodeURIComponent(r.dept)}`}>{r.dept}</Link>, value: (r) => r.dept },
    { key: 'faculty', label: 'Faculty', value: (r) => r.faculty, num: true },
    { key: 'pubs', label: 'Publications', value: (r) => r.pubs, num: true },
    { key: 'pubsPF', label: 'Per faculty', value: (r) => Math.round(r.pubsPF * 10) / 10, num: true },
    { key: 'q12', label: 'Q1+Q2', value: (r) => r.q12, num: true },
    { key: 'proposals', label: 'Grant proposals', value: (r) => r.proposals, num: true },
    { key: 'sanctioned', label: 'Sanctioned', value: (r) => r.sanctioned, render: (r) => lakh(r.sanctioned), num: true },
    { key: 'fdp', label: 'FDP h / faculty', value: (r) => Math.round(r.fdpHoursPF), num: true },
    { key: 'conf', label: 'Conf. / faculty', value: (r) => Math.round(r.confPF * 10) / 10, num: true },
    { key: 'score', label: 'Score / faculty', value: (r) => Math.round(r.scorePF * 10) / 10, num: true },
  ];
  return (
    <>
      <PageTitle>Department Comparison</PageTitle>
      <Panel size="wide">{bar}</Panel>
      <Panel size="wide" title="Department summary">
        <DataTable rows={rows} columns={cols} rowKey={(r) => r.dept} exportName="department_comparison" pageSize={20} />
        <p className="note">Per-faculty figures divide by active faculty in the department, so departments of different sizes can be compared. Grant amounts credit the whole grant to every department with an investigator on it.</p>
      </Panel>
      <div className="cards">
        <BarCard title="Publications per faculty" data={chart} xKey="short" xLabel="Department" series={[{ key: 'pubsPF', label: 'Publications per faculty' }]} fmt={nf} />
        <BarCard title="Performance score per faculty" sub="Weighted score (see Settings → Targets & Scoring)" data={chart} xKey="short" xLabel="Department" series={[{ key: 'scorePF', label: 'Score per faculty' }]} fmt={nf} />
        <BarCard title="FDP hours per faculty" data={chart} xKey="short" xLabel="Department" series={[{ key: 'fdpHoursPF', label: 'FDP hours per faculty' }]} />
        <BarCard title="Sanctioned grant funding (₹ lakh)" data={chart} xKey="short" xLabel="Department" series={[{ key: 'sanctionedL', label: 'Sanctioned (₹ lakh)' }]} fmt={nf} />
        <section className="card span-all">
          <h3>Target attainment</h3>
          <p className="sub">Share of faculty in each department who met the per-faculty targets for the period ({db.settings.targets.publicationsPerFaculty} publications, {db.settings.targets.fdpHoursPerFaculty} FDP hours, {db.settings.targets.conferencesPerFaculty} conference)</p>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>Department</th><th>Publications target</th><th>FDP hours target</th><th>Conference target</th><th>Profile complete</th></tr></thead>
              <tbody>{rows.map((r) => (
                <tr key={r.dept}><td>{r.dept} <span className="muted">({r.short})</span></td><td><Attainment value={r.pubAtt} target={100} /></td><td><Attainment value={r.fdpAtt} target={100} /></td><td><Attainment value={r.confAtt} target={100} /></td><td><Attainment value={r.biodata} target={100} /></td></tr>
              ))}</tbody>
            </table>
          </div>
        </section>
      </div>
    </>
  );
}

// ---------------- Faculty performance ----------------

export function facultyColumns(targets: { publicationsPerFaculty: number; fdpHoursPerFaculty: number }): Column<FacultyStats>[] {
  return [
    { key: 'rank', label: '#', value: (r) => r.score, render: () => null },
    { key: 'name', label: 'Faculty', value: (r) => r.faculty.name, render: (r) => <Link to={`/faculty/${r.faculty.id}`}>{r.faculty.title} {r.faculty.name}</Link> },
    { key: 'id', label: 'Emp. Code', value: (r) => r.faculty.id },
    { key: 'dept', label: 'Department', value: (r) => r.faculty.department },
    { key: 'desig', label: 'Designation', value: (r) => r.faculty.designation },
    { key: 'pubs', label: 'Pubs', value: (r) => r.publications, num: true, render: (r) => <span style={{ color: r.publications >= targets.publicationsPerFaculty ? 'var(--ok)' : undefined }}>{r.publications}</span> },
    { key: 'q12', label: 'Q1+Q2', value: (r) => r.q1q2, num: true },
    { key: 'grants', label: 'Grants (sanct.)', value: (r) => r.grantsApplied, render: (r) => `${r.grantsApplied} (${r.grantsSanctioned})`, num: true },
    { key: 'amount', label: 'Funding share', value: (r) => Math.round(r.sanctionedAmount), render: (r) => (r.sanctionedAmount ? lakh(r.sanctionedAmount) : '—'), num: true },
    { key: 'fdp', label: 'FDP h', value: (r) => r.fdpHours, num: true, render: (r) => <span style={{ color: r.fdpHours >= targets.fdpHoursPerFaculty ? 'var(--ok)' : undefined }}>{r.fdpHours}</span> },
    { key: 'conf', label: 'Conf.', value: (r) => r.conferences, num: true },
    { key: 'awards', label: 'Awards', value: (r) => r.awards, num: true },
    { key: 'score', label: 'Score', value: (r) => r.score, num: true, render: (r) => <b>{nf(r.score)}</b> },
  ];
}

export function FacultyPerformance() {
  const { db } = useStore();
  const { filter, bar } = useAnalyticsFilter();
  const stats = useMemo(() => facultyStats(db, filter), [db, filter]);
  const cols = facultyColumns(db.settings.targets);
  cols[0].render = (r) => stats.indexOf(r) + 1;
  const buckets = [0, 10, 20, 30, 40, 60].map((lo, i, a) => ({ range: i === a.length - 1 ? `${lo}+` : `${lo}–${a[i + 1] - 1}`, faculty: stats.filter((s) => s.score >= lo && (i === a.length - 1 || s.score < a[i + 1])).length }));
  const byDesig = ['Professor', 'Associate Professor', 'Assistant Professor'].map((d) => {
    const s = stats.filter((x) => x.faculty.designation === d); const n = s.length || 1;
    return { d: d.replace(' Professor', ' Prof.'), score: Math.round(s.reduce((a, x) => a + x.score, 0) / n * 10) / 10, pubs: Math.round(s.reduce((a, x) => a + x.publications, 0) / n * 10) / 10 };
  });
  return (
    <>
      <PageTitle>Faculty Performance</PageTitle>
      <Panel size="wide">{bar}</Panel>
      <Panel size="wide" title="Faculty ranking by weighted score">
        <DataTable rows={stats} columns={cols} rowKey={(r) => r.faculty.id} exportName="faculty_performance" pageSize={20} />
        <p className="note">Green values meet the per-faculty target. Co-authored publications and shared grants credit each internal author; funding is split by investigator share. Click a name for the full 360° profile.</p>
      </Panel>
      <div className="cards">
        <BarCard title="Score distribution" sub="Number of faculty in each score band" data={buckets} xKey="range" xLabel="Score band" series={[{ key: 'faculty', label: 'Faculty' }]} />
        <BarCard title="Average by designation" data={byDesig} xKey="d" xLabel="Designation" series={[{ key: 'score', label: 'Avg score' }, { key: 'pubs', label: 'Avg publications' }]} fmt={nf} />
      </div>
    </>
  );
}

// ---------------- Participation & compliance ----------------

export function ParticipationAnalytics() {
  const { db } = useStore();
  const { filter, bar } = useAnalyticsFilter();
  const stats = useMemo(() => facultyStats(db, filter), [db, filter]);
  const t = db.settings.targets;
  const n = stats.length;
  const share = (fn: (s: FacultyStats) => boolean) => ({ count: stats.filter(fn).length, pct: pct(stats.filter(fn).length, n) });
  const measures = [
    { label: 'Published at least once', ...share((s) => s.publications > 0) },
    { label: `Met publication target (${t.publicationsPerFaculty})`, ...share((s) => s.publications >= t.publicationsPerFaculty) },
    { label: 'Attended / organised an FDP', ...share((s) => s.fdps > 0) },
    { label: `Met FDP-hours target (${t.fdpHoursPerFaculty} h)`, ...share((s) => s.fdpHours >= t.fdpHoursPerFaculty) },
    { label: 'Participated in a conference', ...share((s) => s.conferences > 0) },
    { label: 'Received an honour or award', ...share((s) => s.awards > 0) },
    { label: 'Applied for an external grant', ...share((s) => s.grantsApplied > 0) },
    { label: 'Holds a sanctioned grant', ...share((s) => s.grantsSanctioned > 0) },
    { label: 'Profile ≥ 80% complete', ...share((s) => s.biodata >= 80) },
  ];
  const noFdp = stats.filter((s) => s.fdpHours < t.fdpHoursPerFaculty);
  const lowBio = stats.filter((s) => s.biodata < 80).sort((a, b) => a.biodata - b.biodata);

  const missingDocs = [
    ...db.publications.filter((p) => p.status === 'Approved' && p.entryType !== 'Book' && !p.pdfName).map((r) => ({ k: 'publications' as EntityKind, r: r as AnyRecord })),
    ...db.fdps.filter((p) => p.status === 'Approved' && !p.certificateName).map((r) => ({ k: 'fdps' as EntityKind, r: r as AnyRecord })),
  ].filter(({ k, r }) => { const d = dateOf(k, r); return (!filter.from || d >= filter.from) && (!filter.to || d <= filter.to); });

  const simple: Column<FacultyStats>[] = [
    { key: 'name', label: 'Faculty', value: (r) => r.faculty.name, render: (r) => <Link to={`/faculty/${r.faculty.id}`}>{r.faculty.title} {r.faculty.name}</Link> },
    { key: 'dept', label: 'Department', value: (r) => r.faculty.department },
  ];
  const byId = new Map(db.faculty.map((f) => [f.id, f]));
  const recCols: Column<{ k: EntityKind; r: AnyRecord }>[] = [
    { key: 'type', label: 'Type', value: (x) => ENTITY_LABEL[x.k] },
    { key: 'id', label: 'ID', value: (x) => x.r.id },
    { key: 'who', label: 'Faculty', value: (x) => byId.get(x.r.facultyId)?.name ?? '' },
    { key: 'dept', label: 'Department', value: (x) => byId.get(x.r.facultyId)?.department ?? '' },
    { key: 'at', label: 'Last update', value: (x) => x.r.updatedAt, render: (x) => fmtDate(x.r.updatedAt) },
  ];

  return (
    <>
      <PageTitle>Participation & Compliance</PageTitle>
      <Panel size="wide">{bar}</Panel>
      <div className="cards">
        <section className="card span-all">
          <h3>Participation rates</h3><p className="sub">Share of {n} active faculty</p>
          <table className="tbl"><tbody>{measures.map((m) => <tr key={m.label}><td style={{ width: '40%' }}>{m.label}</td><td><Attainment value={m.pct} target={100} /></td><td className="num" style={{ width: 90 }}>{m.count} / {n}</td></tr>)}</tbody></table>
        </section>
        <section className="card">
          <h3>Below FDP-hours target ({noFdp.length})</h3><p className="sub">Target {t.fdpHoursPerFaculty} hours in the period</p>
          <DataTable rows={noFdp} columns={[...simple, { key: 'h', label: 'Hours', value: (r) => r.fdpHours, num: true }, { key: 'gap', label: 'Short by', value: (r) => t.fdpHoursPerFaculty - r.fdpHours, num: true }]} rowKey={(r) => r.faculty.id} pageSize={8} exportName="fdp_shortfall" empty="All faculty met the FDP target." />
        </section>
        <section className="card">
          <h3>Incomplete profiles ({lowBio.length})</h3><p className="sub">Below 80% — needed for accreditation files</p>
          <DataTable rows={lowBio} columns={[...simple, { key: 'b', label: 'Complete', value: (r) => r.biodata, render: (r) => <Attainment value={r.biodata} target={100} />, num: true }]} rowKey={(r) => r.faculty.id} pageSize={8} exportName="incomplete_profiles" empty="All profiles are at least 80% complete." />
        </section>
        <section className="card span-all">
          <h3>Approved entries without supporting documents ({missingDocs.length})</h3><p className="sub">Publications without full text and FDPs without certificate in the period</p>
          <DataTable rows={missingDocs} columns={recCols.slice(0, 4)} rowKey={(x) => x.r.id} pageSize={8} exportName="missing_documents" empty="All approved entries have documents." />
        </section>
      </div>
    </>
  );
}

