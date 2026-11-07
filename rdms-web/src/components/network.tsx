import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { creditedFaculty } from '../lib/domain';
import { RecordDetail } from '../pages/shared/RecordDetail';
import type { DB, Grant, Publication, SeedMoney } from '../lib/types';

/**
 * Collaboration network of one researcher, built only from APPROVED publications, grants and seed-money projects:
 * every person on the same output is linked, and a line's weight is the number of outputs two people share.
 */

export interface Output { kind: 'publications' | 'grants' | 'seedMoney'; id: string; title: string; year: number }
export interface Person { key: string; name: string; type: 'profile' | 'external'; facultyId?: string; institution: string; department: string; country: string }
export interface Edge { a: string; b: string; outputs: Output[] }

const strip = (n: string) => n.replace(/^(Dr\.|Prof\.|Mr\.|Ms\.|Mrs\.)\s*/, '').trim();

/** Approved outputs credited to the faculty member, with everyone on them. */
export function outputsOf(db: DB, facultyId: string) {
  const byId = new Map(db.faculty.map((f) => [f.id, f]));
  const people = new Map<string, Person>();
  const items: { out: Output; who: string[] }[] = [];
  const add = (p: Person) => { if (!people.has(p.key)) people.set(p.key, p); return p.key; };
  const internal = (code: string, fallback: string) => {
    const f = byId.get(code);
    return add({ key: `F:${code}`, name: f ? `${f.title} ${f.name}` : fallback, type: 'profile', facultyId: code, institution: db.settings.institutionName, department: f?.department ?? '', country: '' });
  };
  const external = (name: string, institution: string, country = '') => add({ key: `X:${strip(name).toLowerCase()}|${institution.toLowerCase()}`, name: strip(name), type: 'external', institution, department: '', country });
  for (const p of db.publications as Publication[]) {
    if (p.status !== 'Approved' || !creditedFaculty('publications', p).includes(facultyId)) continue;
    const who = p.authors.map((a) => (a.kind === 'Faculty' && a.code ? internal(a.code, a.name) : a.kind === 'External' && a.name ? external(a.name, a.institution, a.country) : '')).filter(Boolean);
    items.push({ out: { kind: 'publications', id: p.id, title: p.title, year: p.year }, who: [...new Set(who)] });
  }
  for (const [kind, list] of [['grants', db.grants], ['seedMoney', db.seedMoney]] as const) {
    for (const g of list as (Grant | SeedMoney)[]) {
      if (g.status !== 'Approved' || !creditedFaculty(kind, g).includes(facultyId)) continue;
      const who = g.investigators.map((i) => (i.kind === 'Faculty' && i.code ? internal(i.code, i.name) : i.kind === 'External' && i.name ? external(i.name, i.institution, i.country) : '')).filter(Boolean);
      items.push({ out: { kind, id: g.id, title: g.title, year: Number(g.appliedDate.slice(0, 4)) }, who: [...new Set(who)] });
    }
  }
  return { people, items, center: `F:${facultyId}` };
}

export interface GraphFilter { from: number; to: number; profiles: boolean; external: boolean; min: number }

export function buildGraph(src: ReturnType<typeof outputsOf>, f: GraphFilter) {
  const allowed = (k: string) => k === src.center || (src.people.get(k)?.type === 'profile' ? f.profiles : f.external);
  const edges = new Map<string, Edge>();
  for (const { out, who } of src.items) {
    if (out.year < f.from || out.year > f.to) continue;
    const w = who.filter(allowed);
    for (let i = 0; i < w.length; i++) for (let j = i + 1; j < w.length; j++) {
      const [a, b] = [w[i], w[j]].sort();
      const key = `${a}~${b}`;
      const e = edges.get(key) ?? { a, b, outputs: [] };
      e.outputs.push(out);
      edges.set(key, e);
    }
  }
  const strong = [...edges.values()].filter((e) => e.outputs.length >= f.min);
  const keep = new Set([src.center, ...strong.filter((e) => e.a === src.center || e.b === src.center).flatMap((e) => [e.a, e.b])]);
  return { nodes: [...keep].map((k) => src.people.get(k)!).filter(Boolean), edges: strong.filter((e) => keep.has(e.a) && keep.has(e.b)) };
}

type XY = { x: number; y: number };
/** Deterministic force layout (no randomness, so the picture is the same every time). */
export function forceLayout(keys: string[], edges: Edge[], center: string, spread: number): Map<string, XY> {
  const pos = new Map<string, XY>();
  const n = keys.length;
  keys.forEach((k, i) => pos.set(k, k === center ? { x: 0, y: 0 } : { x: Math.cos((i / n) * Math.PI * 2) * 180, y: Math.sin((i / n) * Math.PI * 2) * 180 }));
  const maxW = Math.max(1, ...edges.map((e) => e.outputs.length));
  for (let it = 0; it < 320; it++) {
    const force = new Map(keys.map((k) => [k, { x: 0, y: 0 }]));
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const a = pos.get(keys[i])!, b = pos.get(keys[j])!;
      const dx = a.x - b.x, dy = a.y - b.y, d2 = Math.max(dx * dx + dy * dy, 25);
      const rep = (9000 * spread) / d2;
      const d = Math.sqrt(d2);
      force.get(keys[i])!.x += (dx / d) * rep; force.get(keys[i])!.y += (dy / d) * rep;
      force.get(keys[j])!.x -= (dx / d) * rep; force.get(keys[j])!.y -= (dy / d) * rep;
    }
    for (const e of edges) {
      const a = pos.get(e.a)!, b = pos.get(e.b)!;
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.max(Math.hypot(dx, dy), 1);
      const target = 150 * spread * (1.2 - (e.outputs.length / maxW) * 0.5);
      const k = (d - target) * 0.04;
      force.get(e.a)!.x += (dx / d) * k; force.get(e.a)!.y += (dy / d) * k;
      force.get(e.b)!.x -= (dx / d) * k; force.get(e.b)!.y -= (dy / d) * k;
    }
    const cool = 1 - it / 340;
    for (const k of keys) {
      if (k === center) continue;
      const p = pos.get(k)!, fo = force.get(k)!;
      p.x += Math.max(-12, Math.min(12, fo.x - p.x * 0.01)) * cool;
      p.y += Math.max(-12, Math.min(12, fo.y - p.y * 0.01)) * cool;
    }
  }
  return pos;
}
function circleLayout(keys: string[], center: string, spread: number) {
  const others = keys.filter((k) => k !== center);
  const r = Math.max(140, others.length * 16) * spread;
  return new Map<string, XY>([[center, { x: 0, y: 0 }], ...others.map((k, i): [string, XY] => [k, { x: Math.cos((i / others.length) * Math.PI * 2 - Math.PI / 2) * r, y: Math.sin((i / others.length) * Math.PI * 2 - Math.PI / 2) * r }])]);
}

const KIND_LABEL = { publications: 'Publication', grants: 'Grant', seedMoney: 'Seed money' };

/** The "Visualization" view: filters on the left, interactive graph on the right. */
export function NetworkGraph({ db, facultyId, linkProfiles }: { db: DB; facultyId: string; linkProfiles: boolean }) {
  const src = useMemo(() => outputsOf(db, facultyId), [db, facultyId]);
  const years = src.items.map((i) => i.out.year).filter(Boolean);
  const minY = years.length ? Math.min(...years) : new Date().getFullYear();
  const maxY = years.length ? Math.max(...years) : new Date().getFullYear();
  const [f, setF] = useState<GraphFilter>({ from: Math.max(minY, maxY - 4), to: maxY, profiles: true, external: true, min: 1 });
  const [layout, setLayout] = useState<'force' | 'circle'>('force');
  const [zoom, setZoom] = useState(1);
  const [spread, setSpread] = useState(1);
  const [counts, setCounts] = useState(false);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<{ edge?: Edge; node?: Person } | null>(null);
  const [openRec, setOpenRec] = useState<Output | null>(null);
  const g = useMemo(() => buildGraph(src, f), [src, f]);
  const pos = useMemo(() => {
    const keys = g.nodes.map((n) => n.key);
    return layout === 'force' ? forceLayout(keys, g.edges, src.center, spread) : circleLayout(keys, src.center, spread);
  }, [g, layout, src.center, spread]);
  const pts = [...pos.values()];
  const pad = 90;
  const box = pts.length ? { x0: Math.min(...pts.map((p) => p.x)) - pad, y0: Math.min(...pts.map((p) => p.y)) - pad, x1: Math.max(...pts.map((p) => p.x)) + pad, y1: Math.max(...pts.map((p) => p.y)) + pad } : { x0: -200, y0: -200, x1: 200, y1: 200 };
  const w = (box.x1 - box.x0) / zoom, h = (box.y1 - box.y0) / zoom;
  const cx = (box.x0 + box.x1) / 2, cy = (box.y0 + box.y1) / 2;
  const maxW = Math.max(1, ...g.edges.map((e) => e.outputs.length));
  const match = (p: Person) => !!q.trim() && p.name.toLowerCase().includes(q.trim().toLowerCase());
  const yearOpts = Array.from({ length: maxY - minY + 1 }, (_, i) => minY + i);
  const name = (k: string) => src.people.get(k)?.name ?? k;

  return (
    <div className="net">
      <aside className="net-filters" aria-label="Network filters">
        <h3>Filter based on content type</h3>
        <label className="check"><input type="checkbox" checked={f.profiles} onChange={(e) => setF({ ...f, profiles: e.target.checked })} /> <PersonIcon /> Profiles</label>
        <label className="check"><input type="checkbox" checked={f.external} onChange={(e) => setF({ ...f, external: e.target.checked })} /> <PersonIcon outline /> External persons</label>
        <label className="check" style={{ marginTop: 10 }}><input type="checkbox" checked={counts} onChange={(e) => setCounts(e.target.checked)} /> Show counts on lines</label>
        <h3>Filter based on year</h3>
        <label className="net-sel">Start year <select value={f.from} onChange={(e) => setF({ ...f, from: Math.min(Number(e.target.value), f.to) })}>{yearOpts.map((y) => <option key={y}>{y}</option>)}</select></label>
        <label className="net-sel">End year <select value={f.to} onChange={(e) => setF({ ...f, to: Math.max(Number(e.target.value), f.from) })}>{yearOpts.map((y) => <option key={y}>{y}</option>)}</select></label>
        <label className="net-sel">Collaboration minimum <select value={f.min} onChange={(e) => setF({ ...f, min: Number(e.target.value) })}>{[1, 2, 3, 4, 5].map((n) => <option key={n}>{n}</option>)}</select></label>
      </aside>
      <div className="net-main">
        <div className="net-tools">
          <button type="button" onClick={() => setZoom(Math.min(4, zoom * 1.25))} aria-label="Zoom in" title="Zoom in">{ZoomIcon('+')}</button>
          <button type="button" onClick={() => setZoom(Math.max(0.5, zoom / 1.25))} aria-label="Zoom out" title="Zoom out">{ZoomIcon('-')}</button>
          <button type="button" onClick={() => { setSpread(Math.min(2, spread * 1.25)); }} aria-label="Spread out" title="Spread out">⤢</button>
          <button type="button" onClick={() => { setSpread(Math.max(0.6, spread / 1.25)); }} aria-label="Pull together" title="Pull together">⤡</button>
          <span className="net-seg" role="group" aria-label="Layout">
            <button type="button" className={layout === 'force' ? 'on' : ''} aria-pressed={layout === 'force'} onClick={() => setLayout('force')}>Force</button>
            <button type="button" className={layout === 'circle' ? 'on' : ''} aria-pressed={layout === 'circle'} onClick={() => setLayout('circle')}>Circle</button>
          </span>
          <button type="button" onClick={() => { setZoom(1); setSpread(1); }} title="Fit to view">Fit</button>
          <input type="search" placeholder="Find a person" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find a person in the network" />
        </div>
        {g.nodes.length <= 1 ? (
          <p className="muted net-empty">No collaborations match these filters. Try a wider year range or a lower collaboration minimum.</p>
        ) : (
          <svg className="net-svg" viewBox={`${cx - w / 2} ${cy - h / 2} ${w} ${h}`} role="img" aria-label={`Collaboration network: ${g.nodes.length - 1} collaborators, ${g.edges.length} links`}>
            {g.edges.map((e) => {
              const a = pos.get(e.a)!, b = pos.get(e.b)!;
              const on = sel?.edge === e;
              return (
                <g key={`${e.a}~${e.b}`} className={`net-edge ${on ? 'on' : ''}`} onClick={() => setSel({ edge: e })}>
                  <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} strokeWidth={1 + (e.outputs.length / maxW) * 7} />
                  <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="net-hit" />
                  {counts && <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2} className="net-count">{e.outputs.length}</text>}
                  <title>{`${name(e.a)} – ${name(e.b)}: ${e.outputs.length} shared output${e.outputs.length > 1 ? 's' : ''}`}</title>
                </g>
              );
            })}
            {g.nodes.map((p) => {
              const at = pos.get(p.key)!;
              const isCenter = p.key === src.center;
              return (
                <g key={p.key} className={`net-node ${p.type} ${isCenter ? 'center' : ''} ${match(p) ? 'hit' : ''} ${sel?.node === p ? 'on' : ''}`} transform={`translate(${at.x} ${at.y})`} onClick={() => setSel({ node: p })} tabIndex={0} role="button" aria-label={p.name}
                  onKeyDown={(ev) => ev.key === 'Enter' && setSel({ node: p })}>
                  <circle r={isCenter ? 15 : 12} className="net-dot" />
                  <path d="M0 -6.5a3.6 3.6 0 1 1 0 7.2a3.6 3.6 0 1 1 0-7.2ZM-6.5 7.5c.6-3.4 3.2-5.2 6.5-5.2s5.9 1.8 6.5 5.2Z" transform={isCenter ? 'scale(1.25)' : undefined} />
                  <text y={isCenter ? 30 : 26} textAnchor="middle">{p.name}</text>
                </g>
              );
            })}
          </svg>
        )}
        <div className="net-detail" aria-live="polite">
          {!sel && <p className="muted">ⓘ Click a line in the diagram to see collaboration details. Click a person to see who they are.</p>}
          {sel?.edge && (
            <>
              <h4>{name(sel.edge.a)} and {name(sel.edge.b)} · {sel.edge.outputs.length} shared output{sel.edge.outputs.length > 1 ? 's' : ''}</h4>
              <SharedOutputs outputs={sel.edge.outputs} onOpen={setOpenRec} />
            </>
          )}
          {sel?.node && (
            <>
              <h4>{sel.node.name}</h4>
              <p>{sel.node.type === 'profile' ? `Faculty · ${sel.node.department}, ${sel.node.institution}` : `External person · ${sel.node.institution || 'institution not recorded'}${sel.node.country ? `, ${sel.node.country}` : ''}`}</p>
              {sel.node.type === 'profile' && sel.node.facultyId !== facultyId && linkProfiles && <p><Link to={`/faculty/${sel.node.facultyId}`}>Open research profile ›</Link></p>}
              {(() => {
                const key = sel.node.key;
                const mine = g.edges.filter((e) => e.a === key || e.b === key).map((e) => ({ other: e.a === key ? e.b : e.a, outputs: e.outputs })).sort((x, y) => y.outputs.length - x.outputs.length || name(x.other).localeCompare(name(y.other)));
                if (!mine.length) return null;
                return <div className="net-collabs">{mine.map((c) => (
                  <section key={c.other}>
                    <h5><button type="button" className="link-btn" onClick={() => { const p = src.people.get(c.other); if (p) setSel({ node: p }); }}>{name(c.other)}</button> <span className="muted">· {src.people.get(c.other)?.institution || '—'} · {c.outputs.length} shared output{c.outputs.length > 1 ? 's' : ''}</span></h5>
                    <SharedOutputs outputs={c.outputs} onOpen={setOpenRec} />
                  </section>
                ))}</div>;
              })()}
            </>
          )}
        </div>
      </div>
      {openRec && <RecordDetail kind={openRec.kind} id={openRec.id} onClose={() => setOpenRec(null)} />}
    </div>
  );
}

/** The papers and projects two people share, newest first; each opens the full record. */
export function SharedOutputs({ outputs, onOpen }: { outputs: Output[]; onOpen: (o: Output) => void }) {
  return (
    <ul className="net-outputs">{[...outputs].sort((a, b) => b.year - a.year || a.title.localeCompare(b.title)).map((o) => (
      <li key={o.kind + o.id}><span className={`net-kind ${o.kind}`}>{KIND_LABEL[o.kind]}</span><button type="button" className="link-btn" onClick={() => onOpen(o)}>{o.title}</button> <span className="muted">· {o.year}</span></li>
    ))}</ul>
  );
}

const PersonIcon = ({ outline }: { outline?: boolean }) => (
  <svg className={`net-legend ${outline ? 'outline' : ''}`} viewBox="-8 -8 16 16" aria-hidden><path d="M0 -6.5a3.6 3.6 0 1 1 0 7.2a3.6 3.6 0 1 1 0-7.2ZM-6.5 7.5c.6-3.4 3.2-5.2 6.5-5.2s5.9 1.8 6.5 5.2Z" /></svg>
);
const ZoomIcon = (s: '+' | '-') => <svg viewBox="0 0 24 24" aria-hidden><circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 5 5M7.5 10.5h6" />{s === '+' && <path d="M10.5 7.5v6" />}</svg>;
