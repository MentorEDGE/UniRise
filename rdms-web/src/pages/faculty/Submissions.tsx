import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { DataTable, PageTitle, Panel, StatusBadge, Tabs } from '../../components/ui';
import type { Column } from '../../components/ui';
import { fmtDate, plural } from '../../lib/analytics';
import { ENTITIES } from '../../lib/entities';
import { useStore } from '../../lib/store';
import type { AnyRecord, EntityKind, HistoryItem, Status } from '../../lib/types';
import { DECISION_ACTIONS, isAwaitingOffice, isResubmission, statusLabel } from '../../lib/types';
import { RecordDetail } from '../shared/RecordDetail';

const KINDS: EntityKind[] = ['publications', 'grants', 'seedMoney', 'fdps', 'conferences', 'awards', 'ipr'];
interface Row { key: string; kind: EntityKind | 'profile'; id: string; what: string; title: string; status: Status; history: HistoryItem[]; updatedAt: string; comment: string }
/** The Office of Research's latest comment (never the faculty member's own reply). */
const lastRemark = (h: HistoryItem[]) => [...h].reverse().find((x) => x.remark && DECISION_ACTIONS.includes(x.action))?.remark ?? '';
type Filter = 'open' | 'Draft' | 'waiting' | 'UnderReview' | 'Rework' | 'Approved' | 'Rejected' | 'all';

/** Everything the faculty member has entered or proposed, with its approval status and the Office of Research's comments. */
export function MySubmissions() {
  const { db, user } = useStore();
  const me = user!.facultyId!;
  const [chosen, setFilter] = useState<Filter | null>(null);
  const [open, setOpen] = useState<{ kind: EntityKind; id: string } | null>(null);
  const rows = useMemo<Row[]>(() => [
    ...KINDS.flatMap((k) => (db[k] as AnyRecord[]).filter((r) => r.facultyId === me).map((r) => ({
      key: `${k}:${r.id}`, kind: k, id: r.id, what: ENTITIES[k].label, title: ENTITIES[k].title(r), status: r.status, history: r.history, updatedAt: r.updatedAt,
      comment: lastRemark(r.history),
    }))),
    ...db.profileChanges.filter((c) => c.facultyId === me).map((c) => ({
      key: `profile:${c.id}`, kind: 'profile' as const, id: c.id, what: 'Profile update', title: c.changed.join(', '), status: c.status, history: c.history, updatedAt: c.updatedAt,
      comment: lastRemark(c.history),
    })),
  ].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), [db, me]);
  const test: Record<Filter, (r: Row) => boolean> = {
    open: (r) => r.status === 'Rework' || r.status === 'Draft', Draft: (r) => r.status === 'Draft', waiting: (r) => r.status === 'Submitted',
    UnderReview: (r) => r.status === 'UnderReview', Rework: (r) => r.status === 'Rework', Approved: (r) => r.status === 'Approved', Rejected: (r) => r.status === 'Rejected', all: () => true,
  };
  const count = (f: Filter) => rows.filter(test[f]).length;
  // Open on the first tab with something in it: what needs action, then what is with the Office of Research.
  const filter: Filter = chosen ?? (['open', 'UnderReview', 'waiting'] as Filter[]).find((f) => count(f) > 0) ?? 'all';
  const shown = rows.filter(test[filter]);
  const withOffice = rows.filter((r) => isAwaitingOffice(r.status)).length;
  const resubmitted = rows.filter((r) => r.status === 'Submitted' && isResubmission(r.history)).length;
  const cols: Column<Row>[] = [
    { key: 'what', label: 'Type', value: (r) => r.what },
    { key: 'id', label: 'ID', value: (r) => r.id },
    { key: 'title', label: 'Title / changes', value: (r) => r.title, className: 'title-cell' },
    { key: 'status', label: 'Status', value: (r) => statusLabel(r), render: (r) => <StatusBadge status={r.status} history={r.history} /> },
    { key: 'at', label: 'Last update', value: (r) => r.updatedAt, render: (r) => fmtDate(r.updatedAt) },
    { key: 'comment', label: 'Latest comment from the Office of Research', value: (r) => r.comment, render: (r) => r.comment ? <i>{r.comment}</i> : <span className="muted">—</span> },
  ];
  return (
    <>
      <PageTitle sub="Track every entry and profile update you have sent to the Office of Research, with its status and comments.">My Submissions</PageTitle>
      <Panel size="wide" actions={<Link className="btn sm" to="/biodata/edit">Update profile</Link>}>
        <Tabs value={filter} onChange={setFilter} tabs={[
          { id: 'open', label: `Needs your action (${count('open')})` },
          { id: 'waiting', label: `Submitted (${count('waiting')})` },
          { id: 'UnderReview', label: `Under Review (${count('UnderReview')})` },
          { id: 'Rework', label: `Changes Requested (${count('Rework')})` },
          { id: 'Approved', label: `Approved (${count('Approved')})` },
          { id: 'Rejected', label: `Rejected (${count('Rejected')})` },
          { id: 'Draft', label: `Draft (${count('Draft')})` },
          { id: 'all', label: `All (${rows.length})` },
        ]} />
        <p className="muted" style={{ margin: '0 0 10px' }}>
          {filter === 'open' ? 'Drafts to finish, and entries the Office of Research has asked you to change. Open one to read the comment, correct it and resubmit it.'
            : filter === 'waiting' ? `Sent to the Office of Research and waiting to be opened${resubmitted ? `, including ${plural(resubmitted, 'resubmission')}` : ''}.`
            : filter === 'UnderReview' ? 'The Office of Research is reviewing these. They are locked until a decision is made.'
            : 'Open any entry to see its progress and your conversation with the Office of Research.'}
          {withOffice > 0 && filter !== 'waiting' && filter !== 'UnderReview' && <> {plural(withOffice, 'entry', 'entries')} {withOffice === 1 ? 'is' : 'are'} with the Office of Research now.</>}
        </p>
        <DataTable rows={shown} columns={cols} rowKey={(r) => r.key} exportName="my_submissions"
          onRowClick={(r) => (r.kind === 'profile' ? (window.location.hash = '#/biodata/edit') : setOpen({ kind: r.kind, id: r.id }))}
          empty={filter === 'open' ? 'Nothing needs your action. Everything you have submitted is either approved or with the Office of Research.' : filter === 'Rejected' ? 'None of your entries has been rejected.' : 'No entries here yet.'} />
        <p className="note">New entries and profile updates become part of your verified research profile only after the Office of Research approves them. Rejected or returned submissions never replace approved information.</p>
      </Panel>
      {open && <RecordDetail kind={open.kind} id={open.id} onClose={() => setOpen(null)} />}
    </>
  );
}
