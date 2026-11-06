import type {
  Author, Biodata, Conference, DB, Faculty, Fdp, Grant, HistoryItem, Honour, Investigator, Publication, SeedMoney, Status,
} from './types';
import { AWARD_WEIGHT_DEFAULTS, MONTHS } from './types';

/** Deterministic PRNG so the sample data is identical on every machine. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const DEFAULT_DEPARTMENTS = [
  'Computer Science & Engineering',
  'Electronics & Communication',
  'Mechanical Engineering',
  'Civil Engineering',
  'Biotechnology',
  'Management Studies',
];

export const DEFAULT_WEIGHTS = {
  q1: 10, q2: 8, q3: 6, q4: 4, otherJournal: 3,
  book: 8, chapter: 4, confPaper: 3, techReport: 2,
  grantSanctioned: 10, grantPerLakh: 0.5, seedMoney: 3,
  fdpAttended: 2, fdpOrganised: 4, fdpResource: 3,
  confPresented: 3, confInvited: 4, confChair: 2, confAttended: 1, confOrganised: 4,
  ...AWARD_WEIGHT_DEFAULTS,
};

/** Placeholder labels instead of real-looking personal names: A, B, ... Z, AA, AB, ... */
export const letterLabel = (i: number): string => (i < 26 ? String.fromCharCode(65 + i) : letterLabel(Math.floor(i / 26) - 1) + String.fromCharCode(65 + (i % 26)));
// Same lengths as the name lists they replace, so the random sequence (and all other sample data) is unchanged.
const FIRST = Array.from({ length: 38 }, (_, i) => letterLabel(i));
const LAST = Array.from({ length: 20 }, (_, i) => String(i + 1));
const DESIGNATIONS = ['Professor', 'Associate Professor', 'Associate Professor', 'Assistant Professor', 'Assistant Professor', 'Assistant Professor'];

const TOPICS: Record<string, string[]> = {
  'Computer Science & Engineering': ['deep reinforcement learning based task scheduling', 'federated learning for healthcare data', 'graph neural networks for fraud detection', 'edge computing offloading', 'transformer models for code summarisation', 'privacy-preserving data mining'],
  'Electronics & Communication': ['low-power VLSI design', 'MIMO antenna arrays for 5G', 'IoT sensor networks', 'signal denoising with wavelets', 'FPGA accelerators for CNNs', 'RF energy harvesting'],
  'Mechanical Engineering': ['additive manufacturing of titanium alloys', 'heat transfer in nanofluids', 'composite material fatigue', 'robotic gripper design', 'CFD analysis of turbine blades', 'tribology of coated surfaces'],
  'Civil Engineering': ['self-healing concrete', 'seismic retrofitting of RC frames', 'groundwater quality modelling', 'sustainable pavement materials', 'traffic flow prediction', 'geopolymer binders'],
  Biotechnology: ['microbial biofilm inhibition', 'CRISPR-based gene editing', 'plant secondary metabolites', 'bioremediation of heavy metals', 'nanoparticle drug delivery', 'enzyme immobilisation'],
  'Management Studies': ['consumer behaviour in digital markets', 'supply chain resilience', 'ESG disclosure and firm value', 'HR analytics adoption', 'microfinance and women entrepreneurship', 'fintech adoption in rural India'],
  Physics: ['perovskite solar cells', 'quantum dots for photonics', 'thin film magnetism', 'gravitational wave data analysis', 'plasma diagnostics', 'superconducting qubits'],
  Chemistry: ['green synthesis of nanoparticles', 'metal-organic frameworks for CO2 capture', 'electrochemical sensors', 'polymer electrolytes', 'catalytic hydrogenation', 'natural product isolation'],
  Mathematics: ['fractional differential equations', 'graph colouring algorithms', 'stochastic optimisation', 'fuzzy decision models', 'numerical PDE solvers', 'cryptographic number theory'],
  Commerce: ['GST compliance among MSMEs', 'digital payments adoption', 'corporate governance and audit quality', 'behavioural finance of retail investors', 'CSR spending outcomes', 'tax reform and investment'],
  'English Literature': ['postcolonial Indian fiction', 'ecocriticism in regional poetry', 'translation studies', 'digital humanities methods', 'gender in diaspora narratives', 'English language teaching with technology'],
};
const GENERIC_TOPICS = ['interdisciplinary research methods', 'curriculum innovation', 'sustainable development goals', 'data-driven decision making', 'community engagement', 'technology-enabled learning'];
const topicsOf = (dept: string) => TOPICS[dept] ?? GENERIC_TOPICS;
const PREFIX = ['A novel approach to', 'An efficient framework for', 'Experimental study of', 'A comparative analysis of', 'Towards scalable', 'Investigating', 'Optimised'];
const JOURNALS = [
  ['Scientific Reports', '20452322', 'Scopus + WoS', 'Q1', 4.6], ['IEEE Access', '21693536', 'Scopus + WoS', 'Q1', 3.9],
  ['Journal of Supercomputing', '09208542', 'Scopus + WoS', 'Q2', 2.5], ['Materials Today: Proceedings', '22147853', 'Scopus', 'NA', 0],
  ['Heliyon', '24058440', 'Scopus + WoS', 'Q1', 4.0], ['Cluster Computing', '13867857', 'Scopus + WoS', 'Q2', 4.4],
  ['International Journal of Engineering Research', '23194847', 'UGC CARE', 'NA', 0], ['Journal of Cleaner Production', '09596526', 'Scopus + WoS', 'Q1', 9.7],
  ['Wireless Personal Communications', '09296212', 'Scopus + WoS', 'Q3', 2.2], ['Indian Journal of Marketing', '09732896', 'Scopus', 'Q4', 0],
  ['Construction and Building Materials', '09500618', 'Scopus + WoS', 'Q1', 7.4], ['3 Biotech', '2190572X', 'Scopus + WoS', 'Q2', 2.6],
  ['Journal of Physics: Conference Series', '17426588', 'Scopus', 'Q4', 0], ['Asian Journal of Management', '09765328', 'Not Indexed', 'NA', 0],
] as const;
const AGENCIES = [['DST-SERB', 'Central Government'], ['DBT', 'Central Government'], ['AICTE', 'Central Government'], ['ICSSR', 'Central Government'],
  ['ISRO', 'Central Government'], ['Karnataka State Council for S&T', 'State Government'], ['Bosch India', 'Industry'], ['Infosys Foundation', 'Private Foundation'],
  ['Royal Society (UK)', 'International Agency'], ['DRDO', 'Central Government']] as const;
const FDP_TITLES = ['Outcome Based Education and NBA Accreditation', 'Machine Learning with Python', 'Research Methodology and Scientific Writing',
  'Innovative Pedagogy for Engineering Educators', 'IPR and Patent Filing', 'Data Analytics using R', 'Quantum Computing Fundamentals',
  'Sustainable Construction Practices', 'Advanced Characterisation Techniques', 'Case Method Teaching', 'NEP 2020 Implementation',
  'Cloud Computing with AWS', 'Bioinformatics Tools', 'Academic Leadership', 'Universal Human Values'];
const FDP_ORGS = ['AICTE ATAL Academy', 'NITTTR Chennai', 'IIT Madras', 'IISc Bengaluru', 'NPTEL', 'IIT Bombay', 'Internal (IQAC)', 'NIT Surathkal', 'IIM Bangalore'];
const CONFS = [['International Conference on Computing and Communication Systems', 'India', 'International'],
  ['IEEE International Conference on Electronics, Computing and Communication', 'India', 'International'],
  ['National Conference on Advances in Mechanical Engineering', 'India', 'National'],
  ['International Conference on Sustainable Infrastructure', 'Singapore', 'International'],
  ['Asia Pacific Biotech Congress', 'Malaysia', 'International'], ['National Management Research Conclave', 'India', 'National'],
  ['International Conference on Machine Learning and Data Engineering', 'Germany', 'International'],
  ['National Symposium on Emerging Trends in Engineering', 'India', 'National'], ['ACM India Joint Conference', 'India', 'National']] as const;
const VENUES = ['Bengaluru', 'Chennai', 'Mumbai', 'Hyderabad', 'Pune', 'New Delhi', 'Kochi', 'Mangaluru'];
const INSTITUTIONS = ['PQR University', 'LMN Institute of Technology', 'DEF University', 'GHI Institute of Science', 'JKL University', 'STU University', 'VWX Institute', 'RST University'];
/** Country of each placeholder partner institution (used for external co-authors on the collaboration map). */
const COUNTRY_OF: Record<string, string> = { 'PQR University': 'India', 'LMN Institute of Technology': 'Germany', 'DEF University': 'Australia', 'GHI Institute of Science': 'Japan', 'JKL University': 'United States', 'STU University': 'United Kingdom', 'VWX Institute': 'Canada', 'RST University': 'Singapore' };

/**
 * SDGs a profile's own research-interest text speaks to, by plain keyword rules. Used to fill the sample profiles
 * from what they already say; it never picks goals at random. Faculty correct or extend them in Edit Profile.
 */
const SDG_RULES: [number, RegExp][] = [
  [3, /health|drug|biofilm|gene editing|crispr|medic/i],
  [4, /education|teaching|curriculum|pedagog/i],
  [5, /gender|women/i],
  [6, /water/i],
  [7, /energy|solar|hydrogenation|electrolyte/i],
  [8, /fintech|microfinance|entrepreneur|payments|msme|hr analytics/i],
  [9, /iot|5g|vlsi|fpga|edge computing|manufacturing|robotic|neural|scheduling|qubit|infrastructure/i],
  [10, /rural|diaspora|postcolonial|inclusion/i],
  [11, /concrete|pavement|traffic|seismic|cities/i],
  [12, /green synthesis|esg|csr|supply chain|bioremediation|sustainable|consumer behaviour/i],
  [13, /climate|co2|carbon|geopolymer/i],
  [15, /plant|ecocriticism|heavy metals|biodiversity/i],
  [16, /fraud|privacy|governance|audit|tax|cryptograph/i],
  [17, /community engagement|partnership/i],
];
export const sdgsFromText = (text: string) => SDG_RULES.filter(([, re]) => re.test(text)).map(([n]) => n);

export const SAMPLE_INSTITUTION = 'ABC Institute of Technology';

export interface SeedOptions {
  name: string;
  tagline: string;
  emailDomain: string;
  seed: number;
  departments: string[];
  /** Faculty per department, in department order. */
  sizes: number[];
  reviewerName: string;
}

export const DEFAULT_SEED: SeedOptions = {
  name: SAMPLE_INSTITUTION, tagline: 'Faculty Research & Development Portal', emailDomain: 'abc.edu.in', seed: 20261104,
  departments: DEFAULT_DEPARTMENTS, sizes: [8, 7, 6, 5, 5, 5], reviewerName: 'Office of Research',
};

/** Builds one institution's sample data. Deterministic for a given seed. */
export function createSeed(opts: SeedOptions = DEFAULT_SEED): DB {
  const rnd = mulberry32(opts.seed);
  const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rnd() * arr.length)];
  const int = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));
  const pad = (n: number) => String(n).padStart(2, '0');
  // Data runs up to the end of October 2026.
  const dateIn = (year: number, monthFrom = 1, monthTo = 12) => {
    let m = int(monthFrom, monthTo);
    if (year === 2026 && m > 10) m = int(1, 10);
    return `${year}-${pad(m)}-${pad(int(1, 28))}`;
  };
  const addDays = (iso: string, d: number) => {
    const t = new Date(iso + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + d); return t.toISOString().slice(0, 10);
  };
  let seq = 1000;
  const nextId = (p: string) => `${p}${++seq}`;

  const INST = opts.name;
  const faculty: Faculty[] = [];
  const biodata: Biodata[] = [];
  let n = 0;
  opts.departments.forEach((dept, di) => {
    const count = opts.sizes[di] ?? 4;
    const T = topicsOf(dept);
    for (let i = 0; i < count; i++) {
      const label = letterLabel(n);
      const designation = i === 0 ? 'Professor' : pick(DESIGNATIONS);
      const id = `EMP${1001 + n}`;
      const joinYear = int(2008, 2022);
      faculty.push({
        id, title: designation === 'Assistant Professor' && rnd() < 0.3 ? (rnd() < 0.5 ? 'Mr.' : 'Ms.') : 'Dr.',
        name: `Faculty ${label}`, designation, department: dept,
        email: `faculty.${label.toLowerCase()}@${opts.emailDomain}`,
        phone: `98${int(10000000, 99999999)}`, joiningDate: `${joinYear}-${pad(int(1, 12))}-01`,
        orcid: `0000-000${int(1, 3)}-${int(1000, 9999)}-${int(1000, 9999)}`,
        scopusId: `${int(55000000000, 59999999999)}`, active: true,
      });
      const complete = rnd();
      biodata.push({
        facultyId: id,
        dob: complete > 0.2 ? `${int(1970, 1992)}-${pad(int(1, 12))}-${pad(int(1, 28))}` : '',
        gender: complete > 0.15 ? (rnd() < 0.5 ? 'Female' : 'Male') : '',
        address: complete > 0.35 ? `${int(1, 200)}, ${pick(['MG Road', 'Station Road', 'Lake View', 'Temple Street'])}, ${pick(VENUES)}` : '',
        summary: complete > 0.3 ? `${designation} in ${dept} with interests in ${T[0]} and ${T[1]}.` : '',
        researchInterests: complete > 0.25 ? `${T[int(0, 5)]}; ${T[int(0, 5)]}` : '',
        googleScholar: '', // a real profile URL is added by the faculty member; never a made-up link
        phdGuided: designation === 'Professor' ? int(2, 9) : designation === 'Associate Professor' ? int(0, 3) : 0,
        phdOngoing: designation === 'Assistant Professor' ? int(0, 1) : int(1, 5),
        qualifications: [
          { degree: 'B.E./B.Tech', specialization: dept, institution: pick(INSTITUTIONS), year: String(joinYear - int(8, 14)) },
          ...(complete > 0.2 ? [{ degree: 'M.Tech/M.Sc/MBA', specialization: T[0], institution: pick(INSTITUTIONS), year: String(joinYear - int(4, 7)) }] : []),
          ...(designation !== 'Assistant Professor' || rnd() < 0.4 ? [{ degree: 'Ph.D.', specialization: T[int(0, 5)], institution: pick(INSTITUTIONS), year: String(joinYear + int(-2, 4)) }] : []),
        ],
        experience: [{ organisation: INST, designation, from: `${joinYear}`, to: 'Present' },
          ...(rnd() < 0.6 ? [{ organisation: pick(['Infosys', 'Wipro', 'Anna University', 'VIT Vellore', 'TCS Research']), designation: pick(['Engineer', 'Lecturer', 'Research Associate']), from: String(joinYear - int(2, 6)), to: String(joinYear) }] : [])],
        awards: rnd() < 0.4 ? [{ title: pick(['Best Teacher Award', 'Young Scientist Award', 'Best Paper Award', 'Research Excellence Award']), by: pick(['Institution', 'IEEE', 'ISTE', 'DST']), year: String(int(2018, 2025)) }] : [],
        memberships: rnd() < 0.6 ? [{ body: pick(['IEEE', 'ISTE', 'IEI', 'ACM', 'AIMA', 'BRSI']), type: pick(['Member', 'Senior Member', 'Life Member']), since: String(int(2010, 2023)) }] : [],
        // Researcher-profile fields. No photograph and no Google Scholar metrics: those are never invented.
        expertise: complete > 0.3 ? `${T[0]}; ${T[1]}` : '', keywords: '', sdgs: [], photo: '',
        scholar: { citations: null, hIndex: null, i10Index: null, updatedAt: '', updatedBy: '' },
        updatedAt: '2026-06-01T10:00:00.000Z',
      });
      const b = biodata[biodata.length - 1];
      b.sdgs = sdgsFromText(`${b.researchInterests}; ${b.expertise}`);
      n++;
    }
  });

  // Per-person activity level drives realistic spread (some very active, a few inactive).
  const activity = new Map(faculty.map((f) => [f.id, f.designation === 'Professor' ? 0.8 + rnd() * 0.6 : rnd() < 0.15 ? 0.1 : 0.3 + rnd() * 0.8]));
  const peer = (f: Faculty) => faculty.filter((x) => x.department === f.department && x.id !== f.id);
  const facultyAuthor = (f: Faculty): Author => ({ kind: 'Faculty', code: f.id, name: `${f.title} ${f.name}`, institution: INST, department: f.department, email: f.email });

  const statusFor = (iso: string): Status => {
    // Older records are settled; recent ones are a mix of pending states.
    if (iso < '2026-09-01') return rnd() < 0.94 ? 'Approved' : rnd() < 0.5 ? 'Rejected' : 'Approved';
    const r = rnd();
    return r < 0.45 ? 'Approved' : r < 0.75 ? 'Submitted' : r < 0.85 ? 'Rework' : r < 0.95 ? 'Draft' : 'Rejected';
  };
  const historyFor = (status: Status, owner: Faculty, at: string): HistoryItem[] => {
    const h: HistoryItem[] = [{ at: `${at}T09:00:00.000Z`, by: owner.name, action: 'Created' }];
    if (status === 'Draft') return h;
    h.push({ at: `${addDays(at, 1)}T10:00:00.000Z`, by: owner.name, action: 'Submitted' });
    if (status === 'Approved') h.push({ at: `${addDays(at, int(3, 12))}T11:00:00.000Z`, by: opts.reviewerName, action: 'Approved' });
    if (status === 'Rework') h.push({ at: `${addDays(at, int(3, 12))}T11:00:00.000Z`, by: opts.reviewerName, action: 'Returned for correction', remark: 'Please attach the full-text PDF and check the DOI.' });
    if (status === 'Rejected') h.push({ at: `${addDays(at, int(3, 12))}T11:00:00.000Z`, by: opts.reviewerName, action: 'Rejected', remark: 'Duplicate of an existing entry.' });
    return h;
  };
  const base = (owner: Faculty, at: string) => {
    const status = statusFor(at);
    const last = historyFor(status, owner, at);
    return { id: '', facultyId: owner.id, status, createdAt: `${at}T09:00:00.000Z`, updatedAt: last[last.length - 1].at, history: last };
  };

  const publications: Publication[] = [];
  const grants: Grant[] = [];
  const seedMoney: SeedMoney[] = [];
  const fdps: Fdp[] = [];
  const conferences: Conference[] = [];

  for (const f of faculty) {
    const a = activity.get(f.id)!;
    for (const year of [2021, 2022, 2023, 2024, 2025, 2026]) {
      const growth = 0.8 + (year - 2021) * 0.08;
      // Publications
      const pubs = Math.round((rnd() * 4 + 0.3) * a * growth * (year === 2026 ? 0.8 : 1));
      for (let k = 0; k < pubs; k++) {
        const at = dateIn(year);
        const r = rnd();
        const entryType = r < 0.68 ? 'Journal Article' : r < 0.86 ? 'Conference Paper' : r < 0.94 ? 'Book Chapter' : r < 0.98 ? 'Book' : 'Technical Report';
        const j = pick(JOURNALS);
        const authors: Author[] = [facultyAuthor(f)];
        const ps = peer(f);
        if (ps.length && rnd() < 0.55) authors.push(facultyAuthor(pick(ps)));
        if (rnd() < 0.45) authors.push({ kind: 'Student', code: `STU${int(220000, 239999)}`, name: `Student ${pick(FIRST)}${pick(LAST)}`, institution: INST, department: f.department, email: '' });
        if (rnd() < 0.35) authors.push({ kind: 'External', code: '', name: `External Author ${pick(FIRST)}${pick(LAST)}`, institution: pick(INSTITUTIONS), department: '', email: '' });
        const ext = authors[authors.length - 1];
        if (ext.kind === 'External') ext.country = COUNTRY_OF[ext.institution];
        const isJournal = entryType === 'Journal Article';
        const p: Publication = {
          ...base(f, at), id: nextId('PUB'), entryType,
          category: isJournal ? (rnd() < 0.85 ? 'Research Article' : 'Review Article') : 'Research Article',
          title: `${pick(PREFIX)} ${pick(topicsOf(f.department))}`.replace(/^./, (c) => c.toUpperCase()),
          doi: `https://doi.org/10.${int(1000, 9999)}/${f.id.toLowerCase()}-${year}-${k}`,
          month: MONTHS[Number(at.slice(5, 7)) - 1], year,
          issn: isJournal ? j[1] : '',
          venue: isJournal ? j[0] : entryType === 'Conference Paper' ? pick(CONFS)[0] : pick(['Springer', 'Elsevier', 'CRC Press', 'Wiley', 'IGI Global']),
          indexing: isJournal ? j[2] : entryType === 'Conference Paper' ? (rnd() < 0.6 ? 'Scopus' : 'Not Indexed') : rnd() < 0.5 ? 'Scopus' : 'Not Indexed',
          quartile: isJournal ? j[3] : 'NA', impactFactor: isJournal ? j[4] : 0,
          erfRelated: rnd() < 0.1, projectReference: '', openAccess: rnd() < 0.4, authors,
          pdfName: rnd() < 0.8 ? `${f.id}_${year}_${k}.pdf` : '',
        };
        publications.push(p);
      }
      // Grants (proposals)
      if (rnd() < 0.45 * a) {
        const at = dateIn(year);
        const ag = pick(AGENCIES);
        const applied = int(4, 60) * 100000;
        const settled = at < '2026-01-01';
        const r = rnd();
        const outcome: Grant['outcome'] = !settled ? (r < 0.25 ? 'Sanctioned' : 'Applied') : r < 0.45 ? 'Sanctioned' : r < 0.6 && year <= 2023 ? 'Completed' : 'Not Sanctioned';
        const sanctioned = outcome === 'Sanctioned' || outcome === 'Completed' ? Math.round(applied * (0.6 + rnd() * 0.4) / 1000) * 1000 : 0;
        const ps = peer(f);
        const investigators: Investigator[] = [{ kind: 'Faculty', code: f.id, name: `${f.title} ${f.name}`, role: 'PI', institution: INST, department: f.department, sharePct: 60 }];
        if (ps.length) { const co = pick(ps); investigators.push({ kind: 'Faculty', code: co.id, name: `${co.title} ${co.name}`, role: 'Co-PI', institution: INST, department: co.department, sharePct: 40 }); }
        else investigators[0].sharePct = 100;
        const g: Grant = {
          ...base(f, at), id: nextId('GRT'), unit: ag[1] === 'International Agency' ? 'International Grant' : ag[1] === 'Industry' ? 'Consultancy' : 'Indian Grant',
          grantType: ag[1] === 'Industry' ? 'Industry Sponsored' : pick(['Research Project', 'Research Project', 'Infrastructure', 'Fellowship']),
          utn: `UTN${year}${int(1000, 9999)}`, title: `${pick(PREFIX)} ${pick(topicsOf(f.department))}`.replace(/^./, (c) => c.toUpperCase()),
          description: 'Proposal submitted under the open call for extramural research funding.', callTitle: `${ag[0]} Call ${year}`,
          callSource: pick(['Agency website', 'Research office circular', 'Email from agency']), source: ag[1], agency: ag[0], agencyComment: '',
          appliedDate: at, appliedAmount: applied, durationMonths: pick([12, 24, 36]), erfRelated: rnd() < 0.1, matchingGrant: rnd() < 0.2,
          contactNumber: f.phone, outcome, sanctionDate: sanctioned ? addDays(at, int(60, 200)) : '', sanctionedAmount: sanctioned,
          receivedAmount: sanctioned ? Math.round(sanctioned * (outcome === 'Completed' ? 1 : 0.3 + rnd() * 0.5) / 1000) * 1000 : 0,
          investigators, enclosures: ['Proposal.pdf', 'Endorsement_Letter.pdf'], otherRemarks: '',
        };
        if (g.sanctionDate > '2026-10-31') g.sanctionDate = '2026-10-31';
        grants.push(g);
      }
      // Seed money
      if (year >= 2023 && rnd() < 0.2 * a) {
        const at = dateIn(year);
        const req = int(1, 5) * 50000;
        const sm: SeedMoney = {
          ...base(f, at), id: nextId('SM'), appliedDate: at, category: 'Faculty',
          title: `Pilot study on ${pick(topicsOf(f.department))}`, abstract: 'Preliminary work to generate data for an extramural proposal.',
          requestedAmount: req, sanctionedAmount: 0,
          investigators: [{ kind: 'Faculty', code: f.id, name: `${f.title} ${f.name}`, role: 'PI', institution: INST, department: f.department, sharePct: 100 }],
        };
        if (sm.status === 'Approved') sm.sanctionedAmount = Math.round(req * (0.7 + rnd() * 0.3) / 1000) * 1000;
        seedMoney.push(sm);
      }
      // FDPs
      const fdpCount = Math.round(rnd() * 3 * (0.4 + a * 0.7) * (year === 2026 ? 0.8 : 1));
      for (let k = 0; k < fdpCount; k++) {
        const at = dateIn(year);
        const days = pick([1, 2, 3, 5, 5, 6, 10]);
        const role = rnd() < 0.8 ? 'Attended' : rnd() < 0.5 ? 'Organised' : 'Resource Person';
        fdps.push({
          ...base(f, at), id: nextId('FDP'), role, programmeType: pick(['FDP', 'FDP', 'Workshop', 'STTP', 'Online Course (MOOC)', 'Refresher Course']),
          title: pick(FDP_TITLES), organiser: role === 'Organised' ? 'Internal (IQAC)' : pick(FDP_ORGS), sponsoredBy: pick(['AICTE', 'Self', 'Institution', 'ISTE', '']),
          mode: pick(['Offline', 'Online', 'Online', 'Hybrid']), level: pick(['Institutional', 'National', 'National', 'International', 'State']),
          fromDate: at, toDate: addDays(at, days - 1), hours: days * 6, outcome: 'Applied the learning in course delivery and lab sessions.',
          certificateName: rnd() < 0.85 ? `FDP_${f.id}_${year}_${k}.pdf` : '',
        });
      }
      // Conferences
      const confCount = Math.round(rnd() * 2.2 * a * (year === 2026 ? 0.8 : 1));
      for (let k = 0; k < confCount; k++) {
        const at = dateIn(year);
        const c = pick(CONFS);
        const r = rnd();
        const participation = r < 0.5 ? 'Paper Presented' : r < 0.6 ? 'Poster Presented' : r < 0.7 ? 'Invited Talk / Keynote' : r < 0.78 ? 'Session Chair' : r < 0.94 ? 'Attended' : 'Organised';
        const abroad = c[1] !== 'India';
        const fee = abroad ? int(25, 60) * 1000 : int(3, 12) * 1000;
        const funding = rnd() < 0.6 ? 'Institution' : rnd() < 0.7 ? 'Self' : 'External Agency';
        conferences.push({
          ...base(f, at), id: nextId('CNF'), participation, conferenceName: c[0],
          paperTitle: participation.includes('Presented') ? `${pick(PREFIX)} ${pick(topicsOf(f.department))}` : '',
          organiser: pick(['IEEE', 'Springer', 'ACM', 'NIT Surathkal', 'IIT Bombay', 'Anna University']), venue: abroad ? c[1] : pick(VENUES),
          country: c[1], level: c[2], mode: pick(['Offline', 'Offline', 'Online', 'Hybrid']), fromDate: at, toDate: addDays(at, int(1, 2)),
          proceedingsIndexed: participation.includes('Presented') ? pick(['Scopus', 'Scopus', 'Web of Science', 'Not Indexed']) : 'NA',
          funding, registrationFee: fee, amountClaimed: funding === 'Institution' ? fee + (abroad ? int(40, 90) * 1000 : int(2, 10) * 1000) : 0,
          award: participation === 'Paper Presented' && rnd() < 0.08 ? 'Best Paper Award' : '', certificateName: `CONF_${f.id}_${year}_${k}.pdf`,
        });
      }
    }
  }

  // Honours & Awards. Generated after everything else so the earlier sample data stays the same.
  // Awards first noted in profiles become workflow records, and active researchers get a few more.
  const LEVEL_OF: Record<string, string> = { Institution: 'Institutional', IEEE: 'International', ISTE: 'National', DST: 'National' };
  const CATEGORY_OF: Record<string, string> = { 'Best Paper Award': 'Best Paper / Presentation', 'Best Teacher Award': 'Award', 'Young Scientist Award': 'Award', 'Research Excellence Award': 'Award' };
  const EXTRA: [string, string, string, string][] = [
    ['Fellow of the Institution of Engineers (FIE)', 'Fellowship of a Learned Society', 'Institution of Engineers (India)', 'National'],
    ['Senior Member, IEEE', 'Academic or Editorial Recognition', 'IEEE', 'International'],
    ['Outstanding Reviewer Award', 'Academic or Editorial Recognition', 'Elsevier', 'International'],
    ['SERB International Travel Support', 'Scholarship / Travel Grant', 'SERB, DST', 'National'],
    ['State Award for Excellence in Teaching', 'Honour / Distinction', 'State Council of Higher Education', 'State'],
    ['Best Faculty Researcher', 'Award', INST, 'Institutional'],
  ];
  const awards: Honour[] = [];
  const addAward = (f: Faculty, at: string, title: string, category: string, awardedBy: string, level: string) => {
    awards.push({
      ...base(f, at), id: nextId('AWD'), category, title, awardedBy, level, awardDate: at,
      citation: `In recognition of contributions to ${topicsOf(f.department)[0].toLowerCase()}.`, prizeAmount: level === 'Institutional' ? 0 : pick([0, 0, 10000, 25000, 50000]),
      certificateName: `AWARD_${f.id}_${at.slice(0, 4)}.pdf`,
    });
  };
  for (const b of biodata) {
    const f = faculty.find((x) => x.id === b.facultyId)!;
    for (const a of b.awards) addAward(f, `${a.year}-${pick(['02', '04', '08', '11'])}-15`, a.title, CATEGORY_OF[a.title] ?? 'Award', a.by === 'Institution' ? INST : a.by, LEVEL_OF[a.by] ?? 'National');
    b.awards = [];
  }
  for (const f of faculty) {
    if (rnd() < (activity.get(f.id)! > 0.9 ? 0.6 : 0.2)) {
      const [title, category, by, level] = pick(EXTRA);
      addAward(f, dateIn(pick([2023, 2024, 2025, 2026]), 1, 9), title, category, by, level);
    }
  }
  awards.sort((a, z) => a.awardDate.localeCompare(z.awardDate));

  return {
    version: 1,
    settings: {
      institutionName: INST,
      institutionTagline: opts.tagline,
      departments: [...opts.departments],
      academicYearStartMonth: 6,
      seedMoneyWindowOpen: true,
      targets: { publicationsPerFaculty: 2, fdpHoursPerFaculty: 30, conferencesPerFaculty: 1, grantAppliedPerFaculty: 0.5 },
      weights: { ...DEFAULT_WEIGHTS },
    },
    faculty, biodata, publications, grants, seedMoney, fdps, conferences, awards, profileChanges: [],
    notices: [
      { id: 'N1', at: '2026-10-20T09:00:00.000Z', title: 'Seed money window open', body: 'Applications for the Q3 seed money cycle are open until 30 November 2026.' },
      { id: 'N2', at: '2026-10-05T09:00:00.000Z', title: 'Update your profile', body: 'All faculty must complete their profiles before the NAAC peer team visit in January 2027.' },
      { id: 'N3', at: '2026-09-15T09:00:00.000Z', title: 'FDP target', body: 'Each faculty member is expected to complete at least 30 hours of FDP in AY 2026-27.' },
    ],
    seq,
  };
}

/** A brand-new institution: settings and departments only, no people or records yet. */
export function emptyInstitution(name: string, tagline: string, departments: string[]): DB {
  return {
    version: 1,
    settings: {
      institutionName: name, institutionTagline: tagline, departments: [...departments], academicYearStartMonth: 6, seedMoneyWindowOpen: false,
      targets: { publicationsPerFaculty: 2, fdpHoursPerFaculty: 30, conferencesPerFaculty: 1, grantAppliedPerFaculty: 0.5 },
      weights: { ...DEFAULT_WEIGHTS },
    },
    faculty: [], biodata: [], publications: [], grants: [], seedMoney: [], fdps: [], conferences: [], awards: [], profileChanges: [], notices: [], seq: 1000,
  };
}
