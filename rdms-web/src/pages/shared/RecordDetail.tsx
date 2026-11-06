import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Modal, StatusBadge, useToast } from '../../components/ui';
import { ENTITIES } from '../../lib/entities';
import { deleteRecord, isEditable, reloadData, saveRecord, useStore } from '../../lib/store';
import { Decide, GrantOutcome } from '../admin/Admin';
import { Field, NumberInput } from '../../components/ui';
import type { AnyRecord, EntityKind, Grant, SeedMoney } from '../../lib/types';
import { fmtDate } from '../../lib/analytics';

export function RecordDetail({ kind, id, onClose }: { kind: EntityKind; id: string; onClose: () => void }) {
  const { db, user } = useStore();
  const nav = useNavigate();
  const toast = useToast();
  const cfg = ENTITIES[kind];
  const r = (db[kind] as AnyRecord[]).find((x) => x.id === id);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [sanction, setSanction] = useState(r && kind === 'seedMoney' ? (r as SeedMoney).requestedAmount : 0);
  if (!r || !user) return null;
  const isOffice = user.role === 'office';
  const afterReview = () => { void reloadData(); window.dispatchEvent(new Event('rdms:approvals')); onClose(); };
  const owner = db.faculty.find((f) => f.id === r.facultyId);
  const isOwner = user.role === 'faculty' && user.facultyId === r.facultyId;

  const act = async (fn: () => Promise<unknown>, msg: string, close = true) => {
    if (busy) return;
    setBusy(true);
    try { await fn(); toast(msg); setError(''); if (close) onClose(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <Modal title={<>{cfg.label} {r.id} <span style={{ marginLeft: 8 }}><StatusBadge status={r.status} /></span></>} onClose={onClose}>
      {error && <Alert kind="error">{error}</Alert>}
      {r.status === 'Rework' && isOwner && (
        <Alert kind="info">Returned for correction by the Office of Research: <b>{[...r.history].reverse().find((h) => h.remark)?.remark}</b> Edit the entry and submit it again.</Alert>
      )}
      {r.status === 'Rejected' && isOwner && (
        <Alert kind="error">Rejected by the Office of Research: <b>{[...r.history].reverse().find((h) => h.remark)?.remark}</b></Alert>
      )}
      {r.status === 'Submitted' && isOwner && <Alert kind="info">Pending approval by the Office of Research. The entry is locked until it is reviewed.</Alert>}
      <dl className="kv">
        <dt>Entered by</dt><dd>{owner ? `${owner.title} ${owner.name} (${owner.id}), ${owner.department}` : r.facultyId}</dd>
        {cfg.details(r).map(([k, v]) => <div key={k} style={{ display: 'contents' }}><dt>{k}</dt><dd>{v}</dd></div>)}
      </dl>

      <h3 style={{ fontSize: 14, margin: '14px 0 4px' }}>History</h3>
      <ul className="history">
        {r.history.map((h, i) => <li key={i}><b>{fmtDate(h.at)}</b> · {h.action} by {h.by}{h.remark && <> — <i>{h.remark}</i></>}</li>)}
      </ul>

      {isOwner && (
        <div className="btn-row">
          {isEditable(r) && <button className="btn" onClick={() => nav(`${cfg.entryPath}?id=${r.id}`)}>Edit</button>}
          {isEditable(r) && <button className="btn ok" onClick={() => act(() => saveRecord(kind, r, true), `${cfg.label} ${r.id} submitted for approval.`)}>Submit for approval</button>}
          {r.status === 'Draft' && <button className="btn danger" onClick={() => confirm(`Delete draft ${r.id}?`) && act(() => deleteRecord(kind, r.id), `Draft ${r.id} deleted.`)}>Delete draft</button>}
        </div>
      )}

      {isOffice && r.status === 'Submitted' && (
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
