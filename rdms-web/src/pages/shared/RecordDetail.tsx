import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Modal, StatusBadge, TextArea, useToast } from '../../components/ui';
import { Conversation, ProgressTracker } from '../../components/workflow';
import { ENTITIES } from '../../lib/entities';
import { adminApi, deleteRecord, isEditable, reloadData, saveRecord, useStore } from '../../lib/store';
import { Decide, GrantOutcome } from '../admin/Admin';
import { Field, NumberInput } from '../../components/ui';
import type { AnyRecord, EntityKind, Grant, SeedMoney } from '../../lib/types';
import { isAwaitingOffice } from '../../lib/types';

const lastRemark = (r: AnyRecord) => [...r.history].reverse().find((h) => h.remark && (h.action === 'Returned for correction' || h.action === 'Sent for rework' || h.action === 'Rejected'))?.remark;

export function RecordDetail({ kind, id, onClose }: { kind: EntityKind; id: string; onClose: () => void }) {
  const { db, user } = useStore();
  const nav = useNavigate();
  const toast = useToast();
  const cfg = ENTITIES[kind];
  const r = (db[kind] as AnyRecord[]).find((x) => x.id === id);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState('');
  const [sanction, setSanction] = useState(r && kind === 'seedMoney' ? (r as SeedMoney).requestedAmount : 0);
  const isOffice = user?.role === 'office';
  // The Office of Research opening a submitted entry starts its review, so the faculty member sees "Under Review".
  useEffect(() => {
    if (isOffice && r?.status === 'Submitted') adminApi('POST', `/office/approvals/${kind}/${encodeURIComponent(r.id)}/start`).then(() => reloadData()).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOffice, kind, id]);
  if (!r || !user) return null;
  const afterReview = () => { void reloadData(); window.dispatchEvent(new Event('rdms:approvals')); onClose(); };
  const owner = db.faculty.find((f) => f.id === r.facultyId);
  const isOwner = user.role === 'faculty' && user.facultyId === r.facultyId;
  const showWorkflow = isOwner || isOffice; // management never sees the review conversation

  const act = async (fn: () => Promise<unknown>, msg: string, close = true) => {
    if (busy) return;
    setBusy(true);
    try { await fn(); toast(msg); setError(''); if (close) onClose(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <Modal title={<>{cfg.label} {r.id} <span style={{ marginLeft: 8 }}><StatusBadge status={r.status} history={r.history} /></span></>} onClose={onClose}>
      {error && <Alert kind="error">{error}</Alert>}
      {showWorkflow && <ProgressTracker status={r.status} history={r.history} />}
      {r.status === 'Rework' && isOwner && (
        <Alert kind="info">Changes requested by the Office of Research: <b>{lastRemark(r)}</b> Edit the entry, or reply below, and resubmit it.</Alert>
      )}
      {r.status === 'Rejected' && isOwner && (
        <Alert kind="error">Rejected by the Office of Research: <b>{lastRemark(r)}</b></Alert>
      )}
      {isAwaitingOffice(r.status) && isOwner && <Alert kind="info">{r.status === 'UnderReview' ? 'The Office of Research is reviewing this entry.' : 'Waiting for the Office of Research to review it.'} The entry is locked until a decision is made.</Alert>}
      <dl className="kv">
        <dt>Entered by</dt><dd>{owner ? `${owner.title} ${owner.name} (${owner.id}), ${owner.department}` : r.facultyId}</dd>
        {cfg.details(r).map(([k, v]) => <div key={k} style={{ display: 'contents' }}><dt>{k}</dt><dd>{v}</dd></div>)}
      </dl>

      {showWorkflow && <Conversation history={r.history} />}

      {isOwner && (
        <>
          {r.status === 'Rework' && <Field label="Reply to the Office of Research (optional)" hint="Sent with your resubmission, e.g. what you corrected."><TextArea value={reply} onChange={setReply} /></Field>}
          <div className="btn-row">
            {isEditable(r) && <button className="btn" onClick={() => nav(`${cfg.entryPath}?id=${r.id}`)}>Edit</button>}
            {isEditable(r) && <button className="btn ok" disabled={busy} onClick={() => act(() => saveRecord(kind, r, true, reply), r.status === 'Rework' ? `${cfg.label} ${r.id} resubmitted.` : `${cfg.label} ${r.id} submitted for approval.`)}>{r.status === 'Rework' ? 'Resubmit for approval' : 'Submit for approval'}</button>}
            {r.status === 'Draft' && <button className="btn danger" onClick={() => confirm(`Delete draft ${r.id}?`) && act(() => deleteRecord(kind, r.id), `Draft ${r.id} deleted.`)}>Delete draft</button>}
          </div>
        </>
      )}

      {isOffice && isAwaitingOffice(r.status) && (
        <div className="panel" style={{ marginTop: 12 }}>
          <h3 className="panel-title">Review</h3>
          {kind === 'seedMoney' && (
            <Field label="Sanctioned amount (₹)" hint={`Requested ₹${(r as SeedMoney).requestedAmount.toLocaleString('en-IN')}`}><NumberInput value={sanction} onChange={setSanction} min={0} /></Field>
          )}
          <Decide path={`/office/approvals/${kind}/${encodeURIComponent(r.id)}/review`} label={`${cfg.label} ${r.id}`} extra={() => (kind === 'seedMoney' ? { sanctionedAmount: sanction } : {})} onDone={afterReview} />
        </div>
      )}
      {isOffice && kind === 'grants' && r.status === 'Approved' && <GrantOutcome path={`/office/approvals/grants/${encodeURIComponent(r.id)}/outcome`} g={r as Grant} onDone={afterReview} />}
    </Modal>
  );
}
