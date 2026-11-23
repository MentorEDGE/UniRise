import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { PageTitle } from '../../components/ui';
import { plural } from '../../lib/analytics';
import { ENTITIES } from '../../lib/entities';
import { useStore } from '../../lib/store';
import type { AnyRecord, EntityKind, HistoryItem, Status } from '../../lib/types';
import { ENTITY_LABEL, isResubmission } from '../../lib/types';
import { InstitutionAtAGlance } from '../mgmt/Dashboard';
import { Tile } from '../mgmt/Analytics';

const KINDS: EntityKind[] = ['publications', 'grants', 'seedMoney', 'fdps', 'conferences', 'awards', 'ipr'];
type QueueKind = EntityKind | 'profiles';
interface Waiting { key: string; kind: QueueKind; id: string; what: string; title: string; facultyId: string; status: Status; history: HistoryItem[]; updatedAt: string }

const days = (iso: string) => Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 86400000));
/** The Approvals tab that holds an item, so a link opens the right list. */
const viewOf = (s: Status) => (s === 'UnderReview' ? 'review' : s === 'Rework' ? 'returned' : 'awaiting');
const approvals = (view: string, kind?: QueueKind) => `/approvals?view=${view}${kind ? `&kind=${kind}` : ''}`;

/**
 * Office of Research home: what is waiting for the Office (new and resubmitted entries and profile updates, reviews
 * in progress, the oldest first), then the institution at a glance, the same figures Top-Level Management sees.
 */
export function OfficeDashboard() {
  const { db } = useStore();
  const items = useMemo<Waiting[]>(() => [
    ...KINDS.flatMap((k) => (db[k] as AnyRecord[]).filter((r) => r.status === 'Submitted' || r.status === 'UnderReview' || r.status === 'Rework').map((r) => ({
      key: `${k}:${r.id}`, kind: k, id: r.id, what: ENTITY_LABEL[k], title: ENTITIES[k].title(r), facultyId: r.facultyId, status: r.status, history: r.history, updatedAt: r.updatedAt,
    }))),
    ...db.profileChanges.filter((c) => c.status === 'Submitted' || c.status === 'UnderReview' || c.status === 'Rework').map((c) => ({
      key: `profile:${c.id}`, kind: 'profiles' as const, id: c.id, what: 'Profile update', title: c.changed.join(', '), facultyId: c.facultyId, status: c.status, history: c.history, updatedAt: c.updatedAt,
    })),
  ], [db]);
  const name = new Map(db.faculty.map((f) => [f.id, `${f.title} ${f.name}`]));
  const newOnes = items.filter((x) => x.status === 'Submitted');
  const inReview = items.filter((x) => x.status === 'UnderReview');
  // The entry tiles count entries only; profile updates have their own tile, so nothing is counted twice.
  const newEntries = newOnes.filter((x) => x.kind !== 'profiles');
  const reviewEntries = inReview.filter((x) => x.kind !== 'profiles');
  const resubmitted = newEntries.filter((x) => isResubmission(x.history)).length;
  const returned = items.filter((x) => x.status === 'Rework');
  const profiles = items.filter((x) => x.kind === 'profiles' && x.status !== 'Rework');
  // With the Office now: new, resubmitted and under review. Oldest first, as they should be taken.
  const withOffice = [...newOnes, ...inReview].sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
  const oldest = withOffice[0];
  const byKind = ([...KINDS, 'profiles'] as QueueKind[]).map((k) => ({
    k, label: k === 'profiles' ? 'Profile updates' : ENTITY_LABEL[k],
    fresh: newOnes.filter((x) => x.kind === k).length, review: inReview.filter((x) => x.kind === k).length,
  })).filter((r) => r.fresh + r.review);

  return (
    <>
      <PageTitle sub="What is waiting for the Office of Research, then the institution at a glance.">Dashboard</PageTitle>
      <div className="dash">
        <h2 className="dash-h">Waiting for you</h2>
        <div className="tiles">
          <Tile label="New and resubmitted" value={newEntries.length} sub={resubmitted ? `${resubmitted} resubmitted` : 'entries to start reviewing'} to={approvals('awaiting')} />
          <Tile label="Under review" value={reviewEntries.length} sub="entries opened, no decision yet" to={approvals('review')} />
          <Tile label="Profile updates" value={profiles.length} sub="waiting for approval" to={approvals('awaiting', 'profiles')} />
          <Tile label="Changes requested" value={returned.length} sub="with faculty to correct" to={approvals('returned')} />
          <Tile label="Oldest waiting" value={oldest ? `${days(oldest.updatedAt)} days` : '—'} sub={oldest ? `${oldest.id} · ${name.get(oldest.facultyId) ?? oldest.facultyId}` : 'nothing waiting'}
            to={oldest ? approvals(viewOf(oldest.status), oldest.kind) : undefined} />
        </div>

        <div className="dash-grid">
          <section className="card dash-queue" aria-label="Oldest first">
            <h3>Oldest first</h3>
            <p className="sub">{withOffice.length ? `${plural(withOffice.length, 'item')} with the Office of Research now` : 'Nothing is waiting for review.'}</p>
            {withOffice.length > 0 && (
              <ol>
                {withOffice.slice(0, 6).map((x) => (
                  <li key={x.key}>
                    <span className="q-main">
                      <b>{x.title || x.what}</b>
                      <small>{x.what} · {x.id} · {name.get(x.facultyId) ?? x.facultyId}{x.status === 'UnderReview' ? ' · under review' : isResubmission(x.history) ? ' · resubmitted' : ''}</small>
                    </span>
                    <span className="q-days">{plural(days(x.updatedAt), 'day')}</span>
                    <Link className="btn sm" to={approvals(viewOf(x.status), x.kind)}>Review</Link>
                  </li>
                ))}
              </ol>
            )}
            <Link className="more" to={approvals('awaiting')}>All approvals</Link>
          </section>
          <section className="card dash-kinds" aria-label="Waiting by type">
            <h3>By type</h3>
            <p className="sub">New and under review</p>
            {byKind.length ? (
              <table className="mini">
                <thead><tr><th scope="col">Type</th><th scope="col">New</th><th scope="col">In review</th></tr></thead>
                <tbody>
                  {byKind.map((r) => (
                    <tr key={r.k}>
                      <th scope="row"><Link to={approvals(r.fresh ? 'awaiting' : 'review', r.k)}>{r.label}</Link></th>
                      <td>{r.fresh}</td><td>{r.review}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <p className="muted">All caught up.</p>}
          </section>
        </div>

        <h2 className="dash-h">Institution at a glance</h2>
      </div>
      <InstitutionAtAGlance />
    </>
  );
}
