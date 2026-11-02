import { useEffect, useRef, useState } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Mail, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import { Logo } from "@/components/layout/Logo";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { useAuth } from "@/app/auth";
import { USE_MOCK, api } from "@/lib/api";
import { HttpError } from "@/lib/http";
import type { SignInLink } from "@/mock/ext/tenant";

const demo = [
  { role: "admin", label: "Research Office Admin", note: "Everything in the institution" },
  { role: "executive", label: "Pro-VC (Research)", note: "University-wide rollups across schools" },
  { role: "dean", label: "Dean, School of Sciences", note: "Biotechnology and Physics" },
  { role: "hod", label: "HoD, Mechanical Engineering", note: "Own department only" },
  { role: "supervisor", label: "Supervisor", note: "Own work plus mentees' progress" },
  { role: "researcher", label: "Researcher", note: "Own profile and claims" },
  { role: "scholar", label: "PhD scholar", note: "Own milestones and outputs" },
  { role: "viewer", label: "Viewer", note: "Read-only dashboard" },
  { role: "acting", label: "Acting HoD", note: "Covers the HoD role until a set date" },
  { role: "itadmin", label: "IT administrator", note: "Access settings and logs, no research content" },
  { role: "guest", label: "External examiner (guest)", note: "One shared report, for a limited time" },
  { role: "platform", label: "Platform operator", note: "Manages customer tenants only" },
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function SignIn() {
  const { user, signIn } = useAuth();
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [link, setLink] = useState<SignInLink | null>(null);
  const [linkBusy, setLinkBusy] = useState<"request" | "open" | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const tokenTried = useRef(false);
  const rawNext = sp.get("next");
  // Only same-origin paths; blocks open redirects such as //evil.com
  const next = rawNext && rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/";
  const urlToken = sp.get("token");

  const openToken = async (token: string) => {
    setLinkBusy("open"); setLinkError(null);
    try {
      const u = await api.signInWithLink(token);
      qc.setQueryData(["me"], u);
      nav(next, { replace: true });
    } catch (e) {
      setLinkBusy(null);
      setLinkError(e instanceof HttpError && e.status === 410 ? "This link has expired or was already used. Request a new one." : "We couldn't sign you in with that link. Try again.");
    }
  };
  // A link opened from an email carries ?token=. The ref keeps React's double effect from spending a single-use link twice.
  useEffect(() => {
    if (urlToken && !user && !tokenTried.current) { tokenTried.current = true; void openToken(urlToken); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlToken, user]);

  if (user) return <Navigate to={next} replace />;

  const go = async (role: string) => {
    setBusy(role);
    await signIn(role);
    nav(next, { replace: true });
  };

  const requestLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setLinkError(null); setLink(null);
    if (!EMAIL_RE.test(email.trim())) { setEmailError("Enter a full email address, like name@university.edu"); return; }
    setEmailError(null); setLinkBusy("request");
    try { setLink(await api.requestSignInLink(email)); }
    catch (err) { setEmailError(err instanceof HttpError && err.status === 404 ? "That email isn't one of the demo accounts. Use one from the list, like admin@university.example." : "Couldn't create a link. Try again."); }
    finally { setLinkBusy(null); }
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
            <ShieldCheck /> {USE_MOCK ? "Demo sign-in" : "Continue with SSO"}
          </Button>
          {USE_MOCK && <p className="mt-2 text-center text-xs text-muted-foreground">Single sign-on replaces this in production.</p>}
          {linkError && <p role="alert" className="mt-4 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm">{linkError}</p>}
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
              <form onSubmit={requestLink} noValidate className="mt-8 space-y-3 border-t pt-6" aria-labelledby="link-h">
                <p id="link-h" className="eyebrow !text-xs">Sandbox tenants · sign-in link</p>
                <label htmlFor="link-email" className="text-sm font-medium">Email address</label>
                <Input id="link-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)}
                  placeholder="admin@university.example" aria-invalid={emailError ? true : undefined} aria-describedby="link-email-d" />
                <p id="link-email-d" className={emailError ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>{emailError ?? "Works for the demo accounts only. Real staff always use single sign-on."}</p>
                <Button type="submit" variant="secondary" className="w-full" loading={linkBusy === "request"}><Mail /> Email me a sign-in link (sandbox tenants)</Button>
                {link && (
                  <div role="status" className="space-y-2 rounded-xl border bg-secondary/60 p-3 text-sm">
                    <p className="font-semibold">Sample: this link would be emailed to you</p>
                    <p className="break-all text-xs text-muted-foreground">{link.link}</p>
                    <p className="text-xs text-muted-foreground">It works once and expires in {link.expiresInMinutes} minutes.</p>
                    <Button size="sm" loading={linkBusy === "open"} onClick={() => openToken(new URL(link.link).searchParams.get("token") ?? "")}>Open link</Button>
                  </div>)}
              </form>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
