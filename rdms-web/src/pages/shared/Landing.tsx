import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Logo } from '../../components/Logo';
import { ThemeToggle } from '../../components/ThemeToggle';
import { EcoCard, Faqs, HeroStack, OrbitPanel, ResearchFilm, ResearchGallery, RiseStrip, WordRise, useScrollReveal } from './landingMotion';

/**
 * Public introduction page (route "/" when signed out). Structure, type sizes, spacing and colours follow
 * mentoredge.co.in/unirise section by section (light and dark), with its text word for word; the research portal
 * sections (portal, RISE, perspectives) use the same card patterns. Content only: it links to the separate sign-in page.
 */

export const ENQUIRY_EMAIL = 'corporate@mentoredge.co.in';
const HERO_PHOTO = 'https://images.unsplash.com/photo-1758518730178-6e237bc8b87d'; // the photo used on mentoredge.co.in/unirise

const svg = (d: ReactNode, cls = '') => <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>{d}</svg>;
const BOOK = <><path d="M12 7v14" /><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z" /></>;
const USERS = <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></>;
const TREND = <><polyline points="22 7 13.5 15.5 8.5 10.5 2 17" /><polyline points="16 7 22 7 22 13" /></>;
const LANDMARK = <><path d="M3 22h18" /><path d="M6 18v-7M10 18v-7M14 18v-7M18 18v-7" /><path d="m12 2 8 5H4Z" /></>;
const SHIELD = <><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" /><path d="m9 12 2 2 4-4" /></>;
const CHECK = <><circle cx="12" cy="12" r="10" /><path d="m9 12 2 2 4-4" /></>;

// ---- mentoredge.co.in/unirise ----
const ORBIT = [
  ['Customized Research Support', 'Tailored support for your faculty and research goals'],
  ['Industry Partnerships', 'Connect with industry on real projects and opportunities'],
  ['Analytics & Insights', 'Actionable analytics on research and partnerships'],
  ['Research Management System', 'Manage all your research in one digital place'],
];
const ECOSYSTEM = [
  ['Customized Research Support', 'Tailored capacity building programs designed to enhance faculty output and institutional research prestige'],
  ['Industry Partnerships', 'Strategic bridges connecting existing academic brilliance with real world corporate needs and commercialization'],
  ['Analytics & Insights', 'Data-driven intelligence to track performance, identify trends, and make key informed decisions'],
  ['Research Management System', 'A seamless, end-to-end digital infrastructure to streamline workflows and maximize institutional efficiency'],
];
type Tone = 'blue' | 'violet' | 'emerald';
interface Feature { title: string; icon: ReactNode; tone: Tone; points: string[]; who?: string }
const UNLOCKS: Feature[] = [
  { title: 'Institution-Wide Research Strategy', icon: BOOK, tone: 'blue', points: ['Map faculty, labs and projects into strategic clusters', 'Track funded projects, grants and proposals in one place', 'Spot gaps where new chairs, labs or courses can unlock value', 'Align annual plans with accreditation and ranking requirements'] },
  { title: 'Partnerships And Co-Innovation', icon: USERS, tone: 'violet', points: ['Standardised engagement models for corporate partners', 'Co-branded research programs and joint labs with transparent KPIs', 'Capstone projects and live problem statements', 'Ecosystem for IP sharing, technology licensing and spin-outs'] },
  { title: 'Impact, Analytics And Governance', icon: TREND, tone: 'emerald', points: ['Dashboards for publications, citations, grants and patents', 'View collaboration networks across departments and partners', 'Monitor pipeline health from ideas to pilots and products', 'Exportable reports that speak the language of accreditation'] },
];

// ---- the research portal ----
const RISE = [
  ['R', 'Record', 'Bring every publication, grant, academic milestone, and faculty achievement together in one living record of institutional research.'],
  ['I', 'Insight', 'See your institution\'s research landscape unfold—output, funding, and participation across researchers, departments, and years.'],
  ['S', 'Stewardship', 'Put research governance at the heart of the institution—with seamless approvals, complete traceability, and full ownership of research data.'],
  ['E', 'Elevate', 'Transform research achievements into institutional intelligence, accreditation excellence, and a reputation that reaches further.'],
];
// Matches what each role can actually do in the application.
const PERSPECTIVES: Feature[] = [
  { who: 'Faculty', title: 'Your research. Your achievements. Your identity.', icon: USERS, tone: 'blue', points: ['Build a living research profile that reflects every academic milestone.', 'Showcase verified achievements to peers, institutions, and collaborators.', 'Gain the visibility and recognition your research deserves.'] },
  { who: 'Institutional Leadership', title: 'See the bigger picture. Shape what comes next.', icon: LANDMARK, tone: 'violet', points: ['Discover institutional strengths across disciplines, expertise, and research priorities.', 'Track research performance, funding, and emerging trends across departments.', 'Turn trusted evidence into strategic decisions and accreditation-ready insights.'] },
  { who: 'Office of Research', title: 'Every achievement verified. Every decision accounted for.', icon: SHIELD, tone: 'emerald', points: ['Bring faculty affiliation, research submissions, and approvals into one seamless workflow.', 'Uphold institutional research standards through structured verification.', 'Maintain a complete, transparent record of research activity and approvals.'] },
];

const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

/** Public header for the UniRise site: UniRise-only navigation (no links to the main MentorEDGE website). */
export function PublicHeader() {
  const nav = useNavigate();
  const loc = useLocation();
  const go = (id: string) => (loc.pathname === '/' ? scrollTo(id) : nav(`/?s=${id}`));
  return (
    <header className="me-head">
      <Link className="me-logo" to="/" onClick={() => loc.pathname === '/' && scrollTo('top')} aria-label="UniRise by MentorEdge, overview"><Logo /></Link>
      <nav className="me-nav" aria-label="UniRise">
        <ul>
          <li><button type="button" onClick={() => go('top')}>Overview</button></li>
          <li><button type="button" onClick={() => go('rise')}>The RISE Framework</button></li>
          <li><button type="button" onClick={() => go('perspectives')}>Platform Perspectives</button></li>
          <li><Link to="/talk-to-our-team" className={loc.pathname === '/talk-to-our-team' ? 'on' : ''}>Talk to Our Team</Link></li>
        </ul>
      </nav>
      <div className="me-head-right">
        <ThemeToggle />
        <Link className="me-signin" to="/login">Sign In</Link>
      </div>
    </header>
  );
}

const PIN = <><path d="M20 10c0 4.99-5.54 10.19-7.4 11.8a1 1 0 0 1-1.2 0C9.54 20.19 4 14.99 4 10a8 8 0 0 1 16 0" /><circle cx="12" cy="10" r="3" /></>;
const PHONE = <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />;
const MAIL = <><rect width="20" height="16" x="2" y="4" rx="2" /><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" /></>;

/** Footer as on mentoredge.co.in/unirise, with the UniRise logo, Company and Contact Us columns. */
export function PublicFooter() {
  return (
    <footer className="me-foot">
      <div className="me-foot-glow" aria-hidden />
      <div className="me-foot-inner">
        <div className="me-foot-grid">
          <div>
            <Logo />
            <p className="me-foot-tag">Together, we are building the future of research - one discovery, one innovation, and one breakthrough at a time.</p>
          </div>
          <div>
            <h4>Company</h4>
            <ul>
              <li><Link to="/?s=about-unirise">About</Link></li>
              <li><Link to="/talk-to-our-team">Contact</Link></li>
              <li><a href="https://mentoredge.co.in/privacy" target="_blank" rel="noreferrer">Privacy Policy</a></li>
            </ul>
          </div>
          <div>
            <h4>Contact Us</h4>
            <ul className="me-foot-contact">
              <li>{svg(PIN, 'me-foot-ic')}<p>Prizlyn Technologies Pvt. Ltd., 2nd Floor, House No. 9, Sector-24, Pocket 1, Rohini Sec-11, North West Delhi, Delhi – 110085</p></li>
              <li>{svg(PHONE, 'me-foot-ic')}<a href="tel:18004101410">1800 410 1410</a></li>
              <li>{svg(MAIL, 'me-foot-ic')}<a href={`mailto:${ENQUIRY_EMAIL}`}>Email: {ENQUIRY_EMAIL}</a></li>
            </ul>
          </div>
        </div>
        <div className="me-foot-bottom"><p>© 2026 Prizlyn Technologies Pvt. Ltd. · MentorEDGE. All rights reserved.</p></div>
      </div>
    </footer>
  );
}

function FeatureCard({ f }: { f: Feature }) {
  return (
    <div className={`me-feature ${f.tone}`}>
      <div className="me-feature-head">
        <span className="me-feature-ic">{svg(f.icon)}</span>
        <div>{f.who && <p className="me-feature-who">{f.who}</p>}<h3>{f.title}</h3></div>
      </div>
      <div className="me-feature-rule" />
      <ul>{f.points.map((p) => <li key={p}>{svg(CHECK, 'me-check')}<span>{p}</span></li>)}</ul>
    </div>
  );
}

const FAQS: [string, ReactNode][] = [
  ['What is UniRise?', 'UniRise is a research management platform for universities and research institutions. It brings faculty profiles, publications, grants and fellowships, seed money, faculty development programmes, conferences, honours and awards, and intellectual property into one verified system, with reports and analytics built on top.'],
  ['Who uses UniRise?', 'Three groups, each with their own view. Faculty record and track their own research. The Office of Research verifies every entry and manages the institution’s accounts. Institutional leadership sees approved, institution-wide research performance to plan and decide.'],
  ['How does an entry get verified?', 'Faculty submit an entry with its supporting document. The Office of Research reviews it and approves it, returns it for correction with comments, or rejects it. Only approved entries count in reports, profiles and analytics, and every decision is kept in the entry’s history.'],
  ['Can faculty see each other’s data?', 'Faculty see and manage only their own records. Colleagues appear by name so that co-authors and co-investigators can be added to an entry, but their records, contact details and pending submissions stay private.'],
  ['What can institutional leadership see?', 'Leadership sees approved records across the institution: faculty profiles, research output, funding, collaboration networks, SDG alignment and department comparisons. It is a read-only view, so the record of research stays exactly as verified.'],
  ['Is our data kept separate from other institutions?', 'Yes. Each institution has its own database. Accounts belong to one institution, and nothing from one institution is visible to another.'],
  ['Does UniRise help with accreditation and rankings?', 'UniRise keeps a complete, verified record of research activity and produces annual activity reports, department and faculty-wise reports, and exports that institutions draw on when preparing accreditation and ranking submissions.'],
  ['How to get started?', <>Talk to our team. We set up your institution and its Office of Research, who then create accounts for faculty and leadership. There is no public sign-up. <Link to="/talk-to-our-team">Start the conversation</Link>.</>],
];

export function IntroLanding() {
  const [params] = useSearchParams();
  const target = params.get('s');
  useEffect(() => { if (target) setTimeout(() => scrollTo(target), 60); }, [target]);
  useScrollReveal('.me main > .me-section .me-container > *, .me main .me-card, .me main .me-three > *, .me main .orbit-panel, .me-cta-section .me-container > *');
  return (
    <div className="me">
      <PublicHeader />

      <main id="top">
        <section className="me-hero">
          <div className="me-hero-bg" aria-hidden>
            <div className="me-hero-photo" style={{ backgroundImage: `url("${HERO_PHOTO}")` }} />
            <div className="me-hero-veil" />
            <div className="me-hero-fade" />
            <div className="me-blob a" />
            <div className="me-blob b" />
          </div>
          <div className="me-hero-inner has-stack">
            <div className="me-hero-text">
            <h1><WordRise text="A Connected Framework For Institutional Research Growth" start={150} /></h1>
            <p className="me-hero-lead hero-in">UniRise is a comprehensive strategic framework designed to bridge the gap between academic potential and global research impact. We provide the tools, networks and insights necessary for institutions to strengthen research quality, deepen collaborations and elevate institutional standing.</p>
            </div>
            <HeroStack />
          </div>
        </section>

        {/* ---------- research film ---------- */}
        <section className="me-section rf-section" id="film">
          <div className="me-container wide">
            <ResearchFilm />
          </div>
        </section>

        <section className="me-section" id="about-unirise">
          <div className="me-container wide">
            <p className="me-eyebrow me-mb">For universities and research institutions</p>
            <div className="me-about">
              <div>
                <h2 className="me-h2">Turning Academic Strength Into Industry-Visible Impact</h2>
                <p className="me-p">Many universities invest in strong faculty and research labs but still struggle to translate that work into visible outcomes: industry-funded projects, high quality publications, patents and employable talent. UniRise is built as a connective tissue between your internal research ecosystem and the outside world.</p>
                <p className="me-p">Inspired by global best practices in academia–industry collaboration, UniRise helps align institutional priorities with concrete programs: themed research clusters, joint industry chairs, co-developed curricula and startup pipelines that grow out of real research, not isolated hackathons.</p>
                <p className="me-p">Institutions use UniRise to build a recurring partnership engine: clear engagement models for companies, transparent expectations for faculty, and a shared digital space where every collaboration, project and outcome is documented and measurable.</p>
              </div>
              <OrbitPanel names={ORBIT.map(([t]) => t)} />
            </div>
          </div>
        </section>

        <section className="me-section" id="ecosystem">
          <div className="me-container">
            <p className="me-eyebrow me-mb">Unirise Ecosystem</p>
            <div className="me-eco">
              {ECOSYSTEM.map(([t, d], i) => <EcoCard key={t} i={i} title={t} text={d} />)}
            </div>
          </div>
        </section>

        {/* ---------- research at work (photographs) ---------- */}
        <section className="me-section me-pb-only" id="research-at-work">
          <div className="me-container">
            <p className="me-eyebrow me-mb">Inside the research</p>
            <h2 className="me-h2 narrow">Where great research happens</h2>
            <p className="me-p narrow">In labs and libraries, out in the field and in front of an audience. UniRise brings all of it into one place.</p>
            <ResearchGallery />
          </div>
        </section>

        <section className="me-section me-pb-only">
          <div className="me-container">
            <p className="me-eyebrow me-mb">What UniRise unlocks for your campus</p>
            <div className="me-three">{UNLOCKS.map((f) => <FeatureCard key={f.title} f={f} />)}</div>
          </div>
        </section>

        {/* ---------- the UniRise research portal ---------- */}
        <section className="me-section me-pb-only" id="portal">
          <div className="me-container">
            <p className="me-eyebrow me-mb">The UniRise research portal</p>
            <h2 className="me-h2 narrow">One Platform for your Research</h2>
            <p className="me-p narrow">A unified research management platform that brings faculty achievements, publications, grants, research collaborations and institutional performance into one verified and intelligent system.</p>
          </div>
        </section>

        <section className="me-section me-pb-only" id="rise">
          <div className="me-container">
            <p className="me-eyebrow me-mb">The RISE framework</p>
            <h2 className="me-h2 narrow">From research activity to institutional intelligence</h2>
            <RiseStrip items={RISE} />
          </div>
        </section>

        <section className="me-section me-pb-only" id="perspectives">
          <div className="me-container">
            <p className="me-eyebrow me-mb">One platform. Three perspectives. A stronger research institution.</p>
            <h2 className="me-h2 narrow">Built for everyone who shapes research</h2>
            <div className="me-three">{PERSPECTIVES.map((f) => <FeatureCard key={f.who} f={f} />)}</div>
          </div>
        </section>

        {/* ---------- FAQs ---------- */}
        <section className="me-section me-pb-only" id="faqs">
          <div className="me-container">
            <p className="me-eyebrow me-mb">Frequently Asked Questions (FAQs)</p>
            <Faqs items={FAQS} />
            <p className="faq-more">Still have a question? <Link to="/talk-to-our-team">Talk to our team</Link></p>
          </div>
        </section>

        <section className="me-cta-section">
          <div className="me-cta-container">
            <div className="me-cta">
              <div className="me-blob c1" aria-hidden />
              <div className="me-blob c2" aria-hidden />
              <div className="me-cta-body">
                <h2 className="me-h2">Ready to Transform Your Institution with UniRise?</h2>
                <p>Whether you lead a university, college, or research institution, our team will work with you to craft the ideal partnership. Reach out today for a complementary consultation.</p>
                <Link className="me-cta-btn" to="/talk-to-our-team">Talk to our team</Link>
              </div>
            </div>
          </div>
        </section>
      </main>
      <PublicFooter />
    </div>
  );
}
