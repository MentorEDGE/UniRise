import { Component, useEffect } from 'react';
import type { ReactNode } from 'react';
import { HashRouter, Navigate, Route, Routes, useParams } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Alert, Panel, ToastProvider } from './components/ui';
import { bootstrap, useStore } from './lib/store';
import type { Role } from './lib/types';
import { ConferenceEntry, FdpEntry, GrantEntry, PublicationEntry, SeedMoneyEntry } from './pages/faculty/Entries';
import { FacultyHome } from './pages/faculty/FacultyHome';
import { DepartmentAnalytics, FacultyPerformance, InstitutionAnalytics, ParticipationAnalytics } from './pages/mgmt/Analytics';
import { Approvals, Faculty360, FacultyDirectory, FacultyForm, ManagementDashboard } from './pages/mgmt/Management';
import { BiodataEdit, BiodataView } from './pages/shared/Biodata';
import { Account, AdminLogin, InstitutionSettings, Login, NoticeSettings, ProfileSearch, Register, TargetSettings } from './pages/shared/Misc';
import { AdminAudit, AdminInstitutions, AdminRequests, AdminUsers } from './pages/admin/Admin';
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

function RequireAuth({ children }: { children: ReactNode }) {
  const { user } = useStore();
  return user ? <>{children}</> : <Navigate to="/login" replace />;
}

const ROLE_NAME: Record<Role, string> = { management: 'Top-Level Management', faculty: 'faculty', it_admin: 'the IT Admin' };
/** Route-level role check for a clear message. The API enforces the same rules on every request. */
function Only({ role, children }: { role: Role | Role[]; children: ReactNode }) {
  const { user } = useStore();
  const roles = Array.isArray(role) ? role : [role];
  if (!user || !roles.includes(user.role)) return <Panel><Alert kind="error">This page is only available to {roles.map((r) => ROLE_NAME[r]).join(' and ')}.</Alert></Panel>;
  return <>{children}</>;
}
const INST: Role[] = ['management', 'faculty'];

/** After sign-in everyone lands on "/", which shows the dashboard for their role. */
function Home() {
  const { user } = useStore();
  if (user?.role === 'it_admin') return <AdminRequests />;
  return user?.role === 'management' ? <ManagementDashboard /> : <FacultyHome />;
}

function SeedMoneyHome() {
  const { user } = useStore();
  return user?.role === 'management' ? <SeedMoneyReport /> : <RecordView kind="seedMoney" />;
}

function SelfPerformance() {
  const { user } = useStore();
  return <Faculty360 facultyId={user!.facultyId} />;
}

function ProfileRoute() {
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
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          {/* IT Admin has its own sign-in route; it is not linked from the public pages. */}
          <Route path="/admin" element={<AdminLogin />} />
          <Route element={<RequireAuth><Layout /></RequireAuth>}>
            <Route index element={<Home />} />
            {/* shared views: scope differs by role */}
            <Route path="publications" element={<Only role={INST}><RecordView kind="publications" /></Only>} />
            <Route path="grants" element={<Only role={INST}><RecordView kind="grants" /></Only>} />
            <Route path="seed-money" element={<Only role={INST}><SeedMoneyHome /></Only>} />
            <Route path="fdp" element={<Only role={INST}><RecordView kind="fdps" /></Only>} />
            <Route path="conferences" element={<Only role={INST}><RecordView kind="conferences" /></Only>} />
            <Route path="reports/annual" element={<Only role="management"><AnnualReport /></Only>} />
            <Route path="reports/:group" element={<Only role={INST}><ReportsPage /></Only>} />
            <Route path="profile-search" element={<Only role={INST}><ProfileSearch /></Only>} />
            <Route path="profile/:id" element={<Only role={INST}><ProfileRoute /></Only>} />
            <Route path="profile/:id/biodata" element={<Only role={INST}><BiodataView /></Only>} />
            <Route path="account" element={<Account />} />

            {/* faculty */}
            <Route path="publications/entry" element={<Only role="faculty"><PublicationEntry /></Only>} />
            <Route path="grants/entry" element={<Only role="faculty"><GrantEntry /></Only>} />
            <Route path="seed-money/entry" element={<Only role="faculty"><SeedMoneyEntry /></Only>} />
            <Route path="fdp/entry" element={<Only role="faculty"><FdpEntry /></Only>} />
            <Route path="conferences/entry" element={<Only role="faculty"><ConferenceEntry /></Only>} />
            <Route path="biodata" element={<Only role="faculty"><BiodataView /></Only>} />
            <Route path="biodata/edit" element={<Only role="faculty"><BiodataEdit /></Only>} />
            <Route path="performance" element={<Only role="faculty"><SelfPerformance /></Only>} />

            {/* management */}
            <Route path="analytics" element={<Only role="management"><InstitutionAnalytics /></Only>} />
            <Route path="analytics/departments" element={<Only role="management"><DepartmentAnalytics /></Only>} />
            <Route path="analytics/faculty" element={<Only role="management"><FacultyPerformance /></Only>} />
            <Route path="analytics/participation" element={<Only role="management"><ParticipationAnalytics /></Only>} />
            <Route path="approvals" element={<Only role="management"><Approvals /></Only>} />
            <Route path="faculty" element={<Only role="management"><FacultyDirectory /></Only>} />
            <Route path="faculty/new" element={<Only role="management"><FacultyForm /></Only>} />
            <Route path="faculty/:id" element={<Only role="management"><ProfileRoute /></Only>} />
            <Route path="faculty/:id/edit" element={<Only role="management"><FacultyForm /></Only>} />
            <Route path="faculty/:id/biodata" element={<Only role="management"><BiodataView /></Only>} />
            <Route path="faculty/:id/biodata/edit" element={<Only role="management"><BiodataEdit /></Only>} />
            <Route path="settings" element={<Only role="management"><InstitutionSettings /></Only>} />
            <Route path="settings/targets" element={<Only role="management"><TargetSettings /></Only>} />
            <Route path="settings/notices" element={<Only role="management"><NoticeSettings /></Only>} />

            {/* IT Admin (platform level) */}
            <Route path="admin/users" element={<Only role="it_admin"><AdminUsers /></Only>} />
            <Route path="admin/institutions" element={<Only role="it_admin"><AdminInstitutions /></Only>} />
            <Route path="admin/audit" element={<Only role="it_admin"><AdminAudit /></Only>} />
            <Route path="*" element={<Panel><Alert kind="error">Page not found.</Alert></Panel>} />
          </Route>
        </Routes>
       </ErrorBoundary>
      </ToastProvider>
    </HashRouter>
  );
}
