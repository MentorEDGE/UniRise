import { Component, useEffect, useLayoutEffect } from 'react';
import type { ReactNode } from 'react';
import { HashRouter, Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Alert, Panel, ToastProvider } from './components/ui';
import { bootstrap, useStore } from './lib/store';
import type { Role } from './lib/types';
import { AwardEntry, ConferenceEntry, FdpEntry, GrantEntry, PublicationEntry, SeedMoneyEntry } from './pages/faculty/Entries';
import { FacultyHome } from './pages/faculty/FacultyHome';
import { MySubmissions } from './pages/faculty/Submissions';
import { DepartmentAnalytics, FacultyPerformance, InstitutionAnalytics, ParticipationAnalytics } from './pages/mgmt/Analytics';
import { Faculty360 } from './pages/mgmt/Management';
import { FacultySearch } from './pages/mgmt/Directory';
import { MyResearchProfile, ResearcherProfileRoute } from './pages/shared/ResearcherProfile';
import { BiodataEdit, BiodataView } from './pages/shared/Biodata';
import { Account, Login } from './pages/shared/Misc';
import { IntroLanding } from './pages/shared/Landing';
import { AdminApprovals, AdminAudit, AdminUsers } from './pages/admin/Admin';
import { InstitutionSettings, NoticeSettings, TargetSettings } from './pages/office/Settings';
import { InstitutionNetworks, MyCollaborations } from './pages/mgmt/Networks';
import { TalkToOurTeam } from './pages/shared/Contact';
import { RecordView } from './pages/shared/RecordView';
import { AnnualReport, ReportsPage, SeedMoneyReport } from './pages/shared/Reports';

/** Keeps one broken page from blanking the whole app. */
class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <Panel>
        <Alert kind="error">This page could not be shown. Go back to the home page and try again; if it keeps happening, tell your administrator.</Alert>
        <div className="btn-row"><button className="btn" onClick={() => { this.setState({ error: null }); window.location.hash = '#/'; }}>Go to home</button></div>
      </Panel>
    );
  }
}

/**
 * Every route change starts at the top of the page (the browser would otherwise keep the previous page's scroll
 * position, so "Talk to Our Team" clicked at the bottom of the introduction page opened at the bottom).
 * Section links on the introduction page (?s=…) then scroll to their section themselves.
 */
function ScrollToTop() {
  const { pathname, search } = useLocation();
  useLayoutEffect(() => {
    if ('scrollRestoration' in window.history) window.history.scrollRestoration = 'manual';
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' as ScrollBehavior });
  }, [pathname, search]);
  return null;
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { user } = useStore();
  const loc = useLocation();
  if (user) return <>{children}</>;
  // Signed out: the address of the site shows the introduction page; anything else needs signing in first.
  return loc.pathname === '/' ? <IntroLanding /> : <Navigate to="/login" replace />;
}

const ROLE_NAME: Record<Role, string> = { management: 'Top-Level Management', faculty: 'faculty', office: 'the Office of Research' };
/** Route-level role check for a clear message. The API enforces the same rules on every request. */
function Only({ role, children }: { role: Role | Role[]; children: ReactNode }) {
  const { user } = useStore();
  const roles = Array.isArray(role) ? role : [role];
  if (!user || !roles.includes(user.role)) return <Panel><Alert kind="error">This page is only available to {roles.map((r) => ROLE_NAME[r]).join(' and ')}.</Alert></Panel>;
  return <>{children}</>;
}
const ALL: Role[] = ['management', 'faculty', 'office'];
/** Institution-wide viewing: Top-Level Management (read-only) and the Office of Research. */
const VIEWERS: Role[] = ['management', 'office'];

/** After sign-in everyone lands on "/": the faculty workspace, Faculty Search for management, Approval for the Office of Research. */
function Home() {
  const { user } = useStore();
  if (user?.role === 'office') return <AdminApprovals />;
  return user?.role === 'management' ? <FacultySearch /> : <FacultyHome />;
}

function SeedMoneyHome() {
  const { user } = useStore();
  return user?.role === 'faculty' ? <RecordView kind="seedMoney" /> : <SeedMoneyReport />;
}

function SelfPerformance() {
  const { user } = useStore();
  return <Faculty360 facultyId={user!.facultyId} />;
}

function PerformanceRoute() {
  const { id } = useParams();
  return <Faculty360 key={id} facultyId={id} />;
}

export default function App() {
  const { ready } = useStore();
  useEffect(() => { void bootstrap(); }, []);
  if (!ready) return <div className="intro" style={{ display: 'grid', placeItems: 'center' }}><p className="muted">Loading…</p></div>;
  return (
    <HashRouter>
      <ToastProvider>
       <ErrorBoundary>
        <ScrollToTop />
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/talk-to-our-team" element={<TalkToOurTeam />} />
          <Route path="/contact" element={<Navigate to="/talk-to-our-team" replace />} />
          {/* Accounts are created by the Office of Research; there is no self-registration. */}
          <Route path="/register" element={<Navigate to="/login" replace />} />
          <Route path="/admin" element={<Navigate to="/login" replace />} />
          <Route element={<RequireAuth><Layout /></RequireAuth>}>
            <Route index element={<Home />} />
            {/* record lists: faculty see their own, management approved only, the Office of Research everything */}
            <Route path="publications" element={<Only role={ALL}><RecordView kind="publications" /></Only>} />
            <Route path="grants" element={<Only role={ALL}><RecordView kind="grants" /></Only>} />
            <Route path="seed-money" element={<Only role={ALL}><SeedMoneyHome /></Only>} />
            <Route path="fdp" element={<Only role={ALL}><RecordView kind="fdps" /></Only>} />
            <Route path="conferences" element={<Only role={ALL}><RecordView kind="conferences" /></Only>} />
            <Route path="awards" element={<Only role={ALL}><RecordView kind="awards" /></Only>} />
            <Route path="reports/annual" element={<Only role={VIEWERS}><AnnualReport /></Only>} />
            <Route path="reports/:group" element={<Only role={VIEWERS}><ReportsPage /></Only>} />
            <Route path="profile-search" element={<Navigate to="/faculty" replace />} />
            <Route path="account" element={<Account />} />

            {/* faculty: own profile and records only */}
            <Route path="publications/entry" element={<Only role="faculty"><PublicationEntry /></Only>} />
            <Route path="grants/entry" element={<Only role="faculty"><GrantEntry /></Only>} />
            <Route path="seed-money/entry" element={<Only role="faculty"><SeedMoneyEntry /></Only>} />
            <Route path="fdp/entry" element={<Only role="faculty"><FdpEntry /></Only>} />
            <Route path="conferences/entry" element={<Only role="faculty"><ConferenceEntry /></Only>} />
            <Route path="awards/entry" element={<Only role="faculty"><AwardEntry /></Only>} />
            <Route path="biodata" element={<Only role="faculty"><BiodataView /></Only>} />
            <Route path="biodata/edit" element={<Only role="faculty"><BiodataEdit /></Only>} />
            <Route path="performance" element={<Only role="faculty"><SelfPerformance /></Only>} />
            <Route path="my-profile" element={<Only role="faculty"><MyResearchProfile /></Only>} />
            <Route path="collaborations" element={<Only role="faculty"><MyCollaborations /></Only>} />
            <Route path="submissions" element={<Only role="faculty"><MySubmissions /></Only>} />

            {/* institution-wide viewing: Top-Level Management (read-only) and the Office of Research */}
            <Route path="analytics" element={<Only role={VIEWERS}><InstitutionAnalytics /></Only>} />
            <Route path="analytics/departments" element={<Only role={VIEWERS}><DepartmentAnalytics /></Only>} />
            <Route path="analytics/faculty" element={<Only role={VIEWERS}><FacultyPerformance /></Only>} />
            <Route path="analytics/participation" element={<Only role={VIEWERS}><ParticipationAnalytics /></Only>} />
            <Route path="faculty" element={<Only role={VIEWERS}><FacultySearch /></Only>} />
            <Route path="faculty/:id" element={<Only role={VIEWERS}><ResearcherProfileRoute /></Only>} />
            <Route path="faculty/:id/performance" element={<Only role={VIEWERS}><PerformanceRoute /></Only>} />
            <Route path="faculty/:id/biodata" element={<Only role={VIEWERS}><BiodataView /></Only>} />
            <Route path="networks" element={<Only role={VIEWERS}><InstitutionNetworks /></Only>} />

            {/* Office of Research only (the API enforces the same) */}
            <Route path="approvals" element={<Only role="office"><AdminApprovals /></Only>} />
            <Route path="settings" element={<Only role="office"><InstitutionSettings /></Only>} />
            <Route path="settings/targets" element={<Only role="office"><TargetSettings /></Only>} />
            <Route path="settings/notices" element={<Only role="office"><NoticeSettings /></Only>} />
            <Route path="office/users" element={<Only role="office"><AdminUsers /></Only>} />
            <Route path="office/audit" element={<Only role="office"><AdminAudit /></Only>} />
            <Route path="*" element={<Panel><Alert kind="error">Page not found.</Alert></Panel>} />
          </Route>
        </Routes>
       </ErrorBoundary>
      </ToastProvider>
    </HashRouter>
  );
}
