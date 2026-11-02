// Feature slice "quality": duplicates and merge (R13), disputes (R30), open access (R14), review queue (R12), version conflicts (§5), harvest (R11).
// Sample-data (mock) and server (real) versions of its API calls. Keys must match between the two.
import { HttpError, http, qs } from "@/lib/http";
import { db } from "@/mock/store";
import { audit, mockUser, noResearchContent, nowIso, requireRole, scopeIds, today, wait } from "@/mock/helpers";
import type { DuplicatePair, Dispute, HarvestRun, Page, PubAuthor, Publication, PublicationFilters, Researcher, Suggestion, User, VerificationState } from "@/lib/types";

/* ------------------------------- shared helpers ------------------------------- */
/** Fields a reviewer may take from the record that is being merged away. */
export const MERGE_FIELDS = ["title", "doi", "venue", "type", "year", "month", "issn", "category", "oaStatus", "funderMandate", "repositoryUrl", "projectDetails"] as const;
export type MergeField = (typeof MERGE_FIELDS)[number];
export type MergeTake = Partial<Pick<Publication, MergeField>>;
export interface MergeRequest { survivorId: number; removedId: number; take?: MergeTake }
export interface DisputeRequest { publicationId: number; reason: string }
export interface ResolveRequest { id: number; outcome: "upheld" | "dismissed"; resolution: string }
export type SavePublicationInput = Omit<Publication, "id" | "state" | "source"> & { id?: number; expectedVersion?: number };
/** A 409 that can be told apart: "doi" (another record has this DOI), "version" (stale save) or "merged". */
export type ConflictReason = "doi" | "version" | "merged";
const conflict = (reason: ConflictReason) => Object.assign(new HttpError(409), { reason });

export const normaliseDoi = (d?: string) => (d ?? "").trim().toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, "");
export const normaliseTitle = (t: string) => t.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
const REVIEWERS = ["RESEARCH_ADMIN", "HOD", "DEAN"] as const;
const stateRank: Record<VerificationState, number> = { unverified: 0, suggested: 1, verified: 2 };
const storedVersion = (p: Publication) => p.version ?? 1;
const live = (p: Publication) => p.mergedInto === undefined;

const authorKey = (a: PubAuthor) => (a.researcherId !== undefined ? `r:${a.researcherId}` : `n:${a.name.trim().toLowerCase()}|${a.institution.trim().toLowerCase()}`);
/** Every author of a record as PubAuthor rows: the authors[] list plus any linked person only present in authorIds. */
export function authorRows(p: Publication, people: Pick<Researcher, "id" | "name" | "kind">[] = db.researchers): PubAuthor[] {
  const rows = [...(p.authors ?? [])];
  for (const id of p.authorIds) {
    if (rows.some((a) => a.researcherId === id)) continue;
    const r = people.find((x) => x.id === id);
    rows.push({ kind: r?.kind === "scholar" ? "internal-student" : "internal-faculty", researcherId: id, name: r?.name ?? `#${id}`, institution: "Demo University" });
  }
  return rows;
}
const sharesAuthor = (a: Publication, b: Publication) => {
  const keys = new Set(authorRows(a).map(authorKey));
  return authorRows(b).some((x) => keys.has(authorKey(x)));
};

/** The record that results from a merge. Used by the server call and by the preview in the UI, so both always agree. */
export function buildMerged(survivor: Publication, removed: Publication, take: MergeTake = {}): Publication {
  const out: Publication = { ...survivor };
  const o = out as unknown as Record<string, unknown>;
  const r = removed as unknown as Record<string, unknown>;
  for (const f of MERGE_FIELDS) {
    if (f in take && take[f] !== undefined) o[f] = r[f];
    else if (o[f] === undefined || o[f] === "") { if (r[f] !== undefined && r[f] !== "") o[f] = r[f]; } // never lose information a record has and the other lacks
  }
  out.authorIds = [...new Set([...survivor.authorIds, ...removed.authorIds])];
  if (survivor.authors || removed.authors) {
    const seen = new Set<string>();
    out.authors = [...authorRows(survivor), ...authorRows(removed)].filter((a) => { const k = authorKey(a); if (seen.has(k)) return false; seen.add(k); return true; });
  }
  if (stateRank[removed.state] > stateRank[survivor.state]) out.state = removed.state;
  return out;
}

const inScope = (ids: Set<number> | null, p: Publication) => !ids || p.authorIds.some((a) => ids.has(a));
function pairId(a: number, b: number) { return `${Math.min(a, b)}-${Math.max(a, b)}`; }

function findDuplicates(): DuplicatePair[] {
  const rows = db.publications.filter(live).sort((x, y) => x.id - y.id);
  const out: DuplicatePair[] = [];
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const a = rows[i], b = rows[j];
      const id = pairId(a.id, b.id);
      if (db.dismissedDuplicates.includes(id)) continue;
      const da = normaliseDoi(a.doi), dbb = normaliseDoi(b.doi);
      if (da && da === dbb) { out.push({ id, a, b, reason: "Same DOI", score: 1 }); continue; }
      if (normaliseTitle(a.title) && normaliseTitle(a.title) === normaliseTitle(b.title) && Math.abs(a.year - b.year) <= 1 && sharesAuthor(a, b)) {
        out.push({ id, a, b, reason: a.year === b.year ? "Same title, same year, shared author" : "Same title, years one apart, shared author", score: a.year === b.year ? 0.95 : 0.85 });
      }
    }
  }
  return out;
}

function reviewerScope(): { u: User; ids: Set<number> | null } {
  const u = requireRole(mockUser(), [...REVIEWERS]);
  return { u, ids: scopeIds(u) };
}
function visiblePairs() {
  const { ids } = reviewerScope();
  return findDuplicates().filter((p) => inScope(ids, p.a) || inScope(ids, p.b));
}

/* ----------------------------- review queue history ---------------------------- */
interface Decision { suggestion: Suggestion; index: number; decision: "confirm" | "reject"; before?: { state: VerificationState; authorIds: number[]; authors?: PubAuthor[]; version?: number } }
const history = new Map<number, Decision>();

function suggestionActor(s: Suggestion): User {
  const u = mockUser();
  if (!u) throw new HttpError(401);
  if (u.role !== "RESEARCH_ADMIN" && !((u.role === "RESEARCHER" || u.role === "SUPERVISOR") && u.researcherId === s.researcherId)) throw new HttpError(403);
  return u;
}

/* ---------------------------------- harvest ----------------------------------- */
const SAMPLE_NOTE = "Sample harvest: demo data, no external service was called";
function pickResearcher(p: Publication): Researcher | undefined {
  const active = db.researchers.filter((r) => r.status !== "left" && r.kind !== "scholar");
  const first = db.researchers.find((r) => r.id === p.authorIds[0]);
  const peers = first ? active.filter((r) => r.departmentId === first.departmentId && !p.authorIds.includes(r.id)) : [];
  return (peers.length ? peers : active.filter((r) => !p.authorIds.includes(r.id)))[0];
}

/* ------------------------------------ mock ------------------------------------ */
export const mock = {
  /* Duplicates (R13) */
  duplicates: (): Promise<DuplicatePair[]> => wait(visiblePairs()),
  dismissDuplicate: (pairIdValue: string) => {
    if (!visiblePairs().some((p) => p.id === pairIdValue)) throw new HttpError(404);
    db.dismissedDuplicates.push(pairIdValue);
    audit("Dismissed duplicate pair", "publication", pairIdValue, "Marked as not a duplicate");
    return wait(undefined);
  },
  mergePublications: ({ survivorId, removedId, take }: MergeRequest): Promise<Publication> => {
    const { ids } = reviewerScope();
    if (survivorId === removedId) throw new HttpError(400);
    const survivor = db.publications.find((p) => p.id === survivorId);
    const removed = db.publications.find((p) => p.id === removedId);
    if (!survivor || !removed) throw new HttpError(404);
    if (!live(survivor) || !live(removed)) throw conflict("merged");
    if (!inScope(ids, survivor) && !inScope(ids, removed)) throw new HttpError(403);
    for (const [k, v] of Object.entries(take ?? {})) {
      if (!(MERGE_FIELDS as readonly string[]).includes(k) || (removed as unknown as Record<string, unknown>)[k] !== v) throw new HttpError(400); // values must come from the removed record
    }
    const merged = buildMerged(survivor, removed, take);
    Object.assign(survivor, merged, { version: storedVersion(survivor) + 1 });
    // The removed record stays for the audit trail but leaves every list and count.
    removed.mergedInto = survivor.id;
    removed.state = "unverified";
    removed.authorIds = [];
    removed.version = storedVersion(removed) + 1;
    for (const s of db.suggestions) if (s.publication.id === removedId) s.publication = { ...survivor };
    const seen = new Set<string>();
    db.suggestions = db.suggestions.filter((s) => { const k = `${s.publication.id}:${s.researcherId}`; if (seen.has(k) || (s.publication.id === survivorId && survivor.authorIds.includes(s.researcherId))) return false; seen.add(k); return true; });
    for (const d of db.disputes) if (d.publicationId === removedId) { d.publicationId = survivorId; d.publicationTitle = survivor.title; }
    audit("Merged publications", "publication", survivorId, `#${removedId} merged into #${survivorId}`);
    return wait(survivor);
  },

  /* Disputes (R30) */
  raiseDispute: ({ publicationId, reason }: DisputeRequest): Promise<Dispute> => {
    const u = mockUser();
    if (!u) throw new HttpError(401);
    const p = db.publications.find((x) => x.id === publicationId);
    if (!p) throw new HttpError(404);
    if (!u.researcherId || !p.authorIds.includes(u.researcherId)) throw new HttpError(403); // only a listed author can dispute their own authorship
    const text = reason.trim();
    if (text.length < 10 || text.length > 1000) throw new HttpError(400);
    if (db.disputes.some((d) => d.publicationId === publicationId && d.researcherId === u.researcherId && d.status === "open")) throw new HttpError(409);
    const d: Dispute = { id: db.nextId.dispute++, publicationId, publicationTitle: p.title, researcherId: u.researcherId, researcherName: db.researchers.find((r) => r.id === u.researcherId)?.name ?? u.name, reason: text, raisedOn: today(), status: "open" };
    db.disputes.unshift(d);
    audit("Raised authorship dispute", "dispute", d.id, `Publication #${publicationId}`);
    return wait(d);
  },
  disputes: (): Promise<Dispute[]> => {
    const u = mockUser();
    if (!u) throw new HttpError(401);
    if (noResearchContent(u.role)) throw new HttpError(403);
    if ((REVIEWERS as readonly string[]).includes(u.role)) {
      const ids = scopeIds(u);
      const pubOf = (d: Dispute) => db.publications.find((p) => p.id === d.publicationId);
      return wait(db.disputes.filter((d) => !ids || ids.has(d.researcherId) || (pubOf(d)?.authorIds ?? []).some((a) => ids.has(a))));
    }
    return wait(db.disputes.filter((d) => u.researcherId !== undefined && d.researcherId === u.researcherId));
  },
  resolveDispute: ({ id, outcome, resolution }: ResolveRequest): Promise<Dispute> => {
    const { u, ids } = reviewerScope();
    const d = db.disputes.find((x) => x.id === id);
    if (!d) throw new HttpError(404);
    const p = db.publications.find((x) => x.id === d.publicationId);
    if (ids && !ids.has(d.researcherId) && !(p?.authorIds ?? []).some((a) => ids.has(a))) throw new HttpError(403);
    if (u.researcherId !== undefined && u.researcherId === d.researcherId) throw new HttpError(403); // nobody decides their own dispute
    if (outcome !== "upheld" && outcome !== "dismissed") throw new HttpError(400);
    if (!resolution.trim() || resolution.length > 1000) throw new HttpError(400);
    if (d.status !== "open") throw new HttpError(409);
    d.status = outcome;
    d.resolution = resolution.trim();
    d.resolvedBy = u.name;
    d.resolvedOn = today();
    if (outcome === "upheld" && p) {
      p.authorIds = p.authorIds.filter((a) => a !== d.researcherId);
      if (p.authors) p.authors = p.authors.filter((a) => a.researcherId !== d.researcherId);
      if (p.authorIds.length === 0) p.state = "unverified"; // nobody verified is left, so it stops counting
      p.version = storedVersion(p) + 1;
    }
    audit(outcome === "upheld" ? "Upheld authorship dispute" : "Dismissed authorship dispute", "dispute", id, `Publication #${d.publicationId}: ${d.resolution}`);
    return wait(d);
  },

  /* Publications: open access filter (R14), merged records hidden, version check (§5) */
  publications: (f: PublicationFilters): Promise<Page<Publication>> => {
    const u = mockUser();
    let rows = db.publications.filter(live);
    const ids = scopeIds(u);
    if (ids) rows = rows.filter((p) => p.authorIds.some((a) => ids.has(a)));
    if (u?.role === "RESEARCHER") rows = rows.filter((p) => u.researcherId && p.authorIds.includes(u.researcherId));
    if (f.q) rows = rows.filter((p) => (p.title + p.venue + (p.doi ?? "") + (p.authors ?? []).map((a) => a.name).join(" ")).toLowerCase().includes(f.q!.toLowerCase()));
    if (f.status) rows = rows.filter((p) => (p.entryStatus ?? "approved") === f.status);
    if (f.year) rows = rows.filter((p) => p.year === f.year);
    if (f.type) rows = rows.filter((p) => p.type === f.type);
    if (f.state) rows = rows.filter((p) => p.state === f.state);
    if (f.oa) rows = rows.filter((p) => p.oaStatus === f.oa);
    if (f.departmentId) { const d = new Set(db.researchers.filter((r) => r.departmentId === f.departmentId).map((r) => r.id)); rows = rows.filter((p) => p.authorIds.some((a) => d.has(a))); }
    const [key, dir] = (f.sort ?? "year:desc").split(":");
    rows = [...rows].sort((a, b) => { const av = (a as never)[key] as string | number, bv = (b as never)[key] as string | number; return (av > bv ? 1 : av < bv ? -1 : 0) * (dir === "asc" ? 1 : -1); });
    const items = rows.slice(f.page * f.size, f.page * f.size + f.size).map((p) => ({ ...p, version: storedVersion(p) }));
    return wait({ items, total: rows.length, page: f.page, size: f.size });
  },
  publication: (id: number): Promise<Publication> => {
    const u = mockUser();
    const p = db.publications.find((x) => x.id === id);
    if (!p) throw new HttpError(404);
    if (u?.role === "GUEST") { if (u.guestItem?.kind !== "publication" || u.guestItem.ref !== String(id)) throw new HttpError(403); }
    else if (!u || u.role === "IT_ADMIN" || u.role === "PLATFORM_ADMIN") throw new HttpError(403);
    else { const ids = scopeIds(u); if (ids && p.authorIds.length > 0 && !p.authorIds.some((a) => ids.has(a))) throw new HttpError(403); }
    return wait({ ...p, version: storedVersion(p) });
  },
  savePublication: (input: SavePublicationInput): Promise<Publication> => {
    const { expectedVersion, ...p } = input;
    const u = mockUser();
    if (!u) throw new HttpError(401);
    if (!["RESEARCH_ADMIN", "RESEARCHER", "SUPERVISOR"].includes(u.role)) throw new HttpError(403);
    if (p.doi && db.publications.some((x) => live(x) && normaliseDoi(x.doi) === normaliseDoi(p.doi) && x.id !== p.id)) throw conflict("doi");
    if (p.id) {
      const cur = db.publications.find((x) => x.id === p.id);
      if (!cur) throw new HttpError(404);
      const ids = scopeIds(u);
      if (ids && cur.authorIds.length > 0 && !cur.authorIds.some((a) => ids.has(a))) throw new HttpError(403);
      if (!live(cur)) throw conflict("merged");
      // Optimistic locking: a save made against an older copy is rejected so nobody overwrites someone else's edit.
      if (expectedVersion !== undefined && expectedVersion !== storedVersion(cur)) throw conflict("version");
      Object.assign(cur, p, { id: cur.id, state: cur.state, source: cur.source, mergedInto: undefined, version: storedVersion(cur) + 1 });
      return wait({ ...cur });
    }
    const n: Publication = { ...p, id: db.nextId.publication++, state: "unverified", source: "manual", version: 1, mergedInto: undefined };
    db.publications.unshift(n);
    return wait({ ...n });
  },

  /* Review queue (R12) */
  decide: (id: number, decision: "confirm" | "reject") => {
    const index = db.suggestions.findIndex((x) => x.id === id);
    if (index < 0) throw new HttpError(404);
    const s = db.suggestions[index];
    suggestionActor(s);
    const entry: Decision = { suggestion: s, index, decision };
    if (decision === "confirm") {
      const p = db.publications.find((x) => x.id === s.publication.id && live(x));
      if (p) {
        entry.before = { state: p.state, authorIds: [...p.authorIds], authors: p.authors ? [...p.authors] : undefined, version: p.version };
        p.state = "verified";
        if (!p.authorIds.includes(s.researcherId)) p.authorIds.push(s.researcherId);
        const r = db.researchers.find((x) => x.id === s.researcherId);
        if (p.authors && r && !p.authors.some((a) => a.researcherId === r.id)) p.authors.push({ kind: r.kind === "scholar" ? "internal-student" : "internal-faculty", researcherId: r.id, name: r.name, institution: "Demo University" });
        p.version = storedVersion(p) + 1;
      }
    }
    db.suggestions = db.suggestions.filter((x) => x.id !== id);
    history.set(id, entry);
    for (const k of [...history.keys()].slice(0, Math.max(0, history.size - 50))) history.delete(k);
    audit(decision === "confirm" ? "Confirmed suggestion" : "Rejected suggestion", "suggestion", id, `Publication #${s.publication.id}`);
    return wait(undefined, 120);
  },
  undoDecision: (id: number) => {
    const h = history.get(id);
    if (!h) throw new HttpError(404);
    suggestionActor(h.suggestion);
    if (db.suggestions.some((x) => x.id === id)) throw new HttpError(409);
    if (h.before) {
      const p = db.publications.find((x) => x.id === h.suggestion.publication.id);
      if (p) { p.state = h.before.state; p.authorIds = h.before.authorIds; p.authors = h.before.authors; p.version = storedVersion(p) + 1; }
    }
    db.suggestions.splice(Math.min(h.index, db.suggestions.length), 0, h.suggestion);
    history.delete(id);
    audit("Undid review decision", "suggestion", id);
    return wait(undefined, 120);
  },
  overrideSuggestion: ({ id, researcherId }: { id: number; researcherId: number }): Promise<Suggestion> => {
    requireRole(mockUser(), ["RESEARCH_ADMIN"]);
    const s = db.suggestions.find((x) => x.id === id);
    const r = db.researchers.find((x) => x.id === researcherId);
    if (!s || !r) throw new HttpError(404);
    const pub = db.publications.find((x) => x.id === s.publication.id);
    if (pub?.authorIds.includes(researcherId) || db.suggestions.some((x) => x.id !== id && x.publication.id === s.publication.id && x.researcherId === researcherId)) throw new HttpError(409);
    const from = db.researchers.find((x) => x.id === s.researcherId)?.name ?? `#${s.researcherId}`;
    s.researcherId = researcherId;
    s.reason = `Reassigned by the research office. ${s.reason}`;
    audit("Reassigned suggestion", "suggestion", id, `${from} to ${r.name}`);
    return wait(s);
  },

  /* Harvest (R11) */
  harvestRuns: (): Promise<HarvestRun[]> => {
    requireRole(mockUser(), ["RESEARCH_ADMIN"]);
    return wait([...db.harvestRuns].sort((a, b) => b.at.localeCompare(a.at) || b.id - a.id));
  },
  runHarvest: (): Promise<HarvestRun[]> => {
    requireRole(mockUser(), ["RESEARCH_ADMIN"]);
    const suggested = new Set(db.suggestions.map((s) => s.publication.id));
    const candidates = db.publications.filter((p) => live(p) && p.state === "unverified" && !suggested.has(p.id));
    const wanted = 1 + (db.nextId.harvest % 3); // 1 to 3 per run
    const created: { s: Suggestion; viaOrcid: boolean }[] = [];
    for (const p of candidates) {
      if (created.length >= wanted) break;
      const r = pickResearcher(p);
      if (!r) continue;
      const s: Suggestion = {
        id: db.nextId.suggestion++, publication: p, researcherId: r.id, score: Math.round((0.55 + 0.1 * (created.length + 1)) * 100) / 100,
        reason: "Sample harvest: possible match in the same department (demo data, not a real match)",
      };
      p.state = "suggested";
      db.suggestions.push(s);
      created.push({ s, viaOrcid: !!r.orcid });
    }
    const at = nowIso();
    const active = db.researchers.filter((r) => r.status !== "left");
    const known = (rs: Researcher[]) => db.publications.filter((p) => live(p) && p.authorIds.some((a) => rs.some((r) => r.id === a))).length;
    const make = (source: "ORCID" | "OpenAlex", rs: Researcher[], fresh: number): HarvestRun => ({
      id: db.nextId.harvest++, at, source, researchers: rs.length, found: known(rs) + fresh, newSuggestions: fresh, status: "ok",
      note: fresh ? SAMPLE_NOTE : `${SAMPLE_NOTE}; nothing new to suggest`,
    });
    const runs = [make("ORCID", active.filter((r) => r.orcid), created.filter((c) => c.viaOrcid).length), make("OpenAlex", active, created.filter((c) => !c.viaOrcid).length)];
    db.harvestRuns.unshift(...runs);
    audit("Ran harvest", "harvest", runs[0].id, `${created.length} new suggestion(s) (sample)`);
    return wait(runs, 700);
  },
};

/* ------------------------------------ real ------------------------------------ */
// Planned endpoints (TRD §5/§6). A stale save answers 412 (If-Match); 409 is reserved for a duplicate DOI.
export const real: typeof mock = {
  duplicates: () => http("/publications/duplicates"),
  dismissDuplicate: (id) => http(`/publications/duplicates/${encodeURIComponent(id)}/dismiss`, { method: "POST" }),
  mergePublications: (r) => http("/publications/merge", { method: "POST", body: JSON.stringify(r) }),
  raiseDispute: (r) => http("/disputes", { method: "POST", body: JSON.stringify(r) }),
  disputes: () => http("/disputes"),
  resolveDispute: ({ id, ...r }) => http(`/disputes/${id}/resolve`, { method: "POST", body: JSON.stringify(r) }),
  publications: (f) => http(`/publications${qs({ ...f })}`),
  publication: (id) => http(`/publications/${id}`),
  savePublication: async ({ expectedVersion, ...p }) => {
    const headers = expectedVersion !== undefined ? { "If-Match": String(expectedVersion) } : undefined;
    try {
      return await (p.id
        ? http<Publication>(`/publications/${p.id}`, { method: "PUT", body: JSON.stringify(p), headers })
        : http<Publication>("/publications", { method: "POST", body: JSON.stringify(p) }));
    } catch (e) {
      if (e instanceof HttpError && e.status === 412) throw conflict("version");
      if (e instanceof HttpError && e.status === 409) throw conflict("doi");
      throw e;
    }
  },
  decide: (id, decision) => http(`/claims/${id}/${decision}`, { method: "POST" }),
  undoDecision: (id) => http(`/claims/${id}/undo`, { method: "POST" }),
  overrideSuggestion: ({ id, researcherId }) => http(`/claims/${id}/reassign`, { method: "POST", body: JSON.stringify({ researcherId }) }),
  harvestRuns: () => http("/harvest/runs"),
  runHarvest: () => http("/harvest/runs", { method: "POST" }),
};
