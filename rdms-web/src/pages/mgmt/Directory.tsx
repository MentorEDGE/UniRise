import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { activityByYear, ActivitySpark, Avatar, nameParts, SdgIcon, splitList } from '../../components/research';
import { creditedFaculty } from '../../lib/domain';
import { downloadCsv } from '../../lib/csv';
import { useStore } from '../../lib/store';
import type { Biodata, Faculty } from '../../lib/types';
import { SDGS } from '../../lib/types';

const PAGE = 24;
const SORTS = [
  { id: 'last', label: 'Last name (A–Z)' },
  { id: 'last-desc', label: 'Last name (Z–A)' },
  { id: 'first', label: 'First name (A–Z)' },
  { id: 'first-desc', label: 'First name (Z–A)' },
  { id: 'dept', label: 'Department' },
] as const;
type SortId = (typeof SORTS)[number]['id'];

interface Entry { f: Faculty; b?: Biodata; text: string; pubCount: number }

/** Faculty Search: read-only researcher discovery for Top-Level Management, with SDG, department and designation filters. */
export function FacultySearch() {
  const { db, user } = useStore();
  const isOffice = user?.role === 'office';
  const [params, setParams] = useSearchParams();
  const inactive = isOffice && params.get('inactive') === '1';
  const q = params.get('q') ?? '';
  const sdgs = (params.get('sdg') ?? '').split(',').map(Number).filter((n) => n >= 1 && n <= 17);
  const depts = params.getAll('dept');
  const desigs = params.getAll('desig');
  const sort = (SORTS.some((s) => s.id === params.get('sort')) ? params.get('sort') : 'last') as SortId;
  const page = Math.max(1, Number(params.get('page')) || 1);
  const [draft, setDraft] = useState(q);
  const [moreSdg, setMoreSdg] = useState(false);

  /** Updates the URL (so a search can be bookmarked or shared) and goes back to page 1. */
  const update = (fn: (p: URLSearchParams) => void, keepPage = false) => {
    const p = new URLSearchParams(params);
    fn(p);
    if (!keepPage) p.delete('page');
    setParams(p, { replace: true });
  };
  const toggle = (key: string, value: string) => update((p) => {
    const cur = p.getAll(key);
    p.delete(key);
    (cur.includes(value) ? cur.filter((x) => x !== value) : [...cur, value]).forEach((v) => p.append(key, v));
  });
  const toggleSdg = (n: number) => update((p) => {
    const next = sdgs.includes(n) ? sdgs.filter((x) => x !== n) : [...sdgs, n].sort((a, b) => a - b);
    if (next.length) p.set('sdg', next.join(',')); else p.delete('sdg');
  });

  // Everything a search can match: identity, department, profile text, SDGs and approved publication titles.
  const entries = useMemo<Entry[]>(() => {
    const bio = new Map(db.biodata.map((b) => [b.facultyId, b]));
    const pubs = new Map<string, string[]>();
    for (const p of db.publications) {
      if (p.status !== 'Approved') continue;
      for (const id of creditedFaculty('publications', p)) pubs.set(id, [...(pubs.get(id) ?? []), `${p.title} ${p.venue}`]);
    }
    return db.faculty.map((f) => {
      const b = bio.get(f.id);
      const text = [f.title, f.name, f.id, f.email, f.designation, f.department, f.orcid, f.scopusId, b?.summary, b?.researchInterests, b?.expertise, b?.keywords,
        ...(b?.sdgs ?? []).map((n) => `sdg ${n} ${SDGS[n - 1].title}`), ...(pubs.get(f.id) ?? [])].join(' \n ').toLowerCase();
      return { f, b, text, pubCount: pubs.get(f.id)?.length ?? 0 };
    });
  }, [db]);

  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  const base = entries.filter((e) => (inactive || e.f.active) && terms.every((t) => e.text.includes(t)));
  const bySdg = (e: Entry) => !sdgs.length || sdgs.some((n) => e.b?.sdgs.includes(n));
  const byDept = (e: Entry) => !depts.length || depts.includes(e.f.department);
  const byDesig = (e: Entry) => !desigs.length || desigs.includes(e.f.designation);
  const results = base.filter((e) => bySdg(e) && byDept(e) && byDesig(e));
  // Each facet counts the faculty that would match if that option were ticked, given the other filters.
  const sdgCount = (n: number) => base.filter((e) => byDept(e) && byDesig(e) && e.b?.sdgs.includes(n)).length;
  const deptCount = (d: string) => base.filter((e) => bySdg(e) && byDesig(e) && e.f.department === d).length;
  const designations = [...new Set(db.faculty.map((f) => f.designation))].sort();
  const desigCount = (d: string) => base.filter((e) => bySdg(e) && byDept(e) && e.f.designation === d).length;

  const sorted = [...results].sort((a, b) => {
    const pa = nameParts(a.f.name); const pb = nameParts(b.f.name);
    // Placeholder surnames (A … Z, AA …) sort like spreadsheet columns; real names sort alphabetically.
    const code = /^[A-Z]{1,3}$/;
    const cmp = (x: string, y: string) => (code.test(x) && code.test(y) && x.length !== y.length ? x.length - y.length : x.localeCompare(y, undefined, { numeric: true, sensitivity: 'base' }));
    switch (sort) {
      case 'last-desc': return cmp(pb.last, pa.last) || cmp(pb.first, pa.first);
      case 'first': return cmp(pa.first, pb.first) || cmp(pa.last, pb.last);
      case 'first-desc': return cmp(pb.first, pa.first) || cmp(pb.last, pa.last);
      case 'dept': return cmp(a.f.department, b.f.department) || cmp(pa.last, pb.last);
      default: return cmp(pa.last, pb.last) || cmp(pa.first, pb.first);
    }
  });
  const pages = Math.max(1, Math.ceil(sorted.length / PAGE));
  const cur = Math.min(page, pages);
  const shown = sorted.slice((cur - 1) * PAGE, cur * PAGE);
  const filtered = sdgs.length + depts.length + desigs.length > 0 || inactive;
  const sdgList = SDGS.map((g) => ({ ...g, count: sdgCount(g.n) })).sort((a, b) => b.count - a.count || a.n - b.n);
  const sdgShown = moreSdg ? sdgList : sdgList.filter((g, i) => i < 6 || sdgs.includes(g.n));

  const exportCsv = () => downloadCsv('faculty_search', ['Employee Code', 'Title', 'Name', 'Designation', 'Department', 'Email', 'ORCID', 'Areas of expertise', 'Research interests', 'SDGs', 'Approved publications'],
    sorted.map((e) => [e.f.id, e.f.title, e.f.name, e.f.designation, e.f.department, e.f.email, e.f.orcid, e.b?.expertise ?? '', e.b?.researchInterests ?? '',
      (e.b?.sdgs ?? []).map((n) => `SDG ${n}`).join('; '), e.pubCount]));

  return (
    <div className="dir">
      <section className="dir-hero">
        <h1 className="dir-title"><PersonGlyph /> Find Profiles</h1>
        <form className="dir-search" role="search" onSubmit={(e) => { e.preventDefault(); update((p) => (draft.trim() ? p.set('q', draft.trim()) : p.delete('q'))); }}>
          <input type="search" value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="Search faculty profiles"
            placeholder={`Search in profiles at ${db.settings.institutionName}`} />
          <button type="submit" aria-label="Search"><svg viewBox="0 0 24 24" aria-hidden><circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 5 5" /></svg></button>
        </form>
        <p className="dir-hint">Search by name, department, research area, expertise, keyword or publication</p>
        {q && <p className="dir-q">Showing results for “{q}” · <button type="button" className="link-btn" onClick={() => { setDraft(''); update((p) => p.delete('q')); }}>clear search</button></p>}
      </section>

      <PortalCounts />

      <div className="dir-body">
        <aside className="dir-filters" aria-label="Filters">
          <div className="dir-filters-head">
            <h2>Filters for profiles</h2>
            {filtered && <button type="button" className="link-btn" onClick={() => update((p) => { ['sdg', 'dept', 'desig', 'inactive'].forEach((k) => p.delete(k)); })}>Clear filters</button>}
          </div>

          <fieldset className="facet">
            <legend>Sustainable Development Goals</legend>
            {sdgShown.map((g) => (
              <label key={g.n} className={`facet-opt ${g.count === 0 && !sdgs.includes(g.n) ? 'zero' : ''}`}>
                <input type="checkbox" checked={sdgs.includes(g.n)} onChange={() => toggleSdg(g.n)} />
                <SdgIcon n={g.n} size={24} />
                <span>SDG {g.n} – {g.title} <span className="facet-n">({g.count})</span></span>
              </label>
            ))}
            <button type="button" className="link-btn facet-more" onClick={() => setMoreSdg(!moreSdg)} aria-expanded={moreSdg}>{moreSdg ? 'Show less ‹' : `Show all 17 goals ›`}</button>
            {sdgs.length > 1 && <p className="hint">Showing faculty linked to any of the selected goals.</p>}
          </fieldset>

          <fieldset className="facet">
            <legend>Department</legend>
            {db.settings.departments.map((d) => (
              <label key={d} className="facet-opt"><input type="checkbox" checked={depts.includes(d)} onChange={() => toggle('dept', d)} /><span>{d} <span className="facet-n">({deptCount(d)})</span></span></label>
            ))}
          </fieldset>

          <fieldset className="facet">
            <legend>Designation</legend>
            {designations.map((d) => (
              <label key={d} className="facet-opt"><input type="checkbox" checked={desigs.includes(d)} onChange={() => toggle('desig', d)} /><span>{d} <span className="facet-n">({desigCount(d)})</span></span></label>
            ))}
          </fieldset>

          {isOffice && <label className="facet-opt" style={{ marginTop: 12 }}><input type="checkbox" checked={inactive} onChange={() => update((p) => (inactive ? p.delete('inactive') : p.set('inactive', '1')))} /><span>Include deactivated faculty (Office of Research)</span></label>}
        </aside>

        <section className="dir-results" aria-label="Results">
          <div className="dir-bar">
            <span className="dir-count" aria-live="polite">{sorted.length ? `${(cur - 1) * PAGE + 1} – ${Math.min(cur * PAGE, sorted.length)} out of ${sorted.length} results` : 'No results'}</span>
            <label className="dir-sort">Sort by
              <select value={sort} onChange={(e) => update((p) => p.set('sort', e.target.value))}>{SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select>
            </label>
            <button type="button" className="link-btn" onClick={exportCsv} disabled={!sorted.length}>Export search results</button>
          </div>

          {shown.length ? (
            <ul className="person-grid">
              {shown.map((e) => <PersonCard key={e.f.id} e={e} />)}
            </ul>
          ) : (
            <div className="dir-empty">
              <p><b>No faculty match this search.</b></p>
              <p className="muted">Try fewer words, check the spelling, or clear the filters.</p>
            </div>
          )}

          {pages > 1 && (
            <nav className="pager" aria-label="Result pages">
              <button type="button" disabled={cur === 1} onClick={() => update((p) => p.set('page', String(cur - 1)), true)}>‹ Previous</button>
              {Array.from({ length: pages }, (_, i) => i + 1).map((n) => (
                <button type="button" key={n} className={n === cur ? 'on' : ''} aria-current={n === cur ? 'page' : undefined} onClick={() => update((p) => p.set('page', String(n)), true)}>{n}</button>
              ))}
              <button type="button" disabled={cur === pages} onClick={() => update((p) => p.set('page', String(cur + 1)), true)}>Next ›</button>
            </nav>
          )}
        </section>
      </div>
    </div>
  );
}

function PersonCard({ e }: { e: Entry }) {
  const { db } = useStore();
  const activity = useMemo(() => activityByYear(db, e.f.id), [db, e.f.id]);
  const expertise = splitList(e.b?.expertise || e.b?.researchInterests).slice(0, 2);
  return (
    <li className="person-card">
      <Link to={`/faculty/${e.f.id}`} tabIndex={-1} aria-hidden><Avatar name={e.f.name} photo={e.b?.photo} size={70} /></Link>
      <div className="person-info">
        <Link className="person-name" to={`/faculty/${e.f.id}`}>{e.f.title} {e.f.name}</Link>
        {!e.f.active && <span className="badge Draft" style={{ alignSelf: 'flex-start' }}>Deactivated</span>}
        <a className="person-email" href={`mailto:${e.f.email}`}>{e.f.email}</a>
        <div className="person-role"><span className="person-dept">{e.f.department}</span> – {e.f.designation}</div>
        {expertise.length > 0 && <div className="person-expertise">{expertise.join(' · ')}</div>}
        <ActivitySpark data={activity} height={22} />
      </div>
    </li>
  );
}

const PersonGlyph = () => <svg className="dir-glyph" viewBox="0 0 40 44" aria-hidden><circle cx="20" cy="15" r="8.5" /><path d="M4 44c0-9.5 7.2-16 16-16s16 6.5 16 16Z" /></svg>;

/** What the institution holds, counted from approved records, as icons with numbers under the search (like a research portal home). */
function PortalCounts() {
  const { db } = useStore();
  const ok = <T extends { status: string }>(xs: T[] | undefined) => (xs ?? []).filter((r) => r.status === 'Approved').length;
  const items: { label: string; n: number; to: string; d: string }[] = [
    { label: 'Profiles', n: db.faculty.filter((f) => f.active).length, to: '/faculty', d: 'M16 15a6 6 0 1 0 0-12 6 6 0 0 0 0 12Zm-11 15c1-6.5 5.4-10 11-10s10 3.5 11 10Z' },
    { label: 'Research units', n: db.settings.departments.length, to: '/analytics/departments', d: 'M2 15 16 3l14 12h-4v14h-7v-8h-6v8H6V15Z' },
    { label: 'Projects', n: ok(db.grants) + ok(db.seedMoney), to: '/grants', d: 'm16 2 13 6v15l-13 7-13-7V8Zm0 3.3L6.6 9.6 16 14l9.4-4.4ZM5 11.4v10.4l10 5.4V15.8Z' },
    { label: 'Outputs', n: ok(db.publications), to: '/publications', d: 'M3 6c4.5-1.6 8.6-1.4 12 1.2V28c-3.4-2.6-7.5-2.8-12-1.2Zm26 0c-4.5-1.6-8.6-1.4-12 1.2V28c3.4-2.6 7.5-2.8 12-1.2Z' },
    { label: 'Intellectual property', n: ok(db.ipr), to: '/ipr', d: 'M16 2a10 10 0 0 0-6 18c1.3 1 2 2.3 2 3.8V25h8v-1.2c0-1.5.7-2.8 2-3.8A10 10 0 0 0 16 2Zm-4 25h8v2h-8Zm1 3h6v1h-6Z' },
    { label: 'Prizes', n: ok(db.awards), to: '/awards', d: 'M9 3h14v8a7 7 0 0 1-14 0Zm0 2H3a6 6 0 0 0 6 7Zm14 0h6a6 6 0 0 1-6 7Zm-9 13h4v5h-4Zm-4 6h12v5H10Z' },
    { label: 'Activities', n: ok(db.fdps) + ok(db.conferences), to: '/conferences', d: 'M11 4h10v4h8v20H3V8h8Zm2 2v2h6V6ZM3 15h26v2H3Z' },
  ];
  return (
    <nav className="portal-counts" aria-label="What the institution holds">
      {items.map((x) => (
        <Link key={x.label} to={x.to} className="pc-item">
          <span className="pc-ic"><svg viewBox="0 0 32 32" aria-hidden><path d={x.d} fillRule="evenodd" /></svg><b>{x.n.toLocaleString('en-IN')}</b></span>
          <span className="pc-label">{x.label}</span>
        </Link>
      ))}
    </nav>
  );
}
