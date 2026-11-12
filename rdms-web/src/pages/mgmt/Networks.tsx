import { plural } from '../../lib/analytics';
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { NetworkGraph, SharedOutputs, forceLayout, outputsOf } from '../../components/network';
import type { Edge, Output } from '../../components/network';
import { SdgTile } from '../../components/sdg';
import { PageTitle, Panel } from '../../components/ui';
import { useStore } from '../../lib/store';
import { SDGS } from '../../lib/types';
import { Tile } from './Analytics';
import { RecordDetail } from '../shared/RecordDetail';

const CollabMap = lazy(() => import('../../components/CollabMap'));
const DEPT_COLORS = ['#7c3aed', '#db2777', '#d97706', '#0d9488', '#2563eb', '#65a30d', '#dc2626', '#0891b2', '#9333ea', '#ca8a04'];

/**
 * Research Networks (Top-Level Management, read-only; Office of Research): collaboration between faculty across the
 * institution, collaborating countries and SDG-wise distribution. Built from approved records only.
 */
export function InstitutionNetworks() {
  const { db } = useStore();
  const [tab, setTab] = useState<'graph' | 'depts' | 'map' | 'sdg'>('graph');
  const [dept, setDept] = useState('');
  const [min, setMin] = useState(1);
  const [sel, setSel] = useState<{ edge?: Edge; node?: string } | null>(null);
  const [openRec, setOpenRec] = useState<Output | null>(null);
  const active = useMemo(() => db.faculty.filter((f) => f.active), [db]);
  const byId = useMemo(() => new Map(active.map((f) => [f.id, f])), [active]);

  // Every approved output with the faculty credited on it, once.
  const outputs = useMemo(() => {
    const seen = new Map<string, { out: Output; faculty: string[]; external: { institution: string; country: string }[] }>();
    for (const f of active) {
      const src = outputsOf(db, f.id);
      for (const it of src.items) {
        const key = it.out.kind + it.out.id;
        if (seen.has(key)) continue;
        const people = it.who.map((k) => src.people.get(k)!);
        seen.set(key, { out: it.out, faculty: people.filter((p) => p.type === 'profile' && p.facultyId && byId.has(p.facultyId)).map((p) => p.facultyId!), external: people.filter((p) => p.type === 'external').map((p) => ({ institution: p.institution, country: p.country })) });
      }
    }
    return [...seen.values()];
  }, [db, active, byId]);

  const edges = useMemo(() => {
    const m = new Map<string, Edge>();
    for (const o of outputs) {
      const fs = [...new Set(o.faculty)].sort();
      for (let i = 0; i < fs.length; i++) for (let j = i + 1; j < fs.length; j++) {
        const key = `${fs[i]}~${fs[j]}`;
        const e = m.get(key) ?? { a: fs[i], b: fs[j], outputs: [] };
        e.outputs.push(o.out); m.set(key, e);
      }
    }
    return [...m.values()];
  }, [outputs]);

  const shown = edges.filter((e) => e.outputs.length >= min && (!dept || byId.get(e.a)?.department === dept || byId.get(e.b)?.department === dept));
  const nodes = [...new Set(shown.flatMap((e) => [e.a, e.b]))];
  const pos = useMemo(() => forceLayout(nodes, shown, '', 0.8), [nodes.join(), shown.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const depts = db.settings.departments;
  const color = (id: string) => DEPT_COLORS[Math.max(0, depts.indexOf(byId.get(id)?.department ?? '')) % DEPT_COLORS.length];
  const pts = [...pos.values()];
  const pad = 80;
  const box = pts.length ? { x0: Math.min(...pts.map((p) => p.x)) - pad, y0: Math.min(...pts.map((p) => p.y)) - pad, x1: Math.max(...pts.map((p) => p.x)) + pad, y1: Math.max(...pts.map((p) => p.y)) + pad } : { x0: -100, y0: -100, x1: 100, y1: 100 };
  const maxW = Math.max(1, ...shown.map((e) => e.outputs.length));

  const cross = edges.filter((e) => byId.get(e.a)?.department !== byId.get(e.b)?.department);
  const extInst = new Set(outputs.flatMap((o) => o.external.map((x) => x.institution).filter(Boolean)));
  const countries = new Set(outputs.flatMap((o) => o.external.map((x) => x.country).filter(Boolean)));
  const collaborative = outputs.filter((o) => new Set(o.faculty).size > 1 || o.external.length).length;
  const matrix = depts.map((a) => depts.map((b) => edges.filter((e) => { const da = byId.get(e.a)?.department; const db2 = byId.get(e.b)?.department; return (da === a && db2 === b) || (da === b && db2 === a); }).reduce((n, e) => n + e.outputs.length, 0)));
  const maxCell = Math.max(1, ...matrix.flat());

  const sdgRows = SDGS.map((g) => {
    const fac = active.filter((f) => db.biodata.find((b) => b.facultyId === f.id)?.sdgs?.includes(g.n));
    const ids = new Set(fac.map((f) => f.id));
    const pubs = outputs.filter((o) => o.out.kind === 'publications' && o.faculty.some((id) => ids.has(id))).length;
    return { ...g, faculty: fac.length, units: new Set(fac.map((f) => f.department)).size, pubs };
  });
  const name = (id: string) => { const f = byId.get(id); return f ? `${f.title} ${f.name}` : id; };

  return (
    <>
      <PageTitle sub="Who works with whom, across departments and with other institutions, from approved co-authored work.">Research Networks</PageTitle>
      <div style={{ maxWidth: 1180, margin: '0 auto 14px' }}>
        <div className="tiles">
          <Tile label="Collaborative outputs" value={collaborative} sub={`of ${outputs.length} approved outputs`} />
          <Tile label="Faculty collaborating" value={new Set(edges.flatMap((e) => [e.a, e.b])).size} sub={`of ${active.length} active faculty`} />
          <Tile label="Cross-department links" value={cross.length} sub={`${edges.length} faculty pairs in all`} />
          <Tile label="External institutions" value={extInst.size} sub={plural(countries.size, 'country', 'countries')} />
        </div>
      </div>
      <Panel size="wide">
        <div className="net-tabs" role="tablist">
          {([['graph', 'Collaboration network'], ['depts', 'Between departments'], ['map', 'Countries'], ['sdg', 'SDG distribution']] as const).map(([id, l]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>{l}</button>
          ))}
        </div>

        {tab === 'graph' && (
          <>
            <div className="filters" style={{ marginBottom: 10 }}>
              <label className="net-sel">Department <select value={dept} onChange={(e) => setDept(e.target.value)}><option value="">All departments</option>{depts.map((d) => <option key={d}>{d}</option>)}</select></label>
              <label className="net-sel">Collaboration minimum <select value={min} onChange={(e) => setMin(Number(e.target.value))}>{[1, 2, 3, 4, 5].map((n) => <option key={n}>{n}</option>)}</select></label>
              <span className="muted">Each dot is a faculty member, coloured by department; a line joins two who share approved outputs.</span>
            </div>
            <ul className="net-legend-row">{depts.map((d, i) => <li key={d}><span style={{ background: DEPT_COLORS[i % DEPT_COLORS.length] }} />{d}</li>)}</ul>
            {nodes.length ? (
              <svg className="net-svg inst" viewBox={`${box.x0} ${box.y0} ${box.x1 - box.x0} ${box.y1 - box.y0}`} role="img" aria-label={`Collaboration network: ${nodes.length} faculty, ${shown.length} links`}>
                {shown.map((e) => { const a = pos.get(e.a)!, b = pos.get(e.b)!; return (
                  <g key={`${e.a}~${e.b}`} className={`net-edge ${sel?.edge === e ? 'on' : ''}`} onClick={() => setSel({ edge: e })}>
                    <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} strokeWidth={1 + (e.outputs.length / maxW) * 6} /><line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="net-hit" />
                    <title>{`${name(e.a)} – ${name(e.b)}: ${e.outputs.length}`}</title>
                  </g>); })}
                {nodes.map((id) => { const p = pos.get(id)!; return (
                  <g key={id} className={`net-node inst ${sel?.node === id ? 'on' : ''}`} transform={`translate(${p.x} ${p.y})`} onClick={() => setSel({ node: id })} tabIndex={0} role="button" aria-label={name(id)}>
                    <circle r={9} style={{ fill: color(id) }} /><text y={22} textAnchor="middle">{byId.get(id)?.name}</text>
                  </g>); })}
              </svg>
            ) : <p className="muted net-empty">No collaborations match these filters.</p>}
            <div className="net-detail">
              {!sel && <p className="muted">ⓘ Click a line to see the shared outputs, or a person to open their profile.</p>}
              {sel?.edge && <><h4>{name(sel.edge.a)} and {name(sel.edge.b)} · {sel.edge.outputs.length} shared output{sel.edge.outputs.length > 1 ? 's' : ''}</h4><SharedOutputs outputs={sel.edge.outputs} onOpen={setOpenRec} /></>}
              {sel?.node && (() => {
                const mine = edges.filter((e) => e.a === sel.node || e.b === sel.node).map((e) => ({ other: e.a === sel.node ? e.b : e.a, outputs: e.outputs })).sort((x, y) => y.outputs.length - x.outputs.length || name(x.other).localeCompare(name(y.other)));
                return <>
                  <h4>{name(sel.node)}</h4>
                  <p>{byId.get(sel.node)?.designation}, {byId.get(sel.node)?.department} · {mine.length} collaborator{mine.length === 1 ? '' : 's'} · <Link to={`/faculty/${sel.node}`}>Open research profile ›</Link></p>
                  {mine.length > 0 && <div className="net-collabs">{mine.map((c) => (
                    <section key={c.other}>
                      <h5><button type="button" className="link-btn" onClick={() => setSel({ node: c.other })}>{name(c.other)}</button> <span className="muted">· {byId.get(c.other)?.department} · {c.outputs.length} shared output{c.outputs.length > 1 ? 's' : ''}</span></h5>
                      <SharedOutputs outputs={c.outputs} onOpen={setOpenRec} />
                    </section>
                  ))}</div>}
                </>;
              })()}
            </div>
          </>
        )}

        {tab === 'depts' && (
          <>
            <p className="rp-sub">Shared approved outputs between faculty of each pair of departments (the diagonal is collaboration inside a department).</p>
            <div className="tbl-wrap">
              <table className="tbl matrix">
                <thead><tr><th>Department</th>{depts.map((d) => <th key={d} className="num" title={d}>{d.split(/[\s&]+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 4)}</th>)}</tr></thead>
                <tbody>{depts.map((d, i) => <tr key={d}><td>{d}</td>{matrix[i].map((n, j) => <td key={j} className="num" style={{ background: n ? `rgb(124 58 237 / ${0.08 + (n / maxCell) * 0.5})` : undefined }}>{n || ''}</td>)}</tr>)}</tbody>
              </table>
            </div>
          </>
        )}

        {tab === 'map' && <Suspense fallback={<p className="muted">Loading map…</p>}><CollabMap db={db} facultyIds={active.map((f) => f.id)} /></Suspense>}

        {tab === 'sdg' && <SdgGrid rows={sdgRows} />}
      </Panel>
      {openRec && <RecordDetail kind={openRec.kind} id={openRec.id} onClose={() => setOpenRec(null)} />}
    </>
  );
}

/** Faculty: their own collaboration network and collaborating countries. */
export function MyCollaborations() {
  const { db, user } = useStore();
  const [tab, setTab] = useState<'graph' | 'map'>('graph');
  return (
    <>
      <PageTitle sub="Built automatically from your approved co-authored publications and grants.">My Collaborations</PageTitle>
      <Panel size="wide" actions={<><Link className="btn sm secondary" to="/publications/entry">Add publication</Link> <Link className="btn sm secondary" to="/grants/entry">Add grant</Link></>}>
        <p className="note" style={{ marginTop: 0 }}>Your collaborators come from the co-authors and co-investigators on your approved publications, grants and seed-money projects. To add a collaboration, list the person (and, for external collaborators, their institution and country) on the entry.</p>
        <div className="net-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'graph'} className={tab === 'graph' ? 'on' : ''} onClick={() => setTab('graph')}>Visualization</button>
          <button type="button" role="tab" aria-selected={tab === 'map'} className={tab === 'map' ? 'on' : ''} onClick={() => setTab('map')}>Map</button>
        </div>
        {tab === 'graph' ? <NetworkGraph db={db} facultyId={user!.facultyId!} linkProfiles={false} /> : <Suspense fallback={<p className="muted">Loading map…</p>}><CollabMap db={db} facultyId={user!.facultyId!} /></Suspense>}
      </Panel>
    </>
  );
}

/** The 17 goals as coloured tiles (as on a university research portal). Choosing one shows what the institution has under it. */
function SdgGrid({ rows }: { rows: { n: number; title: string; faculty: number; units: number; pubs: number }[] }) {
  const [open, setOpen] = useState<number | null>(null);
  useEffect(() => {
    if (open == null) return;
    const close = (e: MouseEvent | KeyboardEvent) => { if (e instanceof KeyboardEvent ? e.key === 'Escape' : !(e.target as Element).closest('.sdg-goal')) setOpen(null); };
    document.addEventListener('mousedown', close); document.addEventListener('keydown', close);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close); };
  }, [open]);
  return (
    <>
      <p className="rp-sub sdg-intro">Every great change begins with a question. Research turns questions into answers the world needs, and the 17 Sustainable Development Goals show where those answers matter most. Choose a goal to see who is answering it.</p>
      <ul className="sdg-grid">
        {rows.map((r) => (
          <li key={r.n} className={`sdg-goal ${open === r.n ? 'on' : ''}`}>
            <button type="button" aria-expanded={open === r.n} onClick={() => setOpen(open === r.n ? null : r.n)}>
              <SdgTile n={r.n} size={72} />
              <span className="sdg-goal-text"><b>SDG {r.n}</b><span>{r.title}</span></span>
            </button>
            {open === r.n && (
              <div className="sdg-pop" role="dialog" aria-label={`SDG ${r.n}`}>
                <Link to={`/faculty?sdg=${r.n}`}><PopIcon d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5Z" /><b>{r.faculty}</b> Profiles</Link>
                <Link to={`/faculty?sdg=${r.n}`}><PopIcon d="m3 11 9-7 9 7v9h-6v-5H9v5H3Z" /><b>{r.units}</b> Research units</Link>
                <div><PopIcon d="M4 5c3-1 5.5-1 8 .8V20c-2.5-1.8-5-1.8-8-.8Zm16 0c-3-1-5.5-1-8 .8V20c2.5-1.8 5-1.8 8-.8Z" /><b>{r.pubs}</b> Outputs</div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
const PopIcon = ({ d }: { d: string }) => <svg viewBox="0 0 24 24" className="sdg-pop-ic" aria-hidden><path d={d} /></svg>;

