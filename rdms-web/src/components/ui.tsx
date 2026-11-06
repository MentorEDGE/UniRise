import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { Status } from '../lib/types';
import { STATUS_LABEL } from '../lib/types';
import { downloadCsv } from '../lib/csv';

export function PageTitle({ children }: { children: ReactNode }) {
  useEffect(() => { if (typeof children === 'string') document.title = `${children} · RDMS`; }, [children]);
  return <h1 className="page-title">{children}</h1>;
}

export function Panel({ title, children, size, boxed, actions }: { title?: ReactNode; children: ReactNode; size?: 'wide' | 'full'; boxed?: boolean; actions?: ReactNode }) {
  return (
    <section className={`panel ${size ?? ''}`}>
      {(title || actions) && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          {title ? <h2 className={`panel-title ${boxed ? 'boxed' : ''}`}>{title}</h2> : <span />}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function Field({ label, required, hint, error, className, children }: { label: string; required?: boolean; hint?: string; error?: string; className?: string; children: ReactNode }) {
  return (
    <div className={`field ${className ?? ''}`}>
      <label>{label}{required && <span className="req"> *</span>}</label>
      {children}
      {hint && <span className="hint">{hint}</span>}
      {error && <span className="err" role="alert">{error}</span>}
    </div>
  );
}

type InputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> & { value: string | number; onChange: (v: string) => void };
export function Input({ value, onChange, ...rest }: InputProps) {
  return <input type="text" {...rest} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />;
}
export function NumberInput({ value, onChange, ...rest }: Omit<InputProps, 'value' | 'onChange'> & { value: number; onChange: (v: number) => void }) {
  return <input type="number" {...rest} value={Number.isFinite(value) ? value : ''} onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))} />;
}
export function TextArea({ value, onChange, ...rest }: Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'onChange' | 'value'> & { value: string; onChange: (v: string) => void }) {
  return <textarea {...rest} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />;
}
export function Select({ value, onChange, options, placeholder, ...rest }: Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'onChange' | 'value'> & {
  value: string; onChange: (v: string) => void; options: readonly (string | { value: string; label: string })[]; placeholder?: string;
}) {
  return (
    <select {...rest} value={value} onChange={(e) => onChange(e.target.value)}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => typeof o === 'string' ? <option key={o} value={o}>{o}</option> : <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}
export function YesNo({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return <select value={value ? 'Yes' : 'No'} onChange={(e) => onChange(e.target.value === 'Yes')}><option>No</option><option>Yes</option></select>;
}
export function FileName({ value, onChange, accept = '.pdf' }: { value: string; onChange: (v: string) => void; accept?: string }) {
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
      <input type="file" accept={accept} onChange={(e) => {
        const f = e.target.files?.[0];
        if (!f) return;
        if (f.size > 10 * 1024 * 1024) { alert('The file must be 10 MB or smaller.'); e.target.value = ''; return; }
        onChange(f.name);
      }} />
      {value && <span className="badge neutral" title="Only the file name is stored in this demo">📎 {value} <button className="link-btn" type="button" onClick={() => onChange('')} aria-label="Remove file">×</button></span>}
    </div>
  );
}

export function StatusBadge({ status }: { status: Status }) {
  const icon = { Approved: '✓', Submitted: '⏳', Draft: '✎', Rework: '↺', Rejected: '✕' }[status];
  return <span className={`badge ${status}`}><span aria-hidden>{icon}</span>{STATUS_LABEL[status]}</span>;
}

export function Alert({ kind = 'info', children }: { kind?: 'info' | 'error' | 'success'; children: ReactNode }) {
  return <div className={`alert ${kind}`} role={kind === 'error' ? 'alert' : 'status'}>{children}</div>;
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: ReactNode }[]; value: T; onChange: (t: T) => void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} className={value === t.id ? 'on' : ''} onClick={() => onChange(t.id)} type="button">{t.label}</button>
      ))}
    </div>
  );
}

export function Modal({ title, onClose, children }: { title: ReactNode; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    ref.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" tabIndex={-1} ref={ref}>
        <div className="modal-head"><span>{title}</span><button onClick={onClose} aria-label="Close">×</button></div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

// ---------- data table ----------

export interface Column<T> {
  key: string;
  label: string;
  render?: (row: T) => ReactNode;
  value?: (row: T) => string | number; // used for sorting and CSV
  num?: boolean;
  className?: string;
}

export function DataTable<T>({ rows, columns, pageSize = 15, exportName, onRowClick, empty = 'No records found.', footer, rowKey }: {
  rows: T[]; columns: Column<T>[]; pageSize?: number; exportName?: string; onRowClick?: (row: T) => void; empty?: string;
  footer?: ReactNode; rowKey: (row: T) => string;
}) {
  const [page, setPage] = useState(0);
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const valueOf = useCallback((c: Column<T>, r: T) => (c.value ? c.value(r) : String((r as Record<string, unknown>)[c.key] ?? '')), []);
  const sorted = useMemo(() => {
    if (!sort) return rows;
    const c = columns.find((x) => x.key === sort.key);
    if (!c) return rows;
    return [...rows].sort((a, b) => {
      const va = valueOf(c, a), vb = valueOf(c, b);
      return (typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb))) * sort.dir;
    });
  }, [rows, sort, columns, valueOf]);
  const pages = Math.max(1, Math.ceil(sorted.length / pageSize));
  useEffect(() => { if (page >= pages) setPage(0); }, [pages, page]);
  const shown = sorted.slice(page * pageSize, page * pageSize + pageSize);

  const exportCsv = () => downloadCsv(exportName ?? 'export', columns.map((c) => c.label), sorted.map((r) => columns.map((c) => valueOf(c, r))));

  return (
    <div>
      <div className="tbl-wrap">
        <table className="tbl">
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key} className={`sortable ${c.num ? 'num' : ''}`} aria-sort={sort?.key === c.key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}
                  onClick={() => setSort((s) => (s?.key === c.key ? { key: c.key, dir: s.dir === 1 ? -1 : 1 } : { key: c.key, dir: c.num ? -1 : 1 }))}>
                  {c.label}{sort?.key === c.key ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={rowKey(r)} onClick={onRowClick ? () => onRowClick(r) : undefined} style={onRowClick ? { cursor: 'pointer' } : undefined}>
                {columns.map((c) => <td key={c.key} className={`${c.num ? 'num' : ''} ${c.className ?? ''}`}>{c.render ? c.render(r) : valueOf(c, r)}</td>)}
              </tr>
            ))}
          </tbody>
          {footer && <tfoot>{footer}</tfoot>}
        </table>
        {!rows.length && <div className="empty">{empty}</div>}
      </div>
      <div className="tbl-foot">
        <div>
          {exportName && <button className="btn sm" onClick={exportCsv} disabled={!rows.length}>Export</button>}
          <span className="muted" style={{ marginLeft: 8 }}>{rows.length} record{rows.length === 1 ? '' : 's'}</span>
        </div>
        {pages > 1 && (
          <div className="pager" aria-label="Pages">
            <button onClick={() => setPage(0)} disabled={page === 0} aria-label="First page">«</button>
            {Array.from({ length: pages }, (_, i) => i).filter((i) => Math.abs(i - page) < 4 || i === pages - 1 || i === 0).map((i, idx, arr) => (
              <span key={i}>
                {idx > 0 && i - arr[idx - 1] > 1 && '…'}
                <button className={i === page ? 'on' : ''} onClick={() => setPage(i)} aria-current={i === page}>{i + 1}</button>
              </span>
            ))}
            <button onClick={() => setPage(pages - 1)} disabled={page === pages - 1} aria-label="Last page">»</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- toast ----------

const ToastCtx = createContext<(msg: string) => void>(() => {});
export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { if (!msg) return; const t = setTimeout(() => setMsg(null), 3200); return () => clearTimeout(t); }, [msg]);
  return <ToastCtx.Provider value={setMsg}>{children}{msg && <div className="toast" role="status">{msg}</div>}</ToastCtx.Provider>;
}
export const useToast = () => useContext(ToastCtx);

/** Progress bar coloured by attainment, always paired with the number. */
export function Attainment({ value, target }: { value: number; target: number }) {
  const p = target ? Math.min(100, Math.round((value / target) * 100)) : 0;
  const cls = p >= 100 ? 'good' : p >= 50 ? 'mid' : 'low';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div className="bar-track" style={{ flex: 1 }} role="progressbar" aria-valuenow={p} aria-valuemin={0} aria-valuemax={100}><div className={`bar-fill ${cls}`} style={{ width: `${p}%` }} /></div>
      <span style={{ minWidth: 34, textAlign: 'right' }}>{p}%</span>
    </div>
  );
}
