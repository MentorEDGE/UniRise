import { useEffect, useRef, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { logout, useStore } from '../lib/store';
import { LogoMark } from './Logo';
import { pendingCount } from '../lib/analytics';
import type { Role } from '../lib/types';

interface MenuDef { label: string; to?: string; items?: ({ label: string; to: string } | 'sep')[] }

export function menusFor(role: Role, pending: number): MenuDef[] {
  if (role === 'it_admin') {
    return [
      { label: 'Access Requests', to: '/' },
      { label: 'Users', to: '/admin/users' },
      { label: 'Institutions', to: '/admin/institutions' },
      { label: 'Audit Log', to: '/admin/audit' },
      { label: 'Account', items: [{ label: 'Change Password', to: '/account' }] },
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
      { label: 'Biodata', items: [{ label: 'View Biodata / Print CV', to: '/biodata' }, { label: 'Edit Biodata', to: '/biodata/edit' }] },
      { label: 'Reports', items: [{ label: 'My Performance', to: '/performance' }, 'sep', { label: 'Publication Reports', to: '/reports/publications' }, { label: 'Grant Reports', to: '/reports/grants' }, { label: 'FDP Reports', to: '/reports/fdps' }, { label: 'Conference Reports', to: '/reports/conferences' }] },
      { label: 'View Profile', to: '/profile-search' },
      { label: 'Account', items: [{ label: 'Change Password', to: '/account' }] },
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
    { label: 'Reports', items: [{ label: 'Annual Activity Report', to: '/reports/annual' }, 'sep', { label: 'Publication Reports', to: '/reports/publications' }, { label: 'Grant Reports', to: '/reports/grants' }, { label: 'FDP Reports', to: '/reports/fdps' }, { label: 'Conference Reports', to: '/reports/conferences' }] },
    { label: 'View Profile', to: '/profile-search' },
    { label: 'Settings', items: [{ label: 'Institution & Departments', to: '/settings' }, { label: 'Targets & Scoring', to: '/settings/targets' }, { label: 'Notices', to: '/settings/notices' }, { label: 'Account', to: '/account' }] },
  ];
}

function NavBar({ menus }: { menus: MenuDef[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const loc = useLocation();
  const ref = useRef<HTMLElement>(null);
  useEffect(() => setOpen(null), [loc.pathname]);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(null); };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(null);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, []);
  const isActive = (m: MenuDef) => (m.to ? (m.to === '/' ? loc.pathname === '/' : loc.pathname.startsWith(m.to)) : m.items?.some((i) => i !== 'sep' && loc.pathname === i.to));

  return (
    <nav className="nav no-print" ref={ref} aria-label="Main menu">
      {menus.map((m) => (
        <div className="nav-item" key={m.label} onMouseEnter={() => m.items && setOpen(m.label)} onMouseLeave={() => setOpen(null)}>
          {m.to ? (
            <Link to={m.to} className={`nav-btn ${isActive(m) ? 'active' : ''}`} style={{ display: 'inline-block', textDecoration: 'none' }}>{m.label}</Link>
          ) : (
            <button className={`nav-btn ${isActive(m) ? 'active' : ''}`} aria-haspopup="true" aria-expanded={open === m.label} onClick={() => setOpen(open === m.label ? null : m.label)}>
              {m.label}<span className="caret" aria-hidden>▾</span>
            </button>
          )}
          {m.items && open === m.label && (
            <div className="menu" role="menu">
              {m.items.map((i, idx) => i === 'sep' ? <div key={idx} className="menu-sep" /> : <Link key={i.to + i.label} to={i.to} role="menuitem">{i.label}</Link>)}
            </div>
          )}
        </div>
      ))}
    </nav>
  );
}

export function Layout() {
  const { db, user, institution } = useStore();
  const nav = useNavigate();
  if (!user) return null;
  const fac = user.facultyId ? db.faculty.find((f) => f.id === user.facultyId) : undefined;
  const displayName = fac ? `${fac.title} ${fac.name}` : user.name;
  const roleLabel = user.role === 'it_admin' ? 'IT Admin' : user.role === 'management' ? `Top-Level Management${user.designation ? ` · ${user.designation}` : ''}` : `Faculty · ${fac?.department ?? ''}`;
  return (
    <div className="app">
      <header className="hdr">
        <Link to="/" className="brand" style={{ textDecoration: 'none', color: 'inherit' }} aria-label="UniRise home">
          <LogoMark />
          <span className="brand-text">
            <span className="brand-word">Uni<span>Rise</span></span>
            <span className="brand-user">{displayName} <span className="brand-tag">· {roleLabel}</span></span>
          </span>
        </Link>
        <div className="hdr-title">Research Data Management System</div>
        <div className="hdr-right">
          <span className="inst" title={institution?.name}>
            <span className="inst-name">{institution ? institution.name : 'Platform administration'}</span>
            <span className="inst-tag">{institution ? db.settings.institutionTagline : 'All institutions · access management'}</span>
          </span>
          <button className="logout" onClick={async () => { await logout(); nav('/login'); }}>Logout</button>
        </div>
      </header>
      <NavBar menus={menusFor(user.role, user.role === 'management' ? pendingCount(db) : 0)} />
      <main><Outlet /></main>
      <footer className="ftr no-print">
        <span>UniRise · multi-institution RMS</span>
        <span className="mid">{institution ? `${institution.name} · data held in its own database` : 'Platform administration'}</span>
        <span className="right">Best viewed on Google Chrome</span>
      </footer>
    </div>
  );
}
