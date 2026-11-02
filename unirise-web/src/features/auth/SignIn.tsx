import { useState } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/layout/Logo";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { useAuth } from "@/app/auth";
import { USE_MOCK } from "@/lib/api";

const demo = [
  { role: "admin", label: "Research Office Admin", note: "Everything in the institution" },
  { role: "executive", label: "Pro-VC (Research)", note: "University-wide rollups across schools" },
  { role: "dean", label: "Dean, School of Sciences", note: "Biotechnology and Physics" },
  { role: "hod", label: "HoD, Mechanical Engineering", note: "Own department only" },
  { role: "supervisor", label: "Supervisor", note: "Own work plus mentees' progress" },
  { role: "researcher", label: "Researcher", note: "Own profile and claims" },
  { role: "scholar", label: "PhD scholar", note: "Own milestones and outputs" },
  { role: "viewer", label: "Viewer", note: "Read-only dashboard" },
];

export default function SignIn() {
  const { user, signIn } = useAuth();
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const [busy, setBusy] = useState<string | null>(null);
  const rawNext = sp.get("next");
  // Only same-origin paths; blocks open redirects such as //evil.com
  const next = rawNext && rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/";
  if (user) return <Navigate to={next} replace />;

  const go = async (role: string) => {
    setBusy(role);
    await signIn(role);
    nav(next, { replace: true });
  };

  return (
    <div className="relative min-h-screen overflow-hidden">
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        <div className="absolute inset-0 bg-gradient-to-b from-white/60 via-white/75 to-white dark:from-background/60 dark:via-background/80 dark:to-background" />
        <div className="absolute -left-32 -top-32 h-80 w-80 rounded-full bg-primary/20 blur-3xl" />
        <div className="absolute -right-40 top-0 h-96 w-96 rounded-full bg-fuchsia-400/20 blur-3xl dark:bg-violet-600/10" />
      </div>
      <header className="relative z-10 flex h-16 items-center justify-between px-4 md:px-10">
        <Logo />
        <ThemeToggle />
      </header>
      <main className="relative z-10 mx-auto grid max-w-6xl gap-12 px-4 pb-16 pt-10 md:grid-cols-[1.3fr_1fr] md:pt-20">
        <section className="animate-fade-up">
          <p className="eyebrow mb-4">UniRise · For Universities &amp; Research Institutions</p>
          <h1 className="text-4xl font-semibold tracking-tight text-slate-900 dark:text-white md:text-5xl lg:text-6xl">
            A connected framework for institutional research growth
          </h1>
          <p className="mt-6 max-w-2xl text-base leading-relaxed text-slate-600 dark:text-slate-300 md:text-lg">
            One place for your researchers, publications, awards and reports. Publications are harvested for you; faculty only confirm them.
          </p>
          <ul className="mt-8 grid gap-3 text-sm sm:grid-cols-2">
            {["Customized Research Support", "Industry Partnerships", "Analytics & Insights", "Research Management System"].map((t) => (
              <li key={t} className="surface-card surface-card-hover px-5 py-4 font-medium">{t}</li>
            ))}
          </ul>
        </section>

        <section className="surface-card h-fit p-6 md:p-8" aria-labelledby="signin-h">
          <h2 id="signin-h" className="text-xl font-semibold tracking-tight">Sign in</h2>
          <p className="mt-1 text-sm text-muted-foreground">Use your university single sign-on.</p>
          <Button size="lg" pill className="mt-6 w-full" onClick={() => go("admin")} loading={busy === "admin"}>
            <ShieldCheck /> Continue with SSO
          </Button>
          {USE_MOCK && (
            <div className="mt-8">
              <p className="eyebrow mb-3 !text-xs">Demo mode · pick a role</p>
              <div className="space-y-2">
                {demo.map((d) => (
                  <button
                    key={d.role}
                    onClick={() => go(d.role)}
                    disabled={!!busy}
                    className="group flex w-full items-center justify-between rounded-xl border bg-background px-4 py-3 text-left transition-all duration-200 hover:border-violet-300 hover:bg-secondary/60 disabled:opacity-50"
                  >
                    <span>
                      <span className="block text-sm font-semibold">{d.label}</span>
                      <span className="block text-xs text-muted-foreground">{d.note}</span>
                    </span>
                    <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-1" aria-hidden />
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
