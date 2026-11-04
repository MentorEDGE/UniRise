import { useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Alert, DataTable, Field, Input, PageTitle, Panel, Select } from '../../components/ui';
import type { Column } from '../../components/ui';
import { downloadCsv } from '../../lib/csv';
import { academicYearRange, dateOf, facultyStats, fmtDate, inr, lakh, uniqueCounts } from '../../lib/analytics';
import { REPORTS, runReport } from '../../lib/reports';
import { creditedFaculty, useStore } from '../../lib/store';
import type { AnyRecord } from '../../lib/types';
import { STATUSES } from '../../lib/types';
import { useAnalyticsFilter } from '../mgmt/filters';
import { listColumns } from '../../lib/entities';
import { RecordDetail } from './RecordDetail';

const GROUP_TITLE: Record<string, string> = { publications: 'Publication Reports', grants: 'Project Reports', fdps: 'FDP Reports', conferences: 'Conference Reports' };

export function ReportsPage() {
  const { group = 'publications' } = useParams();
  const { db, user } = useStore();
  const [params, setParams] = useSearchParams();
  const defs = REPORTS.filter((r) => r.group === group);
  const def = defs.find((d) => d.id === params.get('r'));
  const isFaculty = user?.role === 'faculty';
  const [form, setForm] = useState({ from: '', to: '', dept: '', emp: '', status: 'Approved' });
  const [applied, setApplied] = useState(form);

  const result = useMemo(() => {
    if (!def) return null;
    const byId = new Map(db.faculty.map((f) => [f.id, f]));
    const q = applied;
    const recs = (db[def.kind] as AnyRecord[]).filter((r) => {
      const ids = creditedFaculty(def.kind, r);
      if (isFaculty && !ids.includes(user!.facultyId!)) return false;
      if (q.status && r.status !== q.status) return false;
      const d = dateOf(def.kind, r);
      if (q.from && d < q.from) return false;
      if (q.to && d > q.to) return false;
      if (q.dept && !ids.some((id) => byId.get(id)?.department === q.dept)) return false;
      if (q.emp && !ids.some((id) => id.toLowerCase() === q.emp.trim().toLowerCase())) return false;
      return true;
    });
    return runReport(def, recs, { db, byId });
  }, [def, db, applied, isFaculty, user]);

  if (!GROUP_TITLE[group]) return <Panel><Alert kind="error">Unknown report group.</Alert></Panel>;
  const fmtCell = (v: string | number, i: number) => (result!.money[i] && typeof v === 'number' ? inr(v) : typeof v === 'number' ? v.toLocaleString('en-IN') : v);
  const cols: Column<(string | number)[]>[] = result ? result.header.map((h, i) => ({ key: String(i), label: h, num: result.numeric[i], value: (r) => r[i], render: (r) => fmtCell(r[i], i) })) : [];
  return (
    <>
      <PageTitle>{GROUP_TITLE[group]}</PageTitle>
      <Panel size="wide" title={isFaculty ? `${GROUP_TITLE[group]} – my entries` : GROUP_TITLE[group]}>
        <div className="report-links">
          {defs.map((d) => <button key={d.id} className={d.id === def?.id ? 'on' : ''} onClick={() => { setParams({ r: d.id }); }}>{d.title}</button>)}
        </div>
      </Panel>
      {def && result && (
        <Panel size="wide" title={def.title}>
          <form className="grid" onSubmit={(e) => { e.preventDefault(); setApplied(form); }}>
            <Field label="From Date"><input type="date" value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} /></Field>
            <Field label="To Date"><input type="date" value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })} /></Field>
            <Field label="Status"><Select value={form.status} onChange={(v) => setForm({ ...form, status: v })} options={STATUSES} placeholder="ALL" /></Field>
            {!isFaculty ? <Field label="Department"><Select value={form.dept} onChange={(v) => setForm({ ...form, dept: v })} options={db.settings.departments} placeholder="ALL" /></Field> : <span />}
            {!isFaculty && <Field label="Employee Code"><Input value={form.emp} onChange={(v) => setForm({ ...form, emp: v })} list="emp-codes" /></Field>}
            <datalist id="emp-codes">{db.faculty.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</datalist>
            <div className="span4 btn-row" style={{ marginTop: 0 }}>
              <button className="btn" type="submit">View</button>
              <button className="btn secondary" type="button" onClick={() => downloadCsv(def.title, result.header, result.total ? [...result.rows, result.total] : result.rows)} disabled={!result.rows.length}>Export CSV</button>
              <button className="btn secondary" type="button" onClick={() => window.print()}>Print</button>
            </div>
          </form>
          <p className="note">Dates use the publication month, the grant applied date, or the programme / conference start date. {def.mode === 'group' && 'A record with several internal authors appears under each of them; the total counts it once.'}</p>
          <DataTable rows={result.rows} columns={cols} rowKey={(r) => r.join('|')} pageSize={25}
            footer={result.total ? <tr>{result.total.map((v, i) => <td key={i} className={result.numeric[i] ? 'num' : ''}>{fmtCell(v, i)}</td>)}</tr> : undefined} />
        </Panel>
      )}
      {!def && <Panel size="wide"><p className="note">Select a report above.</p></Panel>}
    </>
  );
}

// ---------------- Seed money report (management) ----------------

export function SeedMoneyReport() {
  const { db } = useStore();
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({ from: `${new Date().getFullYear()}-01-01`, to: today, status: '' });
  const [applied, setApplied] = useState(form);
  const [openId, setOpenId] = useState<string | null>(null);
  const rows = db.seedMoney.filter((s) => (!applied.from || s.appliedDate >= applied.from) && (!applied.to || s.appliedDate <= applied.to) && (!applied.status || s.status === applied.status))
    .sort((a, b) => b.appliedDate.localeCompare(a.appliedDate));
  const total = rows.reduce((a, s) => a + s.sanctionedAmount, 0);
  return (
    <>
      <PageTitle>Faculty Seed Money Details</PageTitle>
      <Panel size="wide">
        <form className="grid" onSubmit={(e) => { e.preventDefault(); setApplied(form); }}>
          <Field label="From Date"><input type="date" value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} /></Field>
          <Field label="To Date"><input type="date" value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })} /></Field>
          <Field label="Status"><Select value={form.status} onChange={(v) => setForm({ ...form, status: v })} options={[{ value: 'Approved', label: 'Approved' }, { value: 'Draft', label: 'Yet to be Submitted' }, { value: 'Submitted', label: 'Submitted' }, { value: 'Rework', label: 'Rework / Revision Required' }, { value: 'Rejected', label: 'Reject' }]} placeholder="ALL" /></Field>
          <div className="btn-row" style={{ alignSelf: 'end', marginTop: 0 }}><button className="btn" type="submit">View</button></div>
        </form>
        <p className="note">Seed money window is <b>{db.settings.seedMoneyWindowOpen ? 'open' : 'closed'}</b>. Change it in Settings → Institution & Departments.</p>
      </Panel>
      <Panel size="wide">
        <DataTable rows={rows} columns={listColumns(db, 'seedMoney', { showOwner: true })} rowKey={(r) => r.id} onRowClick={(r) => setOpenId(r.id)} exportName="seed_money" />
        <p className="note">Total sanctioned in the selection: <b>{inr(total)}</b>. Open a submitted proposal to set the sanctioned amount and approve it.</p>
      </Panel>
      {openId && <RecordDetail kind="seedMoney" id={openId} onClose={() => setOpenId(null)} />}
    </>
  );
}

// ---------------- Annual activity report (management) ----------------

export function AnnualReport() {
  const { db } = useStore();
  const { filter, bar, ay } = useAnalyticsFilter();
  const range = ay === 'all' ? { from: '', to: '' } : academicYearRange(ay, db.settings.academicYearStartMonth);
  const depts = filter.department ? [filter.department] : db.settings.departments;
  const byId = new Map(db.faculty.map((f) => [f.id, f]));
  const all = uniqueCounts(db, filter);
  return (
    <>
      <PageTitle>Annual Activity Report</PageTitle>
      <div className="panel wide no-print" style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, alignItems: 'end' }}>
        {bar}
        <button className="btn" onClick={() => window.print()}>Print / Save as PDF</button>
      </div>
      <article className="cv" style={{ maxWidth: 1000 }}>
        <h1>{db.settings.institutionName}</h1>
        <div>Annual Research &amp; Faculty Development Report — {ay === 'all' ? 'All years' : `Academic Year ${ay}`}{filter.department && ` — ${filter.department}`}</div>
        <div className="muted">{range.from && `${fmtDate(range.from)} to ${fmtDate(range.to)} · `}Approved entries only · generated {fmtDate(new Date().toISOString())}</div>
        <h2>Summary</h2>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>Department</th><th className="num">Faculty</th><th className="num">Publications</th><th className="num">Q1+Q2</th><th className="num">Grant proposals</th><th className="num">Sanctioned</th><th className="num">Seed money</th><th className="num">FDPs (hours)</th><th className="num">Conferences</th></tr></thead>
            <tbody>
              {depts.map((d) => {
                const u = uniqueCounts(db, { ...filter, department: d });
                return <tr key={d}><td>{d}</td><td className="num">{db.faculty.filter((f) => f.active && f.department === d).length}</td><td className="num">{u.pubs.length}</td>
                  <td className="num">{u.pubs.filter((p) => p.quartile === 'Q1' || p.quartile === 'Q2').length}</td><td className="num">{u.grants.length}</td><td className="num">{lakh(u.sanctionedAmount)}</td>
                  <td className="num">{lakh(u.seedAmount)}</td><td className="num">{u.fdps.length} ({u.fdpHours})</td><td className="num">{u.confs.length}</td></tr>;
              })}
            </tbody>
            {depts.length > 1 && <tfoot><tr><td>Institution (unique)</td><td className="num">{db.faculty.filter((f) => f.active).length}</td><td className="num">{all.pubs.length}</td><td className="num">{all.pubs.filter((p) => p.quartile === 'Q1' || p.quartile === 'Q2').length}</td><td className="num">{all.grants.length}</td><td className="num">{lakh(all.sanctionedAmount)}</td><td className="num">{lakh(all.seedAmount)}</td><td className="num">{all.fdps.length} ({all.fdpHours})</td><td className="num">{all.confs.length}</td></tr></tfoot>}
          </table>
        </div>
        <h2>Sanctioned research grants ({all.sanctioned.length})</h2>
        {all.sanctioned.length ? <ol>{all.sanctioned.map((g) => <li key={g.id}>“{g.title}” — {g.agency}; PI {g.investigators.find((i) => i.role === 'PI')?.name}; {inr(g.sanctionedAmount)} sanctioned ({g.outcome})</li>)}</ol> : <p className="muted">None.</p>}
        <h2>Journal publications in Q1 / Q2 journals</h2>
        {(() => {
          const top = all.pubs.filter((p) => p.quartile === 'Q1' || p.quartile === 'Q2');
          return top.length ? <ol>{top.map((p) => <li key={p.id}>{p.authors.map((a) => a.name).join(', ')}. “{p.title}”, <i>{p.venue}</i> ({p.quartile}), {p.month} {p.year}.</li>)}</ol> : <p className="muted">None.</p>;
        })()}
        <h2>Programmes organised and invited talks</h2>
        {(() => {
          const org = [...all.fdps.filter((f) => f.role !== 'Attended').map((f) => `${f.role}: ${f.programmeType} “${f.title}” — ${byId.get(f.facultyId)?.name}, ${fmtDate(f.fromDate)}`),
            ...all.confs.filter((c) => c.participation === 'Invited Talk / Keynote' || c.participation === 'Organised').map((c) => `${c.participation}: ${c.conferenceName} — ${byId.get(c.facultyId)?.name}, ${c.venue}, ${fmtDate(c.fromDate)}`)];
          return org.length ? <ol>{org.map((x, i) => <li key={i}>{x}</li>)}</ol> : <p className="muted">None.</p>;
        })()}
        <h2>Awards</h2>
        {(() => {
          const aw = all.confs.filter((c) => c.award);
          return aw.length ? <ol>{aw.map((c) => <li key={c.id}>{c.award} — {byId.get(c.facultyId)?.name}, {c.conferenceName}</li>)}</ol> : <p className="muted">None recorded.</p>;
        })()}
        <h2>Faculty-wise summary</h2>
        <FacultySummaryTable filter={filter} />
      </article>
    </>
  );
}

function FacultySummaryTable({ filter }: { filter: { from: string; to: string; department: string } }) {
  const { db } = useStore();
  const stats = facultyStats(db, filter).sort((a, b) => a.faculty.department.localeCompare(b.faculty.department) || a.faculty.name.localeCompare(b.faculty.name));
  return (
    <div className="tbl-wrap">
      <table className="tbl">
        <thead><tr><th>Faculty</th><th>Department</th><th className="num">Pubs</th><th className="num">Grants</th><th className="num">FDP h</th><th className="num">Conf.</th><th className="num">Score</th></tr></thead>
        <tbody>{stats.map((s) => <tr key={s.faculty.id}><td><Link to={`/faculty/${s.faculty.id}`}>{s.faculty.title} {s.faculty.name}</Link></td><td>{s.faculty.department}</td><td className="num">{s.publications}</td><td className="num">{s.grantsApplied}{s.grantsSanctioned ? ` (${s.grantsSanctioned})` : ''}</td><td className="num">{s.fdpHours}</td><td className="num">{s.conferences}</td><td className="num">{s.score}</td></tr>)}</tbody>
      </table>
    </div>
  );
}

