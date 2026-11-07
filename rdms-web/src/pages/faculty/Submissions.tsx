import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { DataTable, PageTitle, Panel, StatusBadge, Tabs } from '../../components/ui';
import type { Column } from '../../components/ui';
import { fmtDate } from '../../lib/analytics';
import { ENTITIES } from '../../lib/entities';
import { useStore } from '../../lib/store';
import type { AnyRecord, EntityKind, HistoryItem, Status } from '../../lib/types';
import { STATUS_LABEL } from '../../lib/types';
import { RecordDetail } from '../shared/RecordDetail';

const KINDS: EntityKind[] = ['publications', 'grants', 'seedMoney', 'fdps', 'conferences', 'awards', 'ipr'];
interface Row { key: string; kind: EntityKind | 'profile'; id: string; what: string; title: string; status: Status; updatedAt: string; comment: string }
const lastRemark = (h: HistoryItem[]) => [...h].reverse().find((x) => x.remark)?.remark ?? '';

/** Everything the faculty member has entered or proposed, with its approval status and the Office of Research's comments. */
export function MySubmissions() {
  const { db, user } = useStore();
  const me = user!.facultyId!;
  const [filter, setFilter] = useState<'open' | Status | 'all'>('open');
  const [open, setOpen] = useState<{ kind: EntityKind; id: string } | null>(null);
  const rows = useMemo<Row[]>(() => [
    ...KINDS.flatMap((k) => (db[k] as AnyRecord[]).filter((r) => r.facultyId === me).map((r) => ({
      key: `${k}:${r.id}`, kind: k, id: r.id, what: ENTITIES[k].label, title: ENTITIES[k].title(r), status: r.status, updatedAt: r.updatedAt,
      comment: r.status === 'Rework' || r.status === 'Rejected' ? lastRemark(r.history) : '',
    }))),
    ...db.profileChanges.filter((c) => c.facultyId === me).map((c) => ({
      key: `profile:${c.id}`, kind: 'profile' as const, id: c.id, what: 'Profile update', title: c.changed.join(', '), status: c.status, updatedAt: c.updatedAt,
      comment: c.status === 'Rework' || c.status === 'Rejected' ? lastRemark(c.history) : '',
    })),
  ].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), [db, me]);
  const count = (s: Status) => rows.filter((r) => r.status === s).length;
  const shown = rows.filter((r) => (filter === 'all' ? true : filter === 'open' ? r.status !== 'Approved' : r.status === filter));
  const cols: Column<Row>[] = [
    { key: 'what', label: 'Type', value: (r) => r.what },
    { key: 'id', label: 'ID', value: (r) => r.id },
    { key: 'title', label: 'Title / changes', value: (r) => r.title, className: 'title-cell' },
    { key: 'status', label: 'Status', value: (r) => STATUS_LABEL[r.status], render: (r) => <StatusBadge status={r.status} /> },
    { key: 'at', label: 'Last update', value: (r) => r.updatedAt, render: (r) => fmtDate(r.updatedAt) },
    { key: 'comment', label: 'Office of Research comment', value: (r) => r.comment, render: (r) => r.comment ? <i>{r.comment}</i> : <span className="muted">—</span> },
  ];
  return (
    <>
      <PageTitle>My Submissions</PageTitle>
      <Panel size="wide" actions={<Link className="btn sm" to="/biodata/edit">Update profile</Link>}>
        <Tabs value={filter} onChange={setFilter} tabs={[
          { id: 'open', label: `Needs attention or waiting (${rows.filter((r) => r.status !== 'Approved').length})` },
          { id: 'Draft', label: `Draft (${count('Draft')})` },
          { id: 'Submitted', label: `Pending Approval (${count('Submitted')})` },
          { id: 'Rework', label: `Returned for Correction (${count('Rework')})` },
          { id: 'Rejected', label: `Rejected (${count('Rejected')})` },
          { id: 'Approved', label: `Approved (${count('Approved')})` },
          { id: 'all', label: 'All' },
        ]} />
        <DataTable rows={shown} columns={cols} rowKey={(r) => r.key} exportName="my_submissions"
          onRowClick={(r) => (r.kind === 'profile' ? (window.location.hash = '#/biodata/edit') : setOpen({ kind: r.kind, id: r.id }))}
          empty="Nothing here." />
        <p className="note">New entries and profile updates become part of your verified research profile only after the Office of Research approves them. Rejected or returned submissions never replace approved information.</p>
      </Panel>
      {open && <RecordDetail kind={open.kind} id={open.id} onClose={() => setOpen(null)} />}
    </>
  );
}
