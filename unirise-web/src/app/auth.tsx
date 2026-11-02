import { createContext, useContext, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Navigate, useLocation } from "react-router-dom";
import { api } from "@/lib/api";
import type { Role, User } from "@/lib/types";
import { Skeleton } from "@/components/ui/feedback";

interface AuthValue { user: User | null; signIn: (role: string) => Promise<void>; signOut: () => Promise<void> }
const Ctx = createContext<AuthValue>({ user: null, signIn: async () => {}, signOut: async () => {} });
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["me"], queryFn: api.me, staleTime: Infinity, retry: false });
  const value: AuthValue = {
    user: data ?? null,
    signIn: async (role) => { const u = await api.signIn(role); qc.setQueryData(["me"], u); },
    signOut: async () => { await api.signOut(); qc.clear(); qc.setQueryData(["me"], null); },
  };
  if (isLoading) return <div className="p-10"><Skeleton className="h-10 w-64" /></div>;
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Convenience only; the server remains the authority on access. */
export function RequireAuth({ roles, children }: { roles?: Role[]; children: ReactNode }) {
  const { user } = useAuth();
  const loc = useLocation();
  if (!user) return <Navigate to={`/sign-in?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/forbidden" replace />;
  return <>{children}</>;
}

export const roleSets: Record<"overview" | "claimants" | "research" | "accessAdmin" | "reviewers", Role[]> = {
  /** Everyone who sees research content. IT admin, guest and platform operator do not (PRD R3). */
  research: ["RESEARCH_ADMIN", "EXECUTIVE", "DEAN", "HOD", "SUPERVISOR", "RESEARCHER", "VIEWER"],
  /** Roles and access, audit and access logs, SSO status. */
  accessAdmin: ["RESEARCH_ADMIN", "IT_ADMIN"],
  /** People who can validate, merge and resolve. */
  reviewers: ["RESEARCH_ADMIN", "HOD", "DEAN"],
  /** People, Reports and Units: whole-tenant or unit-level views. */
  overview: ["RESEARCH_ADMIN", "EXECUTIVE", "DEAN", "HOD", "VIEWER"],
  /** Review queue and editing own work. */
  claimants: ["RESEARCH_ADMIN", "RESEARCHER", "SUPERVISOR"],
};

export const can = {
  edit: (r?: Role) => !!r && roleSets.claimants.includes(r),
  admin: (r?: Role) => r === "RESEARCH_ADMIN",
  accessAdmin: (r?: Role) => r === "RESEARCH_ADMIN" || r === "IT_ADMIN",
  review: (r?: Role) => r === "RESEARCH_ADMIN" || r === "HOD" || r === "DEAN",
};
