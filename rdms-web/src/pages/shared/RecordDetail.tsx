import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Field, Modal, NumberInput, Select, StatusBadge, TextArea, useToast } from '../../components/ui';
import { ENTITIES } from '../../lib/entities';
import { deleteRecord, isEditable, review, saveRecord, updateGrantOutcome, useStore } from '../../lib/store';
import type { Decision } from '../../lib/store';
import type { AnyRecord, EntityKind, Grant, SeedMoney } from '../../lib/types';
import { GRANT_OUTCOMES } from '../../lib/types';
import { fmtDate } from '../../lib/analytics';

export function RecordDetail({ kind, id, onClose }: { kind: EntityKind; id: string; onClose: () => void }) {
  const { db, user } = useStore();
  const nav = useNavigate();
  const toast = useToast();
  const cfg = ENTITIES[kind];
  const r = (db[kind] as AnyRecord[]).find((x) => x.id === id);
  const [remark, setRemark] = useState('');
  const [error, setError] = useState('');
  const [sanction, setSanction] = useState<number>(r && kind === 'seedMoney' ? (r as SeedMoney).requestedAmount : 0);
  const [outcome, setOutcome] = useState(() => {
    const g = r as Grant;
    return { outcome: g?.outcome ?? 'Applied', sanctionDate: g?.sanctionDate ?? '', sanctionedAmount: g?.sanctionedAmount ?? 0, receivedAmount: g?.receivedAmount ?? 0 };
  });
  if (!r || !user) return null;
  const owner = db.faculty.find((f) => f.id === r.facultyId);
  const isOwner = user.role === 'faculty' && user.facultyId === r.facultyId;
  const isMgmt = user.role === 'management';

  const [busy, setBusy] = useState(false);
  const act = async (fn: () => Promise<unknown>, msg: string, close = true) => {
    if (busy) return;
    setBusy(true);
    try { await fn(); toast(msg); setError(''); if (close) onClose(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const decide = (d: Decision) => act(() => review(kind, r.id, d, remark, kind === 'seedMoney' ? { sanctionedAmount: sanction } : undefined),
    d === 'Approved' ? `${cfg.label} ${r.id} approved.` : d === 'Rework' ? `${cfg.label} ${r.id} sent back for rework.` : `${cfg.label} ${r.id} rejected.`);

  return (
    <Modal title={<>{cfg.label} {r.id} <span style={{ marginLeft: 8 }}><StatusBadge status={r.status} /></span></>} onClose={onClose}>
      {error && <Alert kind="error">{error}</Alert>}
      {r.status === 'Rework' && isOwner && (
        <Alert kind="info">Sent back for rework: <b>{[...r.history].reverse().find((h) => h.remark)?.remark}</b> Edit the entry and submit it again.</Alert>
      )}
      <dl className="kv">
        <dt>Entered by</dt><dd>{owner ? `${owner.title} ${owner.name} (${owner.id}), ${owner.department}` : r.facultyId}</dd>
        {cfg.details(r).map(([k, v]) => <div key={k} style={{ display: 'contents' }}><dt>{k}</dt><dd>{v}</dd></div>)}
      </dl>

      <h3 style={{ fontSize: 12.5, margin: '14px 0 4px' }}>History</h3>
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

      {isMgmt && r.status === 'Submitted' && (
        <div className="panel" style={{ marginTop: 12, background: '#fff' }}>
          <h3 className="panel-title">Review</h3>
          {kind === 'seedMoney' && (
            <Field label="Sanctioned amount (₹)" hint={`Requested ₹${(r as SeedMoney).requestedAmount.toLocaleString('en-IN')}`}>
              <NumberInput value={sanction} onChange={setSanction} min={0} />
            </Field>
          )}
          <Field label="Remark" hint="Required when sending for rework or rejecting. The faculty member sees it.">
            <TextArea value={remark} onChange={setRemark} />
          </Field>
          <div className="btn-row">
            <button className="btn ok" onClick={() => decide('Approved')}>Approve</button>
            <button className="btn warn" onClick={() => decide('Rework')}>Send for rework</button>
            <button className="btn danger" onClick={() => decide('Rejected')}>Reject</button>
          </div>
        </div>
      )}

      {isMgmt && kind === 'grants' && r.status === 'Approved' && (
        <div className="panel" style={{ marginTop: 12, background: '#fff' }}>
          <h3 className="panel-title">Funding outcome</h3>
          <div className="grid">
            <Field label="Outcome"><Select value={outcome.outcome} onChange={(v) => setOutcome({ ...outcome, outcome: v as Grant['outcome'] })} options={GRANT_OUTCOMES} /></Field>
            <Field label="Sanction date"><input type="date" value={outcome.sanctionDate} onChange={(e) => setOutcome({ ...outcome, sanctionDate: e.target.value })} /></Field>
            <Field label="Sanctioned (₹)"><NumberInput value={outcome.sanctionedAmount} onChange={(v) => setOutcome({ ...outcome, sanctionedAmount: v })} min={0} /></Field>
            <Field label="Received (₹)"><NumberInput value={outcome.receivedAmount} onChange={(v) => setOutcome({ ...outcome, receivedAmount: v })} min={0} /></Field>
          </div>
          <div className="btn-row">
            <button className="btn" onClick={() => {
              if (outcome.receivedAmount > outcome.sanctionedAmount) { setError('Received amount cannot exceed the sanctioned amount.'); return; }
              act(() => updateGrantOutcome(r.id, outcome), 'Funding outcome saved.', false);
            }}>Save outcome</button>
          </div>
        </div>
      )}
    </Modal>
  );
}
