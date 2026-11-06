import { useMemo, useState } from 'react';
import { geoCentroid, geoMercator, geoPath } from 'd3-geo';
import type { Feature, FeatureCollection, Geometry } from 'geojson';
import { feature } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';
import world from 'world-atlas/countries-110m.json';
import type { DB } from '../lib/types';
import { outputsOf } from './network';

/**
 * Countries of the researcher's external collaborators over the last five years, from the country recorded with
 * each external co-author or co-investigator on approved outputs. Loaded on demand (the world outline is ~100 KB).
 */

const topo = world as unknown as Topology<{ countries: GeometryCollection<{ name: string }> }>;
const countries = (feature(topo, topo.objects.countries) as FeatureCollection<Geometry, { name: string }>).features.filter((c) => c.properties.name !== 'Antarctica');
/** Names used in entry forms that differ from the map's own names. */
const ALIAS: Record<string, string> = { 'United States': 'United States of America', USA: 'United States of America', UK: 'United Kingdom', 'South Korea': 'South Korea', UAE: 'United Arab Emirates' };
/** Small countries the 1:110m outline leaves out: [longitude, latitude]. */
const SMALL: Record<string, [number, number]> = { Singapore: [103.8, 1.35], 'Hong Kong': [114.17, 22.3], Bahrain: [50.55, 26.07], Malta: [14.4, 35.9], Mauritius: [57.55, -20.3], Maldives: [73.5, 4.2], Luxembourg: [6.13, 49.6] };

const W = 960, H = 560;
const projection = geoMercator().scale(142).translate([W / 2, H / 2 + 92]);
const path = geoPath(projection);

function pointOf(name: string): [number, number] | null {
  const n = ALIAS[name] ?? name;
  if (SMALL[n]) return projection(SMALL[n]);
  const f = countries.find((c) => c.properties.name.toLowerCase() === n.toLowerCase());
  if (!f) return null;
  // the main land mass of countries with distant territories
  const fix: Record<string, [number, number]> = { 'United States of America': [-98, 39], France: [2.4, 46.6], Norway: [9, 61], Russia: [90, 60], Canada: [-100, 57] };
  return projection(fix[f.properties.name] ?? geoCentroid(f as Feature));
}

/** facultyId: one researcher; facultyIds: several (the whole institution). */
export default function CollabMap({ db, facultyId, facultyIds }: { db: DB; facultyId?: string; facultyIds?: string[] }) {
  const [sel, setSel] = useState('');
  const thisYear = new Date().getFullYear();
  const byCountry = useMemo(() => {
    const ids = facultyIds ?? (facultyId ? [facultyId] : []);
    const seen = new Set<string>();
    const items: ReturnType<typeof outputsOf>['items'] = [];
    const people = new Map<string, ReturnType<typeof outputsOf>['people'] extends Map<string, infer P> ? P : never>();
    for (const id of ids) {
      const o = outputsOf(db, id);
      o.people.forEach((p, k) => people.set(k, p));
      for (const it of o.items) { const key = it.out.kind + it.out.id; if (!seen.has(key)) { seen.add(key); items.push(it); } }
    }
    const src = { items, people };
    const m = new Map<string, { outputs: Map<string, { title: string; year: number }>; institutions: Map<string, number>; people: Set<string> }>();
    for (const { out, who } of src.items) {
      if (out.year < thisYear - 4) continue;
      for (const k of who) {
        const p = src.people.get(k)!;
        if (p.type !== 'external' || !p.country) continue;
        const c = m.get(p.country) ?? { outputs: new Map(), institutions: new Map(), people: new Set() };
        c.outputs.set(out.kind + out.id, { title: out.title, year: out.year });
        if (p.institution) c.institutions.set(p.institution, (c.institutions.get(p.institution) ?? 0) + 1);
        c.people.add(p.name);
        m.set(p.country, c);
      }
    }
    return [...m].map(([country, v]) => ({ country, ...v, n: v.outputs.size, at: pointOf(country) })).sort((a, b) => b.n - a.n);
  }, [db, facultyId, facultyIds, thisYear]);
  const max = Math.max(1, ...byCountry.map((c) => c.n));
  const cur = byCountry.find((c) => c.country === sel);
  const unplaced = byCountry.filter((c) => !c.at);

  return (
    <div className="cmap">
      <p className="rp-sub">Recent external collaboration on country level ({thisYear - 4}–{thisYear}). Click a dot, or choose a country from the list.</p>
      <div className="cmap-wrap">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`World map of collaborating countries: ${byCountry.map((c) => `${c.country} ${c.n}`).join(', ') || 'none'}`}>
          {countries.map((c) => <path key={c.properties.name} d={path(c as Feature) ?? ''} className={`cmap-land ${byCountry.some((x) => (ALIAS[x.country] ?? x.country) === c.properties.name) ? 'has' : ''}`}><title>{c.properties.name}</title></path>)}
          {byCountry.filter((c) => c.at).map((c) => (
            <g key={c.country} className={`cmap-dot ${sel === c.country ? 'on' : ''}`} onClick={() => setSel(sel === c.country ? '' : c.country)} tabIndex={0} role="button" aria-label={`${c.country}: ${c.n} shared outputs`}
              onKeyDown={(e) => e.key === 'Enter' && setSel(c.country)}>
              <circle cx={c.at![0]} cy={c.at![1]} r={8 + (c.n / max) * 12} />
              <title>{`${c.country}: ${c.n} shared output${c.n > 1 ? 's' : ''}`}</title>
            </g>
          ))}
        </svg>
      </div>
      <div className="cmap-side">
        <label className="net-sel">Country
          <select value={sel} onChange={(e) => setSel(e.target.value)}>
            <option value="">Select a country…</option>
            {byCountry.map((c) => <option key={c.country} value={c.country}>{c.country} ({c.n})</option>)}
          </select>
        </label>
        {!byCountry.length && <p className="muted">No external collaborators with a recorded country in the last five years.</p>}
        {unplaced.length > 0 && <p className="muted">Not shown on the map: {unplaced.map((c) => c.country).join(', ')}.</p>}
        {cur && (
          <div className="cmap-detail">
            <h4>{cur.country} · {cur.n} shared output{cur.n > 1 ? 's' : ''}</h4>
            <p><b>Institutions:</b> {[...cur.institutions].map(([i, n]) => `${i} (${n})`).join(', ') || '—'}</p>
            <p><b>Collaborators:</b> {[...cur.people].join(', ')}</p>
            <ul>{[...cur.outputs.values()].sort((a, b) => b.year - a.year).map((o) => <li key={o.title + o.year}>{o.title} <span className="muted">· {o.year}</span></li>)}</ul>
          </div>
        )}
      </div>
    </div>
  );
}
