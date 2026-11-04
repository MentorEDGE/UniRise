import { useSearchParams } from 'react-router-dom';
import { Field, Select } from '../../components/ui';
import { academicYearOf, academicYearRange, academicYears } from '../../lib/analytics';
import type { Filter } from '../../lib/analytics';
import { useStore } from '../../lib/store';

/** Academic year + department filter kept in the URL so views can be bookmarked and shared. */
export function useAnalyticsFilter(opts: { allowDept?: boolean } = { allowDept: true }) {
  const { db } = useStore();
  const [params, setParams] = useSearchParams();
  const sm = db.settings.academicYearStartMonth;
  const years = academicYears(db);
  const current = academicYearOf(new Date().toISOString().slice(0, 10), sm);
  const ay = params.get('ay') ?? current;
  const department = opts.allowDept === false ? '' : params.get('dept') ?? '';
  const range = ay === 'all' ? { from: '', to: '' } : academicYearRange(ay, sm);
  const filter: Filter = { ...range, department };
  const set = (k: string, v: string) => { const p = new URLSearchParams(params); if (v) p.set(k, v); else p.delete(k); setParams(p, { replace: true }); };
  const bar = (
    <div className="filters">
      <Field label="Academic Year">
        <Select value={ay} onChange={(v) => set('ay', v)} options={[...years.map((y) => ({ value: y, label: `AY ${y}${y === current ? ' (current)' : ''}` })), { value: 'all', label: 'All years' }]} />
      </Field>
      {opts.allowDept !== false && <Field label="Department"><Select value={department} onChange={(v) => set('dept', v)} options={db.settings.departments} placeholder="All departments" /></Field>}
      <span className="muted" style={{ paddingBottom: 6 }}>{ay === 'all' ? 'All recorded activity' : `${range.from.split('-').reverse().join('/')} to ${range.to.split('-').reverse().join('/')}`} · approved entries only</span>
    </div>
  );
  return { filter, ay, years, current, bar, department, isCurrent: ay === current };
}

