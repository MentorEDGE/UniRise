import { Suspense, lazy, useState } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Skeleton } from "@/components/ui/feedback";
import { useAuth } from "@/app/auth";
import { cn } from "@/lib/utils";
import type { Role } from "@/lib/types";

const UsersTab = lazy(() => import("./tabs/UsersTab"));
const TenantTab = lazy(() => import("./tabs/TenantTab"));
const SsoTab = lazy(() => import("./tabs/SsoTab"));
const ClassificationTab = lazy(() => import("./tabs/ClassificationTab"));
const HarvestTab = lazy(() => import("./tabs/HarvestTab"));
const IntegrationsTab = lazy(() => import("./tabs/IntegrationsTab"));
const AuditTab = lazy(() => import("./tabs/AuditTab"));
const AccessLogTab = lazy(() => import("./tabs/AccessLogTab"));

type TabId = "users" | "tenant" | "sso" | "classification" | "harvest" | "integrations" | "audit" | "access-log";
const tabs: { id: TabId; label: string; roles?: Role[]; View: React.ComponentType }[] = [
  { id: "users", label: "Users and roles", View: UsersTab },
  { id: "tenant", label: "Tenant settings", roles: ["RESEARCH_ADMIN"], View: TenantTab },
  { id: "sso", label: "Single sign-on", View: SsoTab },
  { id: "classification", label: "Classification lists", roles: ["RESEARCH_ADMIN"], View: ClassificationTab },
  { id: "harvest", label: "Harvest and ORCID", roles: ["RESEARCH_ADMIN"], View: HarvestTab },
  { id: "integrations", label: "API keys and webhooks", View: IntegrationsTab },
  { id: "audit", label: "Audit log", View: AuditTab },
  { id: "access-log", label: "Access log", View: AccessLogTab },
];

/** IT admins manage access and see the logs; they never see research content. */
export default function Settings() {
  const { user } = useAuth();
  const visible = tabs.filter((t) => !t.roles || (user && t.roles.includes(user.role)));
  const [tab, setTab] = useState<TabId>(visible[0].id);
  const Active = (visible.find((t) => t.id === tab) ?? visible[0]).View;
  return (
    <div>
      <PageHeader eyebrow="Administration" title="Settings" description="Tenant settings, sign-in, integrations and the logs. This is sample data until a backend is connected." />
      <div className="mb-6 flex flex-wrap gap-1 rounded-2xl border bg-card p-1" role="tablist">
        {visible.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
            className={cn("rounded-xl px-4 py-2 text-sm font-semibold transition-colors", tab === t.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary")}>{t.label}</button>))}
      </div>
      <Suspense fallback={<Skeleton className="h-48 w-full" />}><Active /></Suspense>
    </div>
  );
}
