import { useMemo, useRef, useState } from 'react';
import { geoCentroid, geoMercator, geoPath } from 'd3-geo';
import type { Feature, FeatureCollection, Geometry } from 'geojson';
import { feature } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';
import world from 'world-atlas/countries-110m.json';
import { fmtDate } from '../lib/analytics';
import type { Conference, DB } from '../lib/types';

/**
 * Interactive map of conferences, between Search and the conference table. Each marker sits at the venue recorded on
 * the entry: the city when it is a known city, otherwise the country (marked as country-level). Coordinates are the
 * real positions of those places; nothing is invented. Zoom with the buttons or the mouse wheel, drag to pan.
 */

const topo = world as unknown as Topology<{ countries: GeometryCollection<{ name: string }> }>;
const countries = (feature(topo, topo.objects.countries) as FeatureCollection<Geometry, { name: string }>).features.filter((c) => c.properties.name !== 'Antarctica');
/** Real coordinates [longitude, latitude] of cities that appear as conference venues. */
const CITY: Record<string, [number, number]> = {
  Bengaluru: [77.59, 12.97], Bangalore: [77.59, 12.97], Chennai: [80.27, 13.08], Mumbai: [72.88, 19.08], Hyderabad: [78.49, 17.39], Pune: [73.86, 18.52],
  'New Delhi': [77.21, 28.61], Delhi: [77.21, 28.61], Kochi: [76.27, 9.93], Mangaluru: [74.86, 12.91], Mangalore: [74.86, 12.91], Kolkata: [88.36, 22.57],
  Ahmedabad: [72.57, 23.02], Jaipur: [75.79, 26.91], Lucknow: [80.95, 26.85], Bhubaneswar: [85.82, 20.3], Thiruvananthapuram: [76.94, 8.52], Coimbatore: [76.96, 11.02],
  Mysuru: [76.64, 12.3], Manipal: [74.79, 13.35], Surathkal: [74.79, 13.01], Goa: [74.12, 15.3], Chandigarh: [76.78, 30.73], Guwahati: [91.74, 26.14], Indore: [75.86, 22.72],
  Singapore: [103.82, 1.35], 'Kuala Lumpur': [101.69, 3.14], London: [-0.13, 51.51], Berlin: [13.4, 52.52], Munich: [11.58, 48.14], Paris: [2.35, 48.86], Tokyo: [139.69, 35.69],
  Sydney: [151.21, -33.87], Melbourne: [144.96, -37.81], Dubai: [55.27, 25.2], 'New York': [-74.01, 40.71], Boston: [-71.06, 42.36], 'San Francisco': [-122.42, 37.77], Toronto: [-79.38, 43.65],
  Hong: [114.17, 22.3], 'Hong Kong': [114.17, 22.3], Seoul: [126.98, 37.57], Bangkok: [100.5, 13.76], Colombo: [79.86, 6.93], Kathmandu: [85.32, 27.72],
};
const SMALL: Record<string, [number, number]> = { Singapore: [103.82, 1.35], 'Hong Kong': [114.17, 22.3], Malta: [14.4, 35.9], Bahrain: [50.55, 26.07] };
const ALIAS: Record<string, string> = { 'United States': 'United States of America', USA: 'United States of America', UK: 'United Kingdom' };
const FIX: Record<string, [number, number]> = { 'United States of America': [-98, 39], France: [2.4, 46.6], Norway: [9, 61], Russia: [90, 60], Canada: [-100, 57], Malaysia: [101.7, 3.9] };

function locate(c: Conference): { key: string; place: string; at: [number, number]; exact: boolean } | null {
  const city = (c.venue || '').trim();
  const country = (c.country || '').trim();
  if (CITY[city]) return { key: `${city}|${country}`, place: city === country || !country ? city : `${city}, ${country}`, at: CITY[city], exact: true };
  const n = ALIAS[country] ?? country;
  if (SMALL[n]) return { key: `|${n}`, place: n, at: SMALL[n], exact: true };
  const f = countries.find((x) => x.properties.name.toLowerCase() === n.toLowerCase());
  if (!f) return null;
  return { key: `|${n}`, place: country, at: FIX[f.properties.name] ?? (geoCentroid(f as Feature) as [number, number]), exact: false };
}

const W = 960, H = 520;
const projection = geoMercator().scale(150).translate([W / 2, H / 2 + 100]);
const path = geoPath(projection);
const INDIA_VIEW = (() => { const [x0, y0] = projection([67, 37])!; const [x1, y1] = projection([98, 6])!; const k = Math.min(W / (x1 - x0), H / (y1 - y0)) * 0.9; return { k, x: W / 2 - ((x0 + x1) / 2) * k, y: H / 2 - ((y0 + y1) / 2) * k }; })();
const WORLD_VIEW = { k: 1, x: 0, y: 0 };

export default function ConferenceMap({ rows, db }: { rows: Conference[]; db: DB }) {
  const byId = useMemo(() => new Map(db.faculty.map((f) => [f.id, f])), [db]);
  const [view, setView] = useState(INDIA_VIEW);
  const [sel, setSel] = useState<string | null>(null);
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const places = useMemo(() => {
    const m = new Map<string, { key: string; place: string; at: [number, number]; exact: boolean; items: Conference[] }>();
    let unplaced = 0;
    for (const c of rows) {
      const l = locate(c);
      if (!l) { unplaced++; continue; }
      const p = m.get(l.key) ?? { ...l, items: [] };
      p.items.push(c); m.set(l.key, p);
    }
    return { list: [...m.values()].sort((a, b) => b.items.length - a.items.length), unplaced };
  }, [rows]);
  const national = rows.filter((c) => c.level !== 'International').length;
  const international = rows.length - national;
  const max = Math.max(1, ...places.list.map((p) => p.items.length));
  const cur = places.list.find((p) => p.key === sel);

  const toSvg = (e: { clientX: number; clientY: number }) => { const r = svgRef.current!.getBoundingClientRect(); return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H }; };
  const zoomAt = (factor: number, cx = W / 2, cy = H / 2) => setView((v) => { const k = Math.max(0.8, Math.min(14, v.k * factor)); const f = k / v.k; return { k, x: cx - (cx - v.x) * f, y: cy - (cy - v.y) * f }; });

  return (
    <section className="panel wide insights" aria-label="Conference map">
      <div className="ins-stats">
        <div><span>Total conferences</span><b>{rows.length}</b></div>
        <div><span><i className="cm-dot nat" /> National</span><b>{national}</b></div>
        <div><span><i className="cm-dot int" /> International</span><b>{international}</b></div>
        <div><span>Places</span><b>{places.list.length}</b></div>
      </div>
      <div className="ins-bar">
        <div className="net-seg" role="group" aria-label="Map view">
          <button type="button" className={view === INDIA_VIEW ? 'on' : ''} onClick={() => setView(INDIA_VIEW)}>India</button>
          <button type="button" className={view === WORLD_VIEW ? 'on' : ''} onClick={() => setView(WORLD_VIEW)}>World</button>
        </div>
        <div className="net-tools inline">
          <button type="button" onClick={() => zoomAt(1.4)} aria-label="Zoom in">+</button>
          <button type="button" onClick={() => zoomAt(1 / 1.4)} aria-label="Zoom out">−</button>
        </div>
        <span className="muted">Scroll to zoom, drag to move. Click a marker for the conferences held there.</span>
      </div>
      <div className="cm-wrap">
        <svg ref={svgRef} className="cm-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Conference locations: ${national} national, ${international} international`}
          onWheel={(e) => { const p = toSvg(e); zoomAt(e.deltaY < 0 ? 1.2 : 1 / 1.2, p.x, p.y); }}
          onPointerDown={(e) => { (e.target as Element).setPointerCapture?.(e.pointerId); const p = toSvg(e); drag.current = { x: p.x, y: p.y, vx: view.x, vy: view.y }; }}
          onPointerMove={(e) => { if (!drag.current) return; const p = toSvg(e); const d = drag.current; setView((v) => ({ ...v, x: d.vx + p.x - d.x, y: d.vy + p.y - d.y })); }}
          onPointerUp={() => { drag.current = null; }} onPointerLeave={() => { drag.current = null; }}>
          <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
            {countries.map((c) => <path key={c.properties.name} d={path(c as Feature) ?? ''} className={`cmap-land ${c.properties.name === 'India' ? 'has' : ''}`} strokeWidth={0.5 / view.k} />)}
            {places.list.map((p) => {
              const [x, y] = projection(p.at)!;
              const nat = p.items.filter((c) => c.level !== 'International').length;
              const kind = nat === p.items.length ? 'nat' : nat === 0 ? 'int' : 'mix';
              const r = (6 + (p.items.length / max) * 10) / Math.sqrt(view.k);
              return (
                <g key={p.key} className={`cm-marker ${kind} ${sel === p.key ? 'on' : ''}`} transform={`translate(${x} ${y})`} onPointerDown={(e) => e.stopPropagation()} onClick={() => setSel(sel === p.key ? null : p.key)}
                  tabIndex={0} role="button" aria-label={`${p.place}: ${p.items.length} conferences`} onKeyDown={(e) => e.key === 'Enter' && setSel(p.key)}>
                  {kind === 'int' ? <rect x={-r} y={-r} width={r * 2} height={r * 2} rx={r * 0.35} strokeWidth={1.5 / Math.sqrt(view.k)} /> : <circle r={r} strokeWidth={1.5 / Math.sqrt(view.k)} />}
                  <text y={r * 0.38} textAnchor="middle" style={{ fontSize: `${11 / Math.sqrt(view.k)}px` }}>{p.items.length}</text>
                  <title>{`${p.place}: ${p.items.length} conference${p.items.length > 1 ? 's' : ''}`}</title>
                </g>
              );
            })}
          </g>
        </svg>
        <ul className="cm-legend">
          <li><i className="cm-dot nat" />National (circle)</li><li><i className="cm-dot int sq" />International (square)</li><li><i className="cm-dot mix" />Both</li>
        </ul>
      </div>
      {cur ? (
        <div className="cm-detail">
          <h4>{cur.place} · {cur.items.length} conference{cur.items.length > 1 ? 's' : ''}{!cur.exact && <span className="muted"> (placed at the country; no city recorded)</span>}</h4>
          <div className="tbl-wrap">
            <table className="tbl"><thead><tr><th>Conference</th><th>Date</th><th>Faculty</th><th>Participation</th><th>Level</th></tr></thead>
              <tbody>{[...cur.items].sort((a, b) => b.fromDate.localeCompare(a.fromDate)).map((c) => (
                <tr key={c.id}><td className="title-cell">{c.conferenceName}{c.paperTitle && <div className="muted">“{c.paperTitle}”</div>}</td><td>{fmtDate(c.fromDate)}</td><td>{byId.get(c.facultyId) ? `${byId.get(c.facultyId)!.title} ${byId.get(c.facultyId)!.name}` : c.facultyId}</td><td>{c.participation}</td><td>{c.level}</td></tr>
              ))}</tbody></table>
          </div>
        </div>
      ) : <p className="ins-note">{rows.length ? `Showing the ${rows.length} conferences listed below.` : 'No conferences match the search.'}{places.unplaced ? ` ${places.unplaced} could not be placed (no recognisable city or country).` : ''}</p>}
    </section>
  );
}
