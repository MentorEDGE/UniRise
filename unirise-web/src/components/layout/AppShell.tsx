import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Award, BarChart3, BookOpen, CheckSquare, Coins, FolderKanban, GitMerge, GraduationCap, Home, LayoutDashboard, LogOut, Network, Server, Settings, ShieldCheck, Sprout, TrendingUp, UserCog, UserRoundSearch, Users, UsersRound } from "lucide-react";
import { Logo } from "./Logo";
import { ThemeToggle } from "./ThemeToggle";
import { Button } from "@/components/ui/button";
import { useAuth, roleSets } from "@/app/auth";
import { useTenantSettings } from "@/app/tenant";
import { api } from "@/lib/api";
import type { Role, User } from "@/lib/types";
import { cn, initials } from "@/lib/utils";

interface Item { to: string; label: string; icon: typeof Home; roles?: Role[]; show?: (u: User) => boolean; badge?: boolean }
const items: Item[] = [
  { to: "/", label: "Home", icon: Home },
  { to: "/my-progress", label: "My progress", icon: GraduationCap, roles: ["RESEARCHER"], show: (u) => !!u.isScholar },
  { to: "/mentees", label: "My mentees", icon: UsersRound, roles: ["SUPERVISOR"] },
  { to: "/units", label: "Units", icon: LayoutDashboard, roles: roleSets.overview },
  { to: "/publications", label: "Publications", icon: BookOpen, roles: roleSets.research },
  { to: "/people", label: "People", icon: Users, roles: roleSets.overview },
  { to: "/grants", label: "Grants", icon: Coins, roles: roleSets.research },
  { to: "/seed-money", label: "Seed money", icon: Sprout, roles: roleSets.research },
  { to: "/awards", label: "Awards", icon: Award, roles: roleSets.research },
  { to: "/projects", label: "Projects", icon: FolderKanban, roles: roleSets.research },
  { to: "/lookup", label: "Find researcher", icon: UserRoundSearch, roles: roleSets.research },
  { to: "/analytics", label: "Analytics", icon: TrendingUp, roles: roleSets.overview },
  { to: "/reports", label: "Reports", icon: BarChart3, roles: roleSets.overview },
  { to: "/review", label: "Review", icon: CheckSquare, roles: [...roleSets.claimants, "HOD", "DEAN"], badge: true },
  { to: "/supervision", label: "Supervision", icon: UserCog, roles: ["RESEARCH_ADMIN", "HOD", "DEAN"] },
  { to: "/duplicates", label: "Duplicates", icon: GitMerge, roles: roleSets.reviewers },
  { to: "/organisation", label: "Organisation", icon: Network, roles: ["RESEARCH_ADMIN"] },
  { to: "/access", label: "Roles and access", icon: ShieldCheck, roles: [...roleSets.accessAdmin, "HOD", "DEAN"] },
  { to: "/platform", label: "Platform", icon: Server, roles: ["PLATFORM_ADMIN"] },
  { to: "/settings", label: "Settings", icon: Settings, roles: roleSets.accessAdmin },
];

export function AppShell() {
  const { user, signOut } = useAuth();
  const nav = useNavigate();
  const visible = items.filter((i) => !i.roles || (user && i.roles.includes(user.role) && (!i.show || i.show(user))));
  const tenant = useTenantSettings();
  const operator = user?.role === "PLATFORM_ADMIN";
  const { data: summary } = useQuery({ queryKey: ["summary"], queryFn: api.summary, enabled: !!user && roleSets.research.includes(user.role) });
  const pending = summary?.pendingReview ?? 0;

  const link = (i: Item, mobile = false) => (
    <NavLink
      key={i.to}
      to={i.to}
      end={i.to === "/"}
      className={({ isActive }) =>
        cn(
          "relative flex items-center gap-3 rounded-xl text-sm font-medium transition-colors duration-200",
          mobile ? "min-w-[4.5rem] flex-1 shrink-0 flex-col gap-1 py-2 text-[10px]" : "px-3 py-2.5",
          isActive ? "bg-secondary text-primary" : "text-foreground/75 hover:bg-secondary/60 hover:text-foreground",
          !mobile && isActive && "before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-full before:bg-primary",
        )
      }
    >
      <i.icon className="size-5" aria-hidden />
      <span>{i.label}</span>
      {i.badge && pending > 0 && (
        <span className={cn("grid min-w-5 place-items-center rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground", mobile ? "absolute right-3 top-1" : "ml-auto")} aria-label={`${pending} pending`}>{pending}</span>
      )}
    </NavLink>
  );

  return (
    <div className="min-h-screen">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[70] focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground">Skip to content</a>
      <header className="sticky top-0 z-40 flex h-16 w-full items-center gap-4 border-b border-border/70 bg-background/85 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/70 md:px-8">
        <NavLink to="/" aria-label="UniRise home"><Logo /></NavLink>
        <span className="ml-2 hidden items-center gap-2 rounded-full border border-border py-1 pl-1 pr-3 text-xs font-medium text-muted-foreground md:inline-flex">
          <span className="grid h-6 min-w-6 place-items-center rounded-full bg-primary px-1.5 text-[10px] font-bold text-primary-foreground" aria-hidden>{operator ? "RP" : tenant.data?.logoText || initials(user?.institution ?? "")}</span>
          {operator ? user?.institution : tenant.data?.name ?? user?.institution}
        </span>
        <div className="ml-auto flex items-center gap-3">
          <ThemeToggle />
          <div className="hidden items-center gap-3 md:flex">
            <div className="text-right leading-tight">
              <div className="text-sm font-semibold">{user?.name}</div>
              <div className="text-xs capitalize text-muted-foreground">{user?.isScholar ? "PhD scholar" : user?.role.replace("_", " ").toLowerCase()}</div>
            </div>
            <div className="grid size-9 place-items-center rounded-full bg-secondary text-xs font-bold text-primary" aria-hidden>{initials(user?.name.replace("Dr. ", "") ?? "")}</div>
          </div>
          <Button variant="secondary" size="icon" aria-label="Sign out" className="rounded-md" onClick={async () => { await signOut(); nav("/sign-in"); }}><LogOut /></Button>
        </div>
      </header>

      <div className="mx-auto flex max-w-[90rem]">
        <aside className="sticky top-16 hidden h-[calc(100vh-4rem)] w-60 shrink-0 flex-col gap-1 border-r border-border/70 p-4 md:flex" aria-label="Primary">
          {visible.map((i) => link(i))}
        </aside>
        <main id="main" className="min-w-0 flex-1 px-4 pb-28 pt-8 md:px-10 md:pb-16 md:pt-10">
          <Outlet />
        </main>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-40 flex overflow-x-auto border-t border-border/70 bg-background/90 px-2 backdrop-blur md:hidden" aria-label="Primary mobile">
        {visible.map((i) => link(i, true))}
      </nav>
    </div>
  );
}
