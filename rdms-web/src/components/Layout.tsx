import { useEffect, useRef, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { logout, useStore } from '../lib/store';
import { Logo } from './Logo';
import { ThemeToggle } from './ThemeToggle';
import { pendingCount } from '../lib/analytics';
import type { Role } from '../lib/types';

type MenuEntry = { label: string; to: string } | { label: string; action: 'logout' } | 'sep';
interface MenuDef { label: string; to?: string; items?: MenuEntry[] }
const LOGOUT: MenuEntry = { label: 'Logout', action: 'logout' };

export function menusFor(role: Role, pending: number): MenuDef[] {
  if (role === 'it_admin') {
    return [
      { label: 'Access Requests', to: '/' },
      { label: 'Users', to: '/admin/users' },
      { label: 'Institutions', to: '/admin/institutions' },
      { label: 'Audit Log', to: '/admin/audit' },
      { label: 'Account', items: [{ label: 'Change Password', to: '/account' }, 'sep', LOGOUT] },
    ];
  }
  if (role === 'faculty') {
    return [
      { label: 'Home', to: '/' },
      { label: 'Publication', items: [{ label: 'Publication View', to: '/publications' }, { label: 'Publication Entry', to: '/publications/entry' }] },
      { label: 'Grant', items: [{ label: 'Grant View', to: '/grants' }, { label: 'Grant Entry', to: '/grants/entry' }] },
      { label: 'Seed Money', items: [{ label: 'Seed Money Entry', to: '/seed-money/entry' }, { label: 'Seed Money Status', to: '/seed-money' }] },
      { label: 'FDP', items: [{ label: 'My FDPs', to: '/fdp' }, { label: 'FDP Entry', to: '/fdp/entry' }] },
      { label: 'Conference', items: [{ label: 'My Conferences', to: '/conferences' }, { label: 'Conference Entry', to: '/conferences/entry' }] },
      { label: 'Honours & Awards', items: [{ label: 'My Honours & Awards', to: '/awards' }, { label: 'Honour / Award Entry', to: '/awards/entry' }] },
      { label: 'Profile', items: [{ label: 'My Profile / Print CV', to: '/biodata' }, { label: 'Edit Profile', to: '/biodata/edit' }] },
      { label: 'Reports', items: [{ label: 'My Performance', to: '/performance' }, 'sep', { label: 'Publication Reports', to: '/reports/publications' }, { label: 'Grant Reports', to: '/reports/grants' }, { label: 'FDP Reports', to: '/reports/fdps' }, { label: 'Conference Reports', to: '/reports/conferences' }, { label: 'Honours & Awards Reports', to: '/reports/awards' }] },
      { label: 'Account', items: [{ label: 'Change Password', to: '/account' }, 'sep', LOGOUT] },
    ];
  }
  return [
    { label: 'Dashboard', to: '/' },
    { label: 'Analytics', items: [{ label: 'Institution Overview', to: '/analytics' }, { label: 'Department Comparison', to: '/analytics/departments' }, { label: 'Faculty Performance', to: '/analytics/faculty' }, { label: 'Participation & Compliance', to: '/analytics/participation' }] },
    { label: `Approval${pending ? ` (${pending})` : ''}`, to: '/approvals' },
    { label: 'Faculty', items: [{ label: 'Faculty Directory', to: '/faculty' }, { label: 'Add Faculty', to: '/faculty/new' }] },
    { label: 'Publication', items: [{ label: 'Publication View', to: '/publications' }, { label: 'Publication Reports', to: '/reports/publications' }] },
    { label: 'Grant', items: [{ label: 'Grant View', to: '/grants' }, { label: 'Grant Reports', to: '/reports/grants' }] },
    { label: 'Seed Money', items: [{ label: 'Seed Money Reports', to: '/seed-money' }] },
    { label: 'FDP', items: [{ label: 'FDP View', to: '/fdp' }, { label: 'FDP Reports', to: '/reports/fdps' }] },
    { label: 'Conference', items: [{ label: 'Conference View', to: '/conferences' }, { label: 'Conference Reports', to: '/reports/conferences' }] },
    { label: 'Honours & Awards', items: [{ label: 'Honours & Awards View', to: '/awards' }, { label: 'Honours & Awards Reports', to: '/reports/awards' }] },
    { label: 'Reports', items: [{ label: 'Annual Activity Report', to: '/reports/annual' }, 'sep', { label: 'Publication Reports', to: '/reports/publications' }, { label: 'Grant Reports', to: '/reports/grants' }, { label: 'FDP Reports', to: '/reports/fdps' }, { label: 'Conference Reports', to: '/reports/conferences' }, { label: 'Honours & Awards Reports', to: '/reports/awards' }] },
    { label: 'View Profile', to: '/profile-search' },
    { label: 'Settings', items: [{ label: 'Institution & Departments', to: '/settings' }, { label: 'Targets & Scoring', to: '/settings/targets' }, { label: 'Notices', to: '/settings/notices' }, 'sep', { label: 'Account (Change Password)', to: '/account' }, LOGOUT] },
  ];
}

function NavBar({ menus }: { menus: MenuDef[] }) {
  const [open, setOpenNow] = useState<string | null>(null);
  const nav = useNavigate();
  const loc = useLocation();
  const ref = useRef<HTMLElement>(null);
  // Hover opens a menu at once; leaving waits a moment, so the pointer can travel from the button
  // into the list (or slip off an edge briefly) without the list vanishing.
  const closeTimer = useRef<number | undefined>(undefined);
  const cancelClose = () => window.clearTimeout(closeTimer.current);
  const setOpen = (label: string | null) => { cancelClose(); setOpenNow(label); };
  const closeSoon = () => { cancelClose(); closeTimer.current = window.setTimeout(() => setOpenNow(null), 300); };
  useEffect(() => cancelClose, []);
  useEffect(() => setOpen(null), [loc.pathname]);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(null); };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(null);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, []);
  const isActive = (m: MenuDef) => (m.to ? (m.to === '/' ? loc.pathname === '/' : loc.pathname.startsWith(m.to)) : m.items?.some((i) => i !== 'sep' && 'to' in i && loc.pathname === i.to));

  return (
    <nav className={`nav no-print ${menus.length > 11 ? 'compact' : ''}`} ref={ref} aria-label="Main menu">
      {menus.map((m) => (
        <div className="nav-item" key={m.label} onMouseEnter={() => (m.items ? setOpen(m.label) : open && closeSoon())} onMouseLeave={() => m.items && closeSoon()}>
          {m.to ? (
            <Link to={m.to} className={`nav-btn ${isActive(m) ? 'active' : ''}`} style={{ display: 'inline-block', textDecoration: 'none' }}>{m.label}</Link>
          ) : (
            <button className={`nav-btn ${isActive(m) ? 'active' : ''}`} aria-haspopup="true" aria-expanded={open === m.label} onClick={() => setOpen(open === m.label ? null : m.label)}>
              {m.label}<span className="caret" aria-hidden>▾</span>
            </button>
          )}
          {m.items && open === m.label && (
            <div className="menu" role="menu">
              {m.items.map((i, idx) => i === 'sep' ? <div key={idx} className="menu-sep" />
                : 'to' in i ? <Link key={i.to + i.label} to={i.to} role="menuitem" onClick={() => setOpen(null)}>{i.label}</Link>
                : <button key={i.label} type="button" role="menuitem" onClick={async () => { setOpen(null); await logout(); nav('/login'); }}>{i.label}</button>)}
            </div>
          )}
        </div>
      ))}
      <div className="nav-item nav-theme"><ThemeToggle /></div>
    </nav>
  );
}

export function Layout() {
  const { db, user, institution } = useStore();
  if (!user) return null;
  return (
    <div className="app">
      <header className="hdr">
        <Link to="/" className="brand-home" style={{ display: 'flex', minWidth: 0, textDecoration: 'none', color: 'inherit' }} aria-label="UniRise by MentorEdge, home">
          <Logo />
        </Link>
        <div className="hdr-right">
          <span className="inst" title={institution?.name}>
            <span className="inst-name">{institution ? institution.name : 'UniRise · Office of Research'}</span>
          </span>
        </div>
      </header>
      <NavBar menus={menusFor(user.role, user.role === 'management' ? pendingCount(db) : 0)} />
      <main><Outlet /></main>
    </div>
  );
}
