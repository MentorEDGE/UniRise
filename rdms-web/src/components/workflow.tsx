import { fmtDate } from '../lib/analytics';
import type { HistoryItem, Status } from '../lib/types';
import { DECISION_ACTIONS } from '../lib/types';

/**
 * The review workflow as seen by the faculty member and the Office of Research: a progress tracker and the
 * conversation between them. Never shown to Top-Level Management (their data has no review history).
 */

interface Step { label: string; at?: string; state: 'done' | 'current' | 'todo' | 'bad' | 'warn' }

/** Steps already taken, read from the record's history, then the steps still to come. */
export function workflowSteps(status: Status, history: HistoryItem[]): Step[] {
  const steps: Step[] = [];
  for (const h of history) {
    const label = h.action === 'Submitted' ? 'Submitted'
      : h.action === 'Resubmitted' ? 'Resubmitted'
      : h.action === 'Review started' ? 'Under Review'
      : h.action === 'Returned for correction' || h.action === 'Sent for rework' ? 'Changes Requested'
      : h.action === 'Approved' ? 'Approved'
      : h.action === 'Rejected' ? 'Rejected' : '';
    if (!label) continue;
    // Records reviewed before "Under Review" existed go straight from Submitted to a decision; show the review step.
    if (DECISION_ACTIONS.includes(h.action) && steps[steps.length - 1]?.label !== 'Under Review') steps.push({ label: 'Under Review', at: h.at, state: 'done' });
    steps.push({ label, at: h.at, state: label === 'Rejected' ? 'bad' : label === 'Changes Requested' ? 'warn' : 'done' });
  }
  const last = steps[steps.length - 1];
  if (status === 'Draft') return [{ label: 'Draft', state: 'current' }, { label: 'Submitted', state: 'todo' }, { label: 'Under Review', state: 'todo' }, { label: 'Approved', state: 'todo' }];
  if (last) last.state = status === 'Approved' ? 'done' : status === 'Rejected' ? 'bad' : status === 'Rework' ? 'warn' : 'current';
  if (status === 'Submitted') steps.push({ label: 'Under Review', state: 'todo' }, { label: 'Approved', state: 'todo' });
  if (status === 'UnderReview') steps.push({ label: 'Decision', state: 'todo' });
  if (status === 'Rework') steps.push({ label: 'Resubmitted', state: 'todo' }, { label: 'Under Review', state: 'todo' }, { label: 'Approved', state: 'todo' });
  return steps;
}

/** Submitted → Under Review → Approved, with every return and resubmission in between. */
export function ProgressTracker({ status, history }: { status: Status; history: HistoryItem[] }) {
  const steps = workflowSteps(status, history);
  const done = status === 'Approved' || status === 'Rejected';
  let cur = -1;
  steps.forEach((s, i) => { if (s.state !== 'todo') cur = i; });
  return (
    <ol className="wf-track" aria-label="Submission progress">
      {steps.map((s, i) => (
        <li key={i} className={`wf-step ${s.state}`} aria-current={!done && i === cur ? 'step' : undefined}>
          <span className="wf-dot" aria-hidden>{s.state === 'done' ? '✓' : s.state === 'bad' ? '✕' : s.state === 'warn' ? '!' : i + 1}</span>
          <span className="wf-label">{s.label}{s.at && <small>{fmtDate(s.at)}</small>}</span>
        </li>
      ))}
    </ol>
  );
}

const SAYS: Record<string, string> = {
  Created: 'created the entry', Edited: 'edited the entry', Submitted: 'submitted it for approval', Resubmitted: 'corrected and resubmitted it',
  'Review started': 'started the review', 'Returned for correction': 'requested changes', 'Sent for rework': 'requested changes', Approved: 'approved it', Rejected: 'rejected it',
};

/**
 * The complete record of the review: every step, with the Office of Research's comments and the faculty member's
 * replies shown as messages.
 */
export function Conversation({ history }: { history: HistoryItem[] }) {
  // Successive edits of a draft add nothing to the conversation.
  const items = history.filter((h, i) => !(h.action === 'Edited' && !h.remark && history[i + 1]?.action !== 'Resubmitted' && history[i + 1]?.action !== 'Submitted'));
  return (
    <div className="wf-convo">
      <h3>Status and communication history</h3>
      <ol>
        {items.map((h, i) => {
          const fromOffice = DECISION_ACTIONS.includes(h.action) || h.action === 'Review started' || h.action.startsWith('Outcome');
          return (
            <li key={i} className={`wf-msg ${fromOffice ? 'office' : 'faculty'} ${h.action === 'Rejected' ? 'bad' : h.action === 'Returned for correction' || h.action === 'Sent for rework' ? 'warn' : h.action === 'Approved' ? 'ok' : ''}`}>
              <div className="wf-meta"><b>{fromOffice && h.by !== 'Office of Research' ? `Office of Research · ${h.by}` : h.by}</b> {SAYS[h.action] ?? h.action.toLowerCase()} <time dateTime={h.at}>{fmtDate(h.at)}</time></div>
              {h.remark && <p className="wf-text">{h.remark}</p>}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
