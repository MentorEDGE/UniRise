import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { DataTable, Field, Input, PageTitle, Panel, Select, Tabs } from '../../components/ui';
import { ENTITIES, listColumns } from '../../lib/entities';
import { creditedFaculty, useStore, visible } from '../../lib/store';
import { dateOf } from '../../lib/analytics';
import type { AnyRecord, EntityKind } from '../../lib/types';
import { STATUS_LABEL, STATUSES } from '../../lib/types';
import { RecordDetail } from './RecordDetail';
import { focusMatcher, RecordInsights } from '../../components/insights';
import type { Focus } from '../../components/insights';
import type { Conference } from '../../lib/types';

const ConferenceMap = lazy(() => import('../../components/ConferenceMap'));

const TITLES: Record<EntityKind, string> = {
  publications: 'Publication View', grants: 'Grant Entry/Update', seedMoney: 'Seed Money Status', fdps: 'Faculty Development Programmes', conferences: 'Conference Participation', awards: 'Honours & Awards', ipr: 'Intellectual Property',
};

export function RecordView({ kind }: { kind: EntityKind }) {
  const { db, user } = useStore();
  const [params] = useSearchParams();
  const cfg = ENTITIES[kind];
  const isFaculty = user?.role === 'faculty';
  const [scope, setScope] = useState<'mine' | 'all'>(isFaculty ? 'mine' : 'all');
  const empty = { type: '', id: '', status: params.get('status') ?? '', title: '', person: params.get('faculty') ?? '', dept: params.get('dept') ?? '', from: params.get('from') ?? '', to: params.get('to') ?? '', level: '' };
  const [form, setForm] = useState(empty);
  const [applied, setApplied] = useState(empty);
  const [openId, setOpenId] = useState<string | null>(null);
  const set = (k: keyof typeof empty) => (v: string) => setForm({ ...form, [k]: v });

  const rows = useMemo(() => {
    const byId = new Map(db.faculty.map((f) => [f.id, f]));
    let list = visible(kind) as AnyRecord[];
    if (isFaculty && scope === 'mine') list = list.filter((r) => creditedFaculty(kind, r).includes(user!.facultyId!));
    if (isFaculty && scope === 'all') list = list.filter((r) => r.status === 'Approved');
    const q = applied;
    return list.filter((r) => {
      const credited = creditedFaculty(kind, r).map((id) => byId.get(id)).filter(Boolean);
      if (q.type && cfg.typeOf(r) !== q.type) return false;
      if (q.id && !r.id.toLowerCase().includes(q.id.trim().toLowerCase())) return false;
      if (q.status && r.status !== q.status) return false;
      if (q.title && !cfg.title(r).toLowerCase().includes(q.title.trim().toLowerCase())) return false;
      if (q.person) {
        const s = q.person.trim().toLowerCase();
        if (!credited.some((f) => f!.id.toLowerCase() === s || f!.name.toLowerCase().includes(s))) return false;
      }
      if (q.dept && !credited.some((f) => f!.department === q.dept)) return false;
      if (q.level && kind === 'conferences' && ((r as Conference).level === 'International' ? 'International' : 'National') !== q.level) return false;
      const d = dateOf(kind, r);
      if (q.from && d < q.from) return false;
      if (q.to && d > q.to) return false;
      return true;
    }).sort((a, b) => dateOf(kind, b).localeCompare(dateOf(kind, a)));
  }, [db, kind, applied, scope, isFaculty, user, cfg]);

  // A bar clicked in the analytics narrows the table; a new search starts again from everything.
  const [focus, setFocus] = useState<Focus | null>(null);
  useEffect(() => setFocus(null), [applied, scope, kind]);
  const match = useMemo(() => focusMatcher(kind, db), [kind, db]);
  const tableRows = focus ? rows.filter((r) => match(r, focus)) : rows;

  const pendingMine = isFaculty ? (db[kind] as AnyRecord[]).filter((r) => r.facultyId === user!.facultyId && (r.status === 'Draft' || r.status === 'Rework')) : [];

  return (
    <>
      <PageTitle>{TITLES[kind]}</PageTitle>
      {isFaculty && pendingMine.length > 0 && (
        <Panel title="Entries Pending Action" boxed size="wide">
          <DataTable rows={pendingMine} columns={listColumns(db, kind, { showOwner: false })} rowKey={(r) => r.id} onRowClick={(r) => setOpenId(r.id)} pageSize={5} />
        </Panel>
      )}
      <Panel title="Search" size="wide" actions={isFaculty ? <Link className="btn sm" to={cfg.entryPath}>+ New {cfg.label} Entry</Link> : undefined}>
        {isFaculty && (
          <Tabs value={scope} onChange={setScope} tabs={[
            { id: 'mine', label: `My ${cfg.plural}` },
          ]} />
        )}
        <form className="grid" onSubmit={(e) => { e.preventDefault(); setApplied(form); }}>
          <Field label={kind === 'conferences' ? 'Participation' : kind === 'seedMoney' || kind === 'awards' ? 'Category' : kind === 'ipr' ? 'Type' : `${cfg.label} Entry Type`}>
            <Select value={form.type} onChange={set('type')} options={cfg.typeOptions} placeholder="ALL" />
          </Field>
          <Field label={`${cfg.label} ID`}><Input value={form.id} onChange={set('id')} /></Field>
          {(isFaculty || user?.role === 'office') && <Field label={`${cfg.label} Status`}><Select value={form.status} onChange={set('status')} options={STATUSES.map((x) => ({ value: x, label: STATUS_LABEL[x] }))} placeholder="ALL" /></Field>}
          <Field label="Title"><Input value={form.title} onChange={set('title')} /></Field>
          {(!isFaculty || scope === 'all') && <Field label="Author / Faculty" hint="Name or employee code"><Input value={form.person} onChange={set('person')} /></Field>}
          {(!isFaculty || scope === 'all') && <Field label="Department"><Select value={form.dept} onChange={set('dept')} options={db.settings.departments} placeholder="ALL" /></Field>}
          {kind === 'conferences' && <Field label="Conference type"><Select value={form.level} onChange={set('level')} options={['National', 'International']} placeholder="ALL" /></Field>}
          <Field label="From date"><input type="date" value={form.from} onChange={(e) => set('from')(e.target.value)} /></Field>
          <Field label="To date"><input type="date" value={form.to} onChange={(e) => set('to')(e.target.value)} /></Field>
          <div className="span4 btn-row" style={{ marginTop: 2 }}>
            <button className="btn" type="submit">Search</button>
            <button className="btn secondary" type="button" onClick={() => { setForm({ ...empty, status: '', person: '', dept: '', from: '', to: '', level: '' }); setApplied({ ...empty, status: '', person: '', dept: '', from: '', to: '', level: '' }); }}>Clear</button>
          </div>
        </form>
      </Panel>
      {kind === 'conferences'
        ? <Suspense fallback={<div className="panel wide insights"><p className="muted">Loading map…</p></div>}><ConferenceMap rows={rows as Conference[]} db={db} /></Suspense>
        : <RecordInsights key={kind} kind={kind} rows={rows} db={db} focus={focus} onFocus={setFocus} />}
      <Panel size="wide">
        <DataTable rows={tableRows} columns={listColumns(db, kind, { showOwner: !isFaculty || scope === 'all' })} rowKey={(r) => r.id}
          onRowClick={(r) => setOpenId(r.id)} exportName={cfg.plural} empty={`No ${cfg.plural.toLowerCase()} match the search.`} />
        <p className="note">{isFaculty ? 'Click a row to see the full details and the Office of Research’s comments, edit a draft or submit it for approval.' : user?.role === 'office' ? 'All entries, in every status. Review submissions under Approval.' : 'Approved entries only (verified by the Office of Research). Click a row to see the full details.'}</p>
      </Panel>
      {openId && <RecordDetail kind={kind} id={openId} onClose={() => setOpenId(null)} />}
    </>
  );
}
