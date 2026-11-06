import { lazy, Suspense, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { NetworkGraph, forceLayout, outputsOf } from '../../components/network';
import type { Edge, Output } from '../../components/network';
import { SdgIcon } from '../../components/research';
import { PageTitle, Panel } from '../../components/ui';
import { useStore } from '../../lib/store';
import { SDGS } from '../../lib/types';
import { Tile } from './Analytics';

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
    return { ...g, faculty: fac.length, pubs };
  });
  const maxSdg = Math.max(1, ...sdgRows.map((r) => r.faculty));
  const name = (id: string) => { const f = byId.get(id); return f ? `${f.title} ${f.name}` : id; };

  return (
    <>
      <PageTitle>Research Networks</PageTitle>
      <div style={{ maxWidth: 1180, margin: '0 auto 14px' }}>
        <div className="tiles">
          <Tile label="Collaborative outputs" value={collaborative} sub={`of ${outputs.length} approved outputs`} />
          <Tile label="Faculty collaborating" value={new Set(edges.flatMap((e) => [e.a, e.b])).size} sub={`of ${active.length} active faculty`} />
          <Tile label="Cross-department links" value={cross.length} sub={`${edges.length} faculty pairs in all`} />
          <Tile label="External institutions" value={extInst.size} sub={`${countries.size} countries`} />
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
              {sel?.edge && <><h4>{name(sel.edge.a)} and {name(sel.edge.b)} · {sel.edge.outputs.length} shared output{sel.edge.outputs.length > 1 ? 's' : ''}</h4><ul>{[...sel.edge.outputs].sort((a, b) => b.year - a.year).map((o) => <li key={o.kind + o.id}>{o.title} <span className="muted">· {o.year}</span></li>)}</ul></>}
              {sel?.node && <><h4>{name(sel.node)}</h4><p>{byId.get(sel.node)?.designation}, {byId.get(sel.node)?.department} · {edges.filter((e) => e.a === sel.node || e.b === sel.node).length} collaborators</p><Link to={`/faculty/${sel.node}`}>Open research profile ›</Link></>}
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

        {tab === 'sdg' && (
          <>
            <p className="rp-sub">Faculty who list each Sustainable Development Goal on their approved profile, and the approved publications of those faculty.</p>
            <table className="tbl sdg-dist">
              <thead><tr><th>Goal</th><th>Faculty</th><th className="num">Publications</th></tr></thead>
              <tbody>{sdgRows.map((r) => (
                <tr key={r.n}>
                  <td><span className="sdg-row"><SdgIcon n={r.n} size={26} /> SDG {r.n} · {r.title}</span></td>
                  <td style={{ width: '40%' }}><span className="sdg-bar"><span style={{ width: `${(r.faculty / maxSdg) * 100}%`, background: r.color }} /></span> <b>{r.faculty}</b></td>
                  <td className="num">{r.pubs}</td>
                </tr>
              ))}</tbody>
            </table>
          </>
        )}
      </Panel>
    </>
  );
}

/** Faculty: their own collaboration network and collaborating countries. */
export function MyCollaborations() {
  const { db, user } = useStore();
  const [tab, setTab] = useState<'graph' | 'map'>('graph');
  return (
    <>
      <PageTitle>My Collaborations</PageTitle>
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
