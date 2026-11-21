import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { adminApi } from '../lib/store';

interface Note { id: number; at: string; title: string; body: string; link: string; read: boolean }

const when = (iso: string) => {
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
};

/**
 * The bell in the menu bar: decisions on your entries and profile updates, new notices (faculty) and new submissions
 * (Office of Research). Opening one marks it read and goes to the page it is about; "Mark all as read" clears the count.
 * Refreshed every minute while the tab is visible, on navigation and after a review.
 */
export function NotificationBell() {
  const nav = useNavigate();
  const [items, setItems] = useState<Note[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const load = useCallback(async () => {
    try { const r = await adminApi<{ items: Note[]; unread: number }>('GET', '/notifications'); setItems(r.items); setUnread(r.unread); } catch { /* offline for a moment */ }
  }, []);
  useEffect(() => {
    void load();
    const t = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 60_000);
    const on = () => void load();
    window.addEventListener('rdms:approvals', on);
    window.addEventListener('rdms:notifications', on); // the other bell (desktop / phone menu) marked something read
    window.addEventListener('hashchange', on);
    return () => { clearInterval(t); window.removeEventListener('rdms:approvals', on); window.removeEventListener('rdms:notifications', on); window.removeEventListener('hashchange', on); };
  }, [load]);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);
  const read = async (body: { ids?: number[]; all?: boolean }) => {
    try {
      const r = await adminApi<{ unread: number }>('POST', '/notifications/read', body);
      setUnread(r.unread); setItems((xs) => xs.map((x) => (body.all || body.ids?.includes(x.id) ? { ...x, read: true } : x)));
      window.dispatchEvent(new Event('rdms:notifications'));
    } catch { /* try again later */ }
  };
  return (
    <div className="notif" ref={ref}>
      <button type="button" className="notif-bell" aria-haspopup="true" aria-expanded={open} aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'} onClick={() => { setOpen(!open); if (!open) void load(); }}>
        <svg viewBox="0 0 24 24" aria-hidden><path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15L6 16Z" /><path d="M10 20a2 2 0 0 0 4 0" /></svg>
        {unread > 0 && <span className="notif-count">{unread > 99 ? '99+' : unread}</span>}
      </button>
      {open && (
        <div className="notif-pop" role="dialog" aria-label="Notifications">
          <div className="notif-head">
            <b>Notifications</b>
            <button type="button" className="link-btn" disabled={!unread} onClick={() => read({ all: true })}>Mark all as read</button>
          </div>
          {items.length === 0 && <p className="notif-empty">Nothing yet. Decisions on your entries and new notices appear here.</p>}
          <ul>
            {items.map((n) => (
              <li key={n.id} className={n.read ? '' : 'unread'}>
                <button type="button" onClick={() => { if (!n.read) void read({ ids: [n.id] }); setOpen(false); if (n.link) nav(n.link); }}>
                  <span className="notif-title">{n.title}</span>
                  {n.body && <span className="notif-body">{n.body}</span>}
                  <span className="notif-when">{when(n.at)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
