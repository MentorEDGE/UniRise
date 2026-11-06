import { useEffect, useRef, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { adminApi, logout, useStore } from '../lib/store';
import { Logo } from './Logo';
import { ThemeToggle } from './ThemeToggle';
import type { Role } from '../lib/types';

type MenuEntry = { label: string; to: string } | { label: string; action: 'logout' } | 'sep';
interface MenuDef { label: string; to?: string; items?: MenuEntry[]; icon?: keyof typeof NAV_ICONS }

const nic = (d: ReactNode) => <svg className="nav-ic" viewBox="0 0 24 24" aria-hidden>{d}</svg>;
const NAV_ICONS = {
  faculty: nic(<><circle cx="9" cy="8" r="3.2" /><path d="M3 19.5c.6-3.2 3-5 6-5s5.4 1.8 6 5" /><circle cx="17" cy="9" r="2.4" /><path d="M16 14.6c2.6-.2 4.6 1.4 5 4.4" /></>),
  publications: nic(<><path d="M4 5.5c2.7-1 5.3-1 8 .7v13.3c-2.7-1.7-5.3-1.7-8-.7Z" /><path d="M20 5.5c-2.7-1-5.3-1-8 .7v13.3c2.7-1.7 5.3-1.7 8-.7Z" /></>),
  grants: nic(<><circle cx="12" cy="12" r="8" /><path d="M14.8 9.2c-.6-.8-1.6-1.2-2.8-1.2-1.6 0-2.8.8-2.8 2s1.2 1.7 2.8 2 2.8.8 2.8 2-1.2 2-2.8 2c-1.2 0-2.2-.4-2.8-1.2M12 6.5V8M12 16v1.5" /></>),
  fdp: nic(<><path d="m12 4 9 4.5-9 4.5-9-4.5Z" /><path d="M7 10.8v4.4c1.4 1.3 3.1 1.9 5 1.9s3.6-.6 5-1.9v-4.4M21 8.5v5" /></>),
  conferences: nic(<><rect x="3.5" y="4" width="17" height="11" rx="1.8" /><path d="M12 15v3.5M8 20.5h8M7.5 8.5h9M7.5 11.5h5" /></>),
  awards: nic(<><path d="M7.5 4h9v5a4.5 4.5 0 0 1-9 0Z" /><path d="M7.5 6H4.5a3 3 0 0 0 3 3.5M16.5 6h3a3 3 0 0 1-3 3.5M12 13.5V17M8.5 20h7" /></>),
  reports: nic(<><path d="M4 20h16" /><rect x="5.5" y="12" width="3" height="5.5" rx="0.8" /><rect x="10.5" y="8" width="3" height="9.5" rx="0.8" /><rect x="15.5" y="4.5" width="3" height="13" rx="0.8" /></>),
  settings: nic(<><circle cx="12" cy="12" r="3" /><path d="M12 3.5v2.2M12 18.3v2.2M3.5 12h2.2M18.3 12h2.2M6 6l1.6 1.6M16.4 16.4 18 18M6 18l1.6-1.6M16.4 7.6 18 6" /></>),
  home: nic(<><path d="m3.5 11 8.5-7 8.5 7" /><path d="M6 9.5V20h12V9.5M10 20v-5h4v5" /></>),
  profile: nic(<><circle cx="12" cy="8" r="3.6" /><path d="M5 20.5c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5" /></>),
  network: nic(<><circle cx="12" cy="5.5" r="2.3" /><circle cx="5" cy="18" r="2.3" /><circle cx="19" cy="18" r="2.3" /><path d="m10.9 7.5-4.8 8.4M13.1 7.5l4.8 8.4M7.3 18h9.4" /></>),
  institution: nic(<><path d="M3 21h18" /><path d="M6 18v-7M10 18v-7M14 18v-7M18 18v-7" /><path d="m12 3 8 5H4Z" /></>),
  users: nic(<><circle cx="9" cy="8" r="3.2" /><path d="M3 19.5c.6-3.2 3-5 6-5s5.4 1.8 6 5" /><path d="M17 8v6M14 11h6" /></>),
  approvals: nic(<><path d="M12 3 4.5 6v5.5c0 4.6 3.1 8.2 7.5 9.5 4.4-1.3 7.5-4.9 7.5-9.5V6Z" /><path d="m8.8 12 2.2 2.2 4.2-4.4" /></>),
};
const LOGOUT: MenuEntry = { label: 'Logout', action: 'logout' };

const SETTINGS: MenuDef = { label: 'Settings', icon: 'settings', items: [{ label: 'Change Password', to: '/account' }, 'sep', LOGOUT] };
/** Research record views shared by Top-Level Management and the Office of Research (read-only lists and reports). */
const RECORD_MENUS: MenuDef[] = [
  { label: 'Publications', icon: 'publications', items: [{ label: 'Publication View', to: '/publications' }, { label: 'Publication Reports', to: '/reports/publications' }] },
  { label: 'Grants and Fellowships', icon: 'grants', items: [{ label: 'Grant View', to: '/grants' }, { label: 'Grant Reports', to: '/reports/grants' }, 'sep', { label: 'Seed Money Reports', to: '/seed-money' }] },
  { label: 'Faculty Development Programmes', icon: 'fdp', items: [{ label: 'FDP View', to: '/fdp' }, { label: 'FDP Reports', to: '/reports/fdps' }] },
  { label: 'Conferences', icon: 'conferences', items: [{ label: 'Conference View', to: '/conferences' }, { label: 'Conference Reports', to: '/reports/conferences' }] },
  { label: 'Honours & Awards', icon: 'awards', items: [{ label: 'Honours & Awards View', to: '/awards' }, { label: 'Honours & Awards Reports', to: '/reports/awards' }] },
];
const REPORTS: MenuDef = { label: 'Reports', icon: 'reports', items: [{ label: 'Annual Activity Report', to: '/reports/annual' }, 'sep', { label: 'Institution Overview', to: '/analytics' }, { label: 'Department Comparison', to: '/analytics/departments' }, { label: 'Faculty Performance', to: '/analytics/faculty' }, { label: 'Participation & Compliance', to: '/analytics/participation' }] };

export function menusFor(role: Role, pending: number): MenuDef[] {
  if (role === 'faculty') {
    // Faculty work only with their own profile and records.
    return [
      { label: 'My Profile', icon: 'profile', items: [{ label: 'My Research Profile', to: '/my-profile' }, { label: 'My Workspace', to: '/' }, { label: 'Update Profile', to: '/biodata/edit' }, { label: 'My Performance', to: '/performance' }, 'sep', { label: 'Print / Download CV', to: '/biodata' }] },
      { label: 'My Publications', icon: 'publications', items: [{ label: 'My Publications', to: '/publications' }, { label: 'Add Publication', to: '/publications/entry' }] },
      { label: 'My Grants and Fellowships', icon: 'grants', items: [{ label: 'My Grants', to: '/grants' }, { label: 'Add Grant / Fellowship', to: '/grants/entry' }, 'sep', { label: 'Apply for Seed Money', to: '/seed-money/entry' }, { label: 'My Seed Money Projects', to: '/seed-money' }] },
      { label: 'My Faculty Development Programmes', icon: 'fdp', items: [{ label: 'My FDPs', to: '/fdp' }, { label: 'Add FDP', to: '/fdp/entry' }] },
      { label: 'My Conferences', icon: 'conferences', items: [{ label: 'My Conferences', to: '/conferences' }, { label: 'Add Conference', to: '/conferences/entry' }] },
      { label: 'My Honours & Awards', icon: 'awards', items: [{ label: 'My Honours & Awards', to: '/awards' }, { label: 'Add Honour / Award', to: '/awards/entry' }] },
      { label: 'My Collaborations', icon: 'network', to: '/collaborations' },
      { label: 'My Submissions', icon: 'approvals', to: '/submissions' },
      SETTINGS,
    ];
  }
  if (role === 'office') {
    // The institution's administrator and verification authority.
    return [
      { label: 'Faculty', icon: 'faculty', items: [{ label: 'Find Profiles', to: '/faculty' }, { label: 'Faculty Performance', to: '/analytics/faculty' }, { label: 'Research Networks', to: '/networks' }] },
      ...RECORD_MENUS,
      { label: `Approval${pending ? ` (${pending})` : ''}`, icon: 'approvals', to: '/' },
      { label: 'Institution', icon: 'institution', items: [{ label: 'Institution & Departments', to: '/settings' }, { label: 'Targets & Scoring', to: '/settings/targets' }, { label: 'Notices', to: '/settings/notices' }] },
      { label: 'User Management', icon: 'users', items: [{ label: 'Users', to: '/office/users' }, { label: 'Audit Log', to: '/office/audit' }] },
      REPORTS,
      SETTINGS,
    ];
  }
  // Top-Level Management: read-only research intelligence for the institution.
  return [
    { label: 'Faculty', icon: 'faculty', items: [{ label: 'Find Profiles', to: '/faculty' }, { label: 'Faculty Performance', to: '/analytics/faculty' }] },
    ...RECORD_MENUS,
    { label: 'Research Networks', icon: 'network', to: '/networks' },
    REPORTS,
    SETTINGS,
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
  const isActive = (m: MenuDef) => (m.to ? (m.to === '/' ? loc.pathname === '/' : loc.pathname.startsWith(m.to))
    : m.items?.some((i) => i !== 'sep' && 'to' in i && (loc.pathname === i.to || (i.to === '/faculty' && (loc.pathname === '/' || loc.pathname.startsWith('/faculty/'))))));

  return (
    <nav className={`nav no-print ${menus.length > 11 || menus.reduce((a, m) => a + m.label.length, 0) > 90 ? 'compact' : ''} ${menus.length >= 9 ? 'many' : ''}`} ref={ref} aria-label="Main menu">
      {menus.map((m) => (
        <div className="nav-item" key={m.label} onMouseEnter={() => (m.items ? setOpen(m.label) : open && closeSoon())} onMouseLeave={() => m.items && closeSoon()}>
          {m.to ? (
            <Link to={m.to} className={`nav-btn ${isActive(m) ? 'active' : ''}`} style={{ textDecoration: 'none' }}>{m.icon && NAV_ICONS[m.icon]}{m.label}</Link>
          ) : (
            <button className={`nav-btn ${isActive(m) ? 'active' : ''}`} aria-haspopup="true" aria-expanded={open === m.label} onClick={() => setOpen(open === m.label ? null : m.label)}>
              {m.icon && NAV_ICONS[m.icon]}{m.label}<span className="caret" aria-hidden>▾</span>
            </button>
          )}
          {m.items && open === m.label && (
            <div className="menu" role="menu">
              {m.items.map((i, idx) => i === 'sep' ? <div key={idx} className="menu-sep" />
                : 'to' in i ? <Link key={i.to + i.label} to={i.to} role="menuitem" onClick={() => setOpen(null)}>{i.label}</Link>
                : <button key={i.label} type="button" role="menuitem" onClick={async () => { setOpen(null); await logout(); nav('/'); }}>{i.label}</button>)}
            </div>
          )}
        </div>
      ))}
      <div className="nav-item nav-theme"><ThemeToggle /></div>
    </nav>
  );
}

/** Entries waiting for the Office of Research, across institutions. Refreshed on navigation and after a review. */
function useOfficePending(enabled: boolean) {
  const loc = useLocation();
  const [n, setN] = useState(0);
  const [tick, setTick] = useState(0);
  useEffect(() => { const on = () => setTick((t) => t + 1); window.addEventListener('rdms:approvals', on); return () => window.removeEventListener('rdms:approvals', on); }, []);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    adminApi<{ total: number }>('GET', '/office/approvals/count').then((r) => live && setN(r.total)).catch(() => {});
    return () => { live = false; };
  }, [enabled, loc.pathname, tick]);
  return n;
}

export function Layout() {
  const { user, institution } = useStore();
  const pending = useOfficePending(user?.role === 'office');
  if (!user) return null;
  return (
    <div className="app">
      <header className="hdr">
        <Link to="/" className="brand-home" style={{ display: 'flex', minWidth: 0, textDecoration: 'none', color: 'inherit' }} aria-label="UniRise by MentorEdge, home">
          <Logo />
        </Link>
        <div className="hdr-right">
          <span className="inst" title={institution?.name}>
            <span className="inst-name">{institution?.name ?? ''}</span>
          </span>
        </div>
      </header>
      <NavBar menus={menusFor(user.role, user.role === 'office' ? pending : 0)} />
      <main><Outlet /></main>
    </div>
  );
}
