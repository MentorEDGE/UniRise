import { awards, grants, meetings, milestones, orgUnits, publications, relationships, researchers, seedProposals, seedWindow, suggestions } from "./seed";
import type { Award, Grant, MeetingLog, Milestone, OrgUnit, Publication, Relationship, Researcher, SeedProposal, SeedWindow, Suggestion, User } from "@/lib/types";

// In-memory sample data so the UI runs without a backend (VITE_USE_MOCK=true).
export const db = {
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
  nextId: { orgUnit: 100, researcher: 100, publication: 1000, award: 100, grant: 100, seed: 100 },
};

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
};
