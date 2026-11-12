import { creditedFaculty } from './domain';
import type {
  AnyRecord, Biodata, Conference, DB, EntityKind, Faculty, Fdp, Grant, Honour, IntellectualProperty, Publication, SeedMoney, Weights,
} from './types';
import { MONTHS, ipIsGranted } from './types';

export const KINDS: EntityKind[] = ['publications', 'grants', 'seedMoney', 'fdps', 'conferences', 'awards', 'ipr'];

/** The date an activity is counted on. */
export function dateOf(kind: EntityKind, r: AnyRecord): string {
  switch (kind) {
    case 'publications': {
      const p = r as Publication;
      const m = Math.max(1, MONTHS.indexOf(p.month) + 1);
      return `${p.year}-${String(m).padStart(2, '0')}-01`;
    }
    case 'grants': return (r as Grant).appliedDate;
    case 'seedMoney': return (r as SeedMoney).appliedDate;
    case 'fdps': return (r as Fdp).fromDate;
    case 'conferences': return (r as Conference).fromDate;
    case 'awards': return (r as Honour).awardDate;
    case 'ipr': return (r as IntellectualProperty).filingDate;
  }
}

// ---------- academic years ----------

export function academicYearOf(iso: string, startMonth: number): string {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  const start = m >= startMonth ? y : y - 1;
  return startMonth === 1 ? String(start) : `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

export function academicYearRange(label: string, startMonth: number): { from: string; to: string } {
  const start = Number(label.slice(0, 4));
  const from = `${start}-${String(startMonth).padStart(2, '0')}-01`;
  const end = new Date(Date.UTC(startMonth === 1 ? start + 1 : start + 1, startMonth - 1, 0));
  return { from, to: end.toISOString().slice(0, 10) };
}

export function academicYears(db: DB, today = new Date().toISOString().slice(0, 10)): string[] {
  const sm = db.settings.academicYearStartMonth;
  const set = new Set<string>([academicYearOf(today, sm)]);
  for (const k of KINDS) for (const r of db[k] as AnyRecord[]) set.add(academicYearOf(dateOf(k, r), sm));
  return [...set].sort().reverse();
}

// ---------- filters ----------

export interface Filter { from: string; to: string; department: string } // department '' = all

export function inRange(iso: string, f: { from: string; to: string }) {
  return (!f.from || iso >= f.from) && (!f.to || iso <= f.to);
}

/** Approved records of a kind within the date range (department filtering happens per faculty). */
export function approvedIn<K extends EntityKind>(db: DB, kind: K, f: { from: string; to: string }) {
  return (db[kind] as AnyRecord[]).filter((r) => r.status === 'Approved' && inRange(dateOf(kind, r), f)) as DB[K];
}

// ---------- scoring ----------

export function scoreRecord(kind: EntityKind, r: AnyRecord, w: Weights): number {
  switch (kind) {
    case 'publications': {
      const p = r as Publication;
      if (p.entryType === 'Journal Article') {
        return ({ Q1: w.q1, Q2: w.q2, Q3: w.q3, Q4: w.q4 } as Record<string, number>)[p.quartile] ?? w.otherJournal;
      }
      return { Book: w.book, 'Book Chapter': w.chapter, 'Conference Paper': w.confPaper, 'Technical Report': w.techReport }[p.entryType] ?? 0;
    }
    case 'grants': {
      const g = r as Grant;
      if (g.outcome !== 'Sanctioned' && g.outcome !== 'Completed') return 1; // credit for applying
      return w.grantSanctioned + Math.min(20, (g.sanctionedAmount / 100000) * w.grantPerLakh);
    }
    case 'seedMoney': return w.seedMoney;
    case 'fdps': {
      const x = r as Fdp;
      return x.role === 'Organised' ? w.fdpOrganised : x.role === 'Resource Person' ? w.fdpResource : w.fdpAttended;
    }
    case 'conferences': {
      const c = r as Conference;
      if (c.participation.includes('Presented')) return w.confPresented;
      return ({ 'Invited Talk / Keynote': w.confInvited, 'Session Chair': w.confChair, Attended: w.confAttended, Organised: w.confOrganised } as Record<string, number>)[c.participation] ?? 0;
    }
    case 'awards': {
      const level = (r as Honour).level;
      return level === 'International' ? w.awardInternational : level === 'National' ? w.awardNational : w.awardOther;
    }
    case 'ipr': {
      const x = r as IntellectualProperty;
      const granted = ipIsGranted(x.stage);
      if (x.ipType === 'Patent') return granted ? w.patentGranted ?? 10 : w.patentFiled ?? 4;
      if (!granted) return 0; // other kinds of IP count once granted / registered
      return ({ Design: w.design ?? 3, Copyright: w.copyright ?? 3, Trademark: w.trademark ?? 2 } as Record<string, number>)[x.ipType] ?? w.ipOther ?? 2;
    }
  }
}

// ---------- per-faculty statistics ----------

export interface FacultyStats {
  faculty: Faculty;
  publications: number;
  journals: number;
  q1q2: number;
  scopusWos: number;
  grantsApplied: number;
  grantsSanctioned: number;
  sanctionedAmount: number;
  seedMoney: number;
  fdps: number;
  fdpHours: number;
  conferences: number;
  confPresented: number;
  awards: number;
  ipr: number;
  patents: number;
  score: number;
  pending: number;
  lastActivity: string; // latest approved activity date ever (not range-limited), '' if none
  biodata: number; // completeness %
}

export const isSanctioned = (g: Grant) => g.outcome === 'Sanctioned' || g.outcome === 'Completed';

export function facultyStats(db: DB, f: Filter): FacultyStats[] {
  const w = db.settings.weights;
  const people = db.faculty.filter((x) => x.active && (!f.department || x.department === f.department));
  const map = new Map<string, FacultyStats>(people.map((p) => [p.id, {
    faculty: p, publications: 0, journals: 0, q1q2: 0, scopusWos: 0, grantsApplied: 0, grantsSanctioned: 0, sanctionedAmount: 0,
    seedMoney: 0, fdps: 0, fdpHours: 0, conferences: 0, confPresented: 0, awards: 0, ipr: 0, patents: 0, score: 0, pending: 0, lastActivity: '',
    biodata: biodataCompleteness(db.biodata.find((b) => b.facultyId === p.id), p),
  }]));

  for (const kind of KINDS) {
    for (const r of db[kind] as AnyRecord[]) {
      const ids = creditedFaculty(kind, r);
      const d = dateOf(kind, r);
      for (const id of ids) {
        const s = map.get(id);
        if (!s) continue;
        if ((r.status === 'Submitted' || r.status === 'UnderReview') && r.facultyId === id) s.pending++;
        if (r.status !== 'Approved') continue;
        if (d > s.lastActivity) s.lastActivity = d;
        if (!inRange(d, f)) continue;
        s.score += scoreRecord(kind, r, w);
        if (kind === 'publications') {
          const p = r as Publication;
          s.publications++;
          if (p.entryType === 'Journal Article') s.journals++;
          if (p.quartile === 'Q1' || p.quartile === 'Q2') s.q1q2++;
          if (p.indexing.includes('Scopus') || p.indexing.includes('Web of Science')) s.scopusWos++;
        } else if (kind === 'grants') {
          const g = r as Grant;
          s.grantsApplied++;
          if (isSanctioned(g)) {
            s.grantsSanctioned++;
            const share = g.investigators.find((i) => i.code === id)?.sharePct ?? 100;
            s.sanctionedAmount += (g.sanctionedAmount * share) / 100;
          }
        } else if (kind === 'seedMoney') s.seedMoney++;
        else if (kind === 'fdps') { s.fdps++; s.fdpHours += (r as Fdp).hours; }
        else if (kind === 'conferences') { s.conferences++; if ((r as Conference).participation.includes('Presented')) s.confPresented++; }
        else if (kind === 'awards') s.awards++;
        else if (kind === 'ipr') { s.ipr++; if ((r as IntellectualProperty).ipType === 'Patent') s.patents++; }
      }
    }
  }
  return [...map.values()].map((s) => ({ ...s, score: Math.round(s.score * 10) / 10 })).sort((a, b) => b.score - a.score);
}

export function biodataCompleteness(b: Biodata | undefined, f: Faculty): number {
  const checks = [
    !!f.email, !!f.phone, !!f.orcid, !!f.scopusId,
    !!b?.dob, !!b?.gender, !!b?.address, !!b?.summary, !!b?.researchInterests, !!b?.googleScholar,
    (b?.qualifications.length ?? 0) > 0, (b?.qualifications ?? []).some((q) => q.degree.toLowerCase().includes('ph')),
    (b?.experience.length ?? 0) > 0, (b?.memberships.length ?? 0) > 0,
  ];
  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
}

/** Unique institution-level counts in a range: a co-authored paper counts once. */
export function uniqueCounts(db: DB, f: Filter) {
  const deptOf = new Map(db.faculty.map((x) => [x.id, x.department]));
  const inDept = (kind: EntityKind, r: AnyRecord) => !f.department || creditedFaculty(kind, r).some((id) => deptOf.get(id) === f.department);
  const pubs = approvedIn(db, 'publications', f).filter((r) => inDept('publications', r));
  const grants = approvedIn(db, 'grants', f).filter((r) => inDept('grants', r));
  const seed = approvedIn(db, 'seedMoney', f).filter((r) => inDept('seedMoney', r));
  const fdps = approvedIn(db, 'fdps', f).filter((r) => inDept('fdps', r));
  const confs = approvedIn(db, 'conferences', f).filter((r) => inDept('conferences', r));
  const awards = approvedIn(db, 'awards', f).filter((r) => inDept('awards', r));
  const ipr = approvedIn(db, 'ipr', f).filter((r) => inDept('ipr', r));
  const sanctioned = grants.filter(isSanctioned);
  return {
    pubs, grants, seed, fdps, confs, awards, ipr, sanctioned,
    sanctionedAmount: sanctioned.reduce((a, g) => a + g.sanctionedAmount, 0),
    receivedAmount: sanctioned.reduce((a, g) => a + g.receivedAmount, 0),
    appliedAmount: grants.reduce((a, g) => a + g.appliedAmount, 0),
    seedAmount: seed.reduce((a, s) => a + s.sanctionedAmount, 0),
    fdpHours: fdps.reduce((a, x) => a + x.hours, 0),
  };
}


// ---------- formatting ----------

export const inr = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN');
export const lakh = (n: number) => `₹${(n / 100000).toLocaleString('en-IN', { maximumFractionDigits: 1 })} L`;
export const fmtDate = (iso: string) => {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
};
export const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
/** "1 patent", "2 patents": a count with its noun in the right number. */
export const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-IN')} ${n === 1 ? one : many}`;

// ---------- trends ----------

export interface TrendRow {
  ay: string;
  journal: number; confPaper: number; book: number; chapter: number; bookChapter: number; report: number;
  q1: number; q2: number; q3: number; q4: number; unranked: number;
  appliedL: number; sanctionedL: number; receivedL: number; proposals: number; sanctionedCount: number;
  fdps: number; fdpHours: number; confs: number; national: number; international: number; presented: number;
  faculty: number;
}

/** One row per academic year (oldest first) of institution-level, de-duplicated counts. */
export function trend(db: DB, department: string, ays: string[], facultyId?: string): TrendRow[] {
  const sm = db.settings.academicYearStartMonth;
  return [...ays].sort().map((ay) => {
    const f = { ...academicYearRange(ay, sm), department };
    const u = uniqueCounts(db, f);
    const mine = <T extends AnyRecord>(kind: EntityKind, xs: T[]) => (facultyId ? xs.filter((r) => creditedFaculty(kind, r).includes(facultyId)) : xs);
    const pubs = mine('publications', u.pubs);
    const grants = mine('grants', u.grants);
    const fdps = mine('fdps', u.fdps);
    const confs = mine('conferences', u.confs);
    const sanctioned = grants.filter(isSanctioned);
    const byType = (t: string) => pubs.filter((p) => p.entryType === t).length;
    const journals = pubs.filter((p) => p.entryType === 'Journal Article');
    const q = (x: string) => journals.filter((p) => p.quartile === x).length;
    return {
      ay, journal: byType('Journal Article'), confPaper: byType('Conference Paper'), book: byType('Book'), chapter: byType('Book Chapter'), bookChapter: byType('Book') + byType('Book Chapter'), report: byType('Technical Report'),
      q1: q('Q1'), q2: q('Q2'), q3: q('Q3'), q4: q('Q4'), unranked: q('NA'),
      appliedL: round1(grants.reduce((a, g) => a + g.appliedAmount, 0) / 1e5), sanctionedL: round1(sanctioned.reduce((a, g) => a + g.sanctionedAmount, 0) / 1e5),
      receivedL: round1(sanctioned.reduce((a, g) => a + g.receivedAmount, 0) / 1e5), proposals: grants.length, sanctionedCount: sanctioned.length,
      fdps: fdps.length, fdpHours: fdps.reduce((a, x) => a + x.hours, 0), confs: confs.length,
      national: confs.filter((c) => c.level === 'National').length, international: confs.filter((c) => c.level === 'International').length,
      presented: confs.filter((c) => c.participation.includes('Presented')).length,
      faculty: db.faculty.filter((x) => x.active && (!department || x.department === department)).length,
    };
  });
}
const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Phone numbers are shown masked (first five digits, then asterisks) while the system holds sample data.
 * Set SHOW_FULL_PHONE_NUMBERS to true once real numbers are loaded. Edit forms always show the full number.
 */
export const SHOW_FULL_PHONE_NUMBERS = false;
export const displayPhone = (p: string) => {
  if (SHOW_FULL_PHONE_NUMBERS || !p) return p;
  const digits = p.replace(/\D/g, '');
  return digits.length <= 5 ? p : `${digits.slice(0, 5)}${'*'.repeat(digits.length - 5)}`;
};
