import { lazy, Suspense } from "react";
import { Link, Navigate, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "./theme";
import { AuthProvider, RequireAuth, roleSets, useAuth } from "./auth";
import { ToastProvider } from "@/components/ui/toast";
import { AppShell } from "@/components/layout/AppShell";
import { Skeleton } from "@/components/ui/feedback";
import { HttpError } from "@/lib/http";

const SignIn = lazy(() => import("@/features/auth/SignIn"));
const Dashboard = lazy(() => import("@/features/dashboard/Dashboard"));
const Publications = lazy(() => import("@/features/publications/Publications"));
const PublicationForm = lazy(() => import("@/features/publications/PublicationForm"));
const People = lazy(() => import("@/features/people/People"));
const Organisation = lazy(() => import("@/features/organisation/Organisation"));
const Profile = lazy(() => import("@/features/people/Profile"));
const MyProgress = lazy(() => import("@/features/progress/MyProgress"));
const MenteeList = lazy(() => import("@/features/mentees/Mentees"));
const MenteeDetail = lazy(() => import("@/features/mentees/Mentees").then((m) => ({ default: m.MenteeDetail })));
const Units = lazy(() => import("@/features/units/Units"));
const Awards = lazy(() => import("@/features/awards/Awards"));
const Review = lazy(() => import("@/features/review/ReviewQueue"));
const ReportList = lazy(() => import("@/features/reports/Reports").then((m) => ({ default: m.ReportList })));
const ReportView = lazy(() => import("@/features/reports/Reports").then((m) => ({ default: m.ReportView })));
const Grants = lazy(() => import("@/features/grants/Grants"));
const GrantWizard = lazy(() => import("@/features/grants/GrantWizard"));
const SeedMoney = lazy(() => import("@/features/seedmoney/SeedMoney"));
const SeedMoneyForm = lazy(() => import("@/features/seedmoney/SeedMoneyForm"));
const SeedMoneyReport = lazy(() => import("@/features/seedmoney/SeedMoneyReport"));
const Lookup = lazy(() => import("@/features/lookup/Lookup"));
const Settings = lazy(() => import("@/features/settings/Settings"));
const Duplicates = lazy(() => import("@/features/duplicates/Duplicates"));
const Supervision = lazy(() => import("@/features/people/Supervision"));
const AccessAdmin = lazy(() => import("@/features/access/AccessAdmin"));
const GuestHome = lazy(() => import("@/features/access/GuestHome"));
const Platform = lazy(() => import("@/features/platform/Platform"));
const PublicProfilePage = lazy(() => import("@/features/public/PublicProfilePage"));
const Projects = lazy(() => import("@/features/projects/Projects"));
const ProjectDetail = lazy(() => import("@/features/projects/ProjectDetail"));

/** Each role lands on the home that fits its job. */
function Home() {
  const { user } = useAuth();
  if (user?.role === "GUEST") return <GuestHome />;
  if (user?.role === "PLATFORM_ADMIN") return <Navigate to="/platform" replace />;
  if (user?.role === "IT_ADMIN") return <Navigate to="/access" replace />;
  return <Dashboard />;
}
const R = roleSets.research;

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // Retry only transient failures; never retry auth/permission/not-found.
      retry: (n, e) => !(e instanceof HttpError && [400, 401, 403, 404, 409].includes(e.status)) && n < 2,
      refetchOnWindowFocus: false,
    },
  },
});

function Message({ code, title, text }: { code: string; title: string; text: string }) {
  return (
    <div className="grid min-h-[60vh] place-items-center text-center">
      <div><p className="eyebrow mb-3">{code}</p><h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        <p className="mx-auto mt-3 max-w-md text-muted-foreground">{text}</p>
        <Link to="/" className="mt-6 inline-flex h-10 items-center rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground">Back to home</Link></div>
    </div>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <ToastProvider>
            <Suspense fallback={<div className="p-10"><Skeleton className="h-10 w-64" /></div>}>
              <Routes>
                <Route path="/sign-in" element={<SignIn />} />
                <Route path="/public" element={<PublicProfilePage />} />
                <Route path="/public/:id" element={<PublicProfilePage />} />
                <Route element={<RequireAuth><AppShell /></RequireAuth>}>
                  <Route index element={<Home />} />
                  <Route path="publications" element={<RequireAuth roles={R}><Publications /></RequireAuth>} />
                  <Route path="publications/:id" element={<RequireAuth roles={R}><PublicationForm /></RequireAuth>} />
                  <Route path="people" element={<RequireAuth roles={roleSets.overview}><People /></RequireAuth>} />
                  <Route path="people/:id" element={<RequireAuth roles={R}><Profile /></RequireAuth>} />
                  <Route path="organisation" element={<RequireAuth roles={["RESEARCH_ADMIN"]}><Organisation /></RequireAuth>} />
                  <Route path="units" element={<RequireAuth roles={roleSets.overview}><Units /></RequireAuth>} />
                  <Route path="my-progress" element={<RequireAuth roles={["RESEARCHER"]}><MyProgress /></RequireAuth>} />
                  <Route path="mentees" element={<RequireAuth roles={["SUPERVISOR"]}><MenteeList /></RequireAuth>} />
                  <Route path="mentees/:id" element={<RequireAuth roles={["SUPERVISOR"]}><MenteeDetail /></RequireAuth>} />
                  <Route path="grants" element={<RequireAuth roles={R}><Grants /></RequireAuth>} />
                  <Route path="grants/:id" element={<RequireAuth roles={R}><GrantWizard /></RequireAuth>} />
                  <Route path="seed-money" element={<RequireAuth roles={R}><SeedMoney /></RequireAuth>} />
                  <Route path="seed-money/report" element={<RequireAuth roles={R}><SeedMoneyReport /></RequireAuth>} />
                  <Route path="seed-money/:id" element={<RequireAuth roles={R}><SeedMoneyForm /></RequireAuth>} />
                  <Route path="lookup" element={<RequireAuth roles={R}><Lookup /></RequireAuth>} />
                  <Route path="awards" element={<RequireAuth roles={R}><Awards /></RequireAuth>} />
                  <Route path="review" element={<RequireAuth roles={roleSets.claimants}><Review /></RequireAuth>} />
                  <Route path="reports" element={<RequireAuth roles={roleSets.overview}><ReportList /></RequireAuth>} />
                  <Route path="reports/:slug" element={<RequireAuth roles={roleSets.overview}><ReportView /></RequireAuth>} />
                  <Route path="settings" element={<RequireAuth roles={roleSets.accessAdmin}><Settings /></RequireAuth>} />
                  <Route path="duplicates" element={<RequireAuth roles={roleSets.reviewers}><Duplicates /></RequireAuth>} />
                  <Route path="supervision" element={<RequireAuth roles={["RESEARCH_ADMIN", "HOD", "DEAN"]}><Supervision /></RequireAuth>} />
                  <Route path="access" element={<RequireAuth roles={roleSets.accessAdmin}><AccessAdmin /></RequireAuth>} />
                  <Route path="platform" element={<RequireAuth roles={["PLATFORM_ADMIN"]}><Platform /></RequireAuth>} />
                  <Route path="projects" element={<RequireAuth roles={R}><Projects /></RequireAuth>} />
                  <Route path="projects/:id" element={<RequireAuth roles={R}><ProjectDetail /></RequireAuth>} />
                  <Route path="forbidden" element={<Message code="403" title="You don't have access" text="Ask your research office administrator if you need this area." />} />
                  <Route path="*" element={<Message code="404" title="Page not found" text="That page doesn't exist or has moved." />} />
                </Route>
              </Routes>
            </Suspense>
          </ToastProvider>
        </AuthProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
