import {
  accessLog, apiKeys, appointments, auditLog, awards, classificationSchemes, disputes, grants, harvestRuns, meetings, milestones, orgUnits, periods, projects, publications,
  relationships, researchers, roleGrants, savedReports, seedProposals, seedWindow, suggestions, tenants, tenantSettings, webhooks, daysFromNow,
} from "./seed";
import type {
  AccessLogEntry, ApiKeyRow, Appointment, AuditEntry, Award, ClassificationScheme, Dispute, Grant, HarvestRun, MeetingLog, Milestone, OrgUnit, Period, Project, Publication,
  Relationship, Researcher, RoleGrant, SavedReport, SeedProposal, SeedWindow, Suggestion, Tenant, TenantSettings, UnitSnapshot, User, Webhook,
} from "@/lib/types";

// In-memory sample data so the UI runs without a backend (VITE_USE_MOCK=true).
const fresh = () => ({
  orgUnits: structuredClone(orgUnits) as OrgUnit[],
  researchers: structuredClone(researchers) as Researcher[],
  publications: structuredClone(publications) as Publication[],
  awards: structuredClone(awards) as Award[],
  suggestions: structuredClone(suggestions) as Suggestion[],
  relationships: structuredClone(relationships) as Relationship[],
  milestones: structuredClone(milestones) as Milestone[],
  meetings: structuredClone(meetings) as MeetingLog[],
  grants: structuredClone(grants) as Grant[],
  seedProposals: structuredClone(seedProposals) as SeedProposal[],
  seedWindow: structuredClone(seedWindow) as SeedWindow,
  appointments: structuredClone(appointments) as Appointment[],
  roleGrants: structuredClone(roleGrants) as RoleGrant[],
  auditLog: structuredClone(auditLog) as AuditEntry[],
  accessLog: structuredClone(accessLog) as AccessLogEntry[],
  disputes: structuredClone(disputes) as Dispute[],
  dismissedDuplicates: [] as string[],
  periods: structuredClone(periods) as Period[],
  snapshots: [] as UnitSnapshot[],
  settings: structuredClone(tenantSettings) as TenantSettings,
  classification: structuredClone(classificationSchemes) as ClassificationScheme[],
  apiKeys: structuredClone(apiKeys) as ApiKeyRow[],
  webhooks: structuredClone(webhooks) as Webhook[],
  harvestRuns: structuredClone(harvestRuns) as HarvestRun[],
  tenants: structuredClone(tenants) as Tenant[],
  projects: structuredClone(projects) as Project[],
  savedReports: structuredClone(savedReports) as SavedReport[],
  nextId: {
    orgUnit: 100, researcher: 100, publication: 1000, award: 100, grant: 100, seed: 100, milestone: 1000, meeting: 1000, relationship: 1000, appointment: 1000,
    grantRole: 1000, audit: 1000, access: 1000, dispute: 1000, period: 100, scheme: 100, apiKey: 100, webhook: 100, harvest: 100, tenant: 100, project: 100, saved: 100, suggestion: 100,
  },
});
export const db = fresh();
/** Restores the sample data; tests call this between cases. */
export function resetDb() { Object.assign(db, fresh()); }
void daysFromNow;

const institution = "Demo University";
export const demoUsers: Record<string, User> = {
  admin: { id: 1, name: "Research Office Admin", email: "admin@university.example", role: "RESEARCH_ADMIN", institution },
  executive: { id: 5, name: "Pro-VC (Research)", email: "provc.research@university.example", role: "EXECUTIVE", scopeUnitId: 10, institution },
  dean: { id: 2, name: "Dr. Rohan Mehta", email: "dean.sciences@university.example", role: "DEAN", scopeUnitId: 11, researcherId: 4, institution },
  hod: { id: 6, name: "Dr. Priya Desai", email: "hod.mech@university.example", role: "HOD", scopeUnitId: 3, researcherId: 7, institution },
  supervisor: { id: 7, name: "Dr. Vikram Shah", email: "vikram.shah@university.example", role: "SUPERVISOR", researcherId: 2, institution },
  researcher: { id: 3, name: "Dr. Ananya Rao", email: "ananya.rao@university.example", role: "RESEARCHER", researcherId: 1, institution },
  scholar: { id: 8, name: "Aditi Kapoor", email: "aditi.kapoor@university.example", role: "RESEARCHER", researcherId: 13, isScholar: true, institution },
  viewer: { id: 4, name: "Registrar (read-only)", email: "viewer@university.example", role: "VIEWER", institution },
  acting: { id: 9, name: "Dr. Arjun Menon (acting HoD)", email: "arjun.menon@university.example", role: "HOD", scopeUnitId: 3, researcherId: 8, institution, actingAs: { role: "HOD", scopeUnitId: 3, until: daysFromNow(25) } },
  itadmin: { id: 10, name: "IT Administrator", email: "it.admin@university.example", role: "IT_ADMIN", institution },
  guest: { id: 11, name: "A. Fischer (external examiner)", email: "a.fischer@examiner.example", role: "GUEST", institution, expiresOn: daysFromNow(11), guestItem: { kind: "report", ref: "pub-university", label: "University-wide publications by year" } },
  platform: { id: 12, name: "Platform operator", email: "operator@rms-platform.example", role: "PLATFORM_ADMIN", institution: "RMS Platform" },
};
