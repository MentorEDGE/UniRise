import { lazy, Suspense } from "react";
import { Link, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "./theme";
import { AuthProvider, RequireAuth, roleSets } from "./auth";
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
                <Route element={<RequireAuth><AppShell /></RequireAuth>}>
                  <Route index element={<Dashboard />} />
                  <Route path="publications" element={<Publications />} />
                  <Route path="publications/:id" element={<PublicationForm />} />
                  <Route path="people" element={<RequireAuth roles={roleSets.overview}><People /></RequireAuth>} />
                  <Route path="people/:id" element={<Profile />} />
                  <Route path="organisation" element={<RequireAuth roles={["RESEARCH_ADMIN"]}><Organisation /></RequireAuth>} />
                  <Route path="units" element={<RequireAuth roles={roleSets.overview}><Units /></RequireAuth>} />
                  <Route path="my-progress" element={<RequireAuth roles={["RESEARCHER"]}><MyProgress /></RequireAuth>} />
                  <Route path="mentees" element={<RequireAuth roles={["SUPERVISOR"]}><MenteeList /></RequireAuth>} />
                  <Route path="mentees/:id" element={<RequireAuth roles={["SUPERVISOR"]}><MenteeDetail /></RequireAuth>} />
                  <Route path="grants" element={<Grants />} />
                  <Route path="grants/:id" element={<GrantWizard />} />
                  <Route path="seed-money" element={<SeedMoney />} />
                  <Route path="seed-money/report" element={<SeedMoneyReport />} />
                  <Route path="seed-money/:id" element={<SeedMoneyForm />} />
                  <Route path="lookup" element={<Lookup />} />
                  <Route path="awards" element={<Awards />} />
                  <Route path="review" element={<RequireAuth roles={roleSets.claimants}><Review /></RequireAuth>} />
                  <Route path="reports" element={<RequireAuth roles={roleSets.overview}><ReportList /></RequireAuth>} />
                  <Route path="reports/:slug" element={<RequireAuth roles={roleSets.overview}><ReportView /></RequireAuth>} />
                  <Route path="settings" element={<RequireAuth roles={["RESEARCH_ADMIN"]}><Settings /></RequireAuth>} />
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
