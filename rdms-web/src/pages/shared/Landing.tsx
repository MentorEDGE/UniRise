import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';

/** Landing-page copy and sections shown around the sign-in form. Content only: no data, no routes. */

const Icon = ({ children }: { children: ReactNode }) => <svg viewBox="0 0 24 24" aria-hidden>{children}</svg>;

const ICONS = {
  vault: <Icon><rect x="3.5" y="4" width="17" height="16" rx="2.5" /><circle cx="12" cy="12" r="3.2" /><path d="M12 8.8V7M12 17v-1.8M15.2 12H17M7 12h1.8" /></Icon>,
  seal: <Icon><path d="M12 3 4.5 6v5.5c0 4.6 3.1 8.2 7.5 9.5 4.4-1.3 7.5-4.9 7.5-9.5V6L12 3Z" /><path d="m8.8 12 2.2 2.2 4.2-4.4" /></Icon>,
  layers: <Icon><path d="m12 3.5 8.5 4.5-8.5 4.5L3.5 8 12 3.5Z" /><path d="m3.5 12 8.5 4.5 8.5-4.5" /><path d="m3.5 16 8.5 4.5 8.5-4.5" /></Icon>,
  record: <Icon><path d="M7 3.5h7.5L19 8v12.5H7Z" /><path d="M14.5 3.5V8H19" /><path d="M10 12.5h6M10 16h4" /><path d="M5 6.5v14h1" /></Icon>,
  insight: <Icon><path d="M4 20h16" /><rect x="5.5" y="12" width="3" height="5.5" rx="0.8" /><rect x="10.5" y="8" width="3" height="9.5" rx="0.8" /><rect x="15.5" y="4.5" width="3" height="13" rx="0.8" /></Icon>,
  steward: <Icon><path d="M12 3.5v17" /><path d="M5 7.5h14" /><path d="m5 7.5-2.5 6a3 3 0 0 0 5 0Z" /><path d="m19 7.5-2.5 6a3 3 0 0 0 5 0Z" /><path d="M8.5 20.5h7" /></Icon>,
  elevate: <Icon><path d="M4 19 10 13l3.5 3.5L20 10" /><path d="M15 10h5v5" /></Icon>,
  faculty: <Icon><circle cx="12" cy="8" r="3.5" /><path d="M5 20.5c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5" /></Icon>,
  leadership: <Icon><path d="M3.5 9.5 12 4l8.5 5.5" /><path d="M5.5 10v8M9.5 10v8M14.5 10v8M18.5 10v8" /><path d="M3.5 20.5h17" /></Icon>,
  office: <Icon><rect x="4" y="10.5" width="16" height="10" rx="2" /><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" /><circle cx="12" cy="15.5" r="1.6" /></Icon>,
};

/** Fades a block in the first time it scrolls into view (instantly when motion is reduced). */
function Reveal({ children, className = '', delay = 0, as: Tag = 'div' }: { children: ReactNode; className?: string; delay?: number; as?: 'div' | 'li' | 'section' }) {
  const ref = useRef<HTMLElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || !('IntersectionObserver' in window)) { setShown(true); return; }
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setShown(true); io.disconnect(); } }, { rootMargin: '0px 0px -8% 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return <Tag ref={ref as never} className={`reveal ${shown ? 'in' : ''} ${className}`} style={{ '--d': `${delay}ms` } as CSSProperties}>{children}</Tag>;
}

export function LandingHero() {
  return (
    <section className="intro-hero">
      <p className="eyebrow">Research management for universities</p>
      <h1>A connected framework for institutional research growth</h1>
      <p className="hero-slogan">Every contribution counted. Every institution elevated.</p>
      <p className="lead">
        Each college and university gets its own secure research environment. Publications, grants, seed money, FDPs,
        conferences and faculty profiles live in one place, with approvals and analytics that leadership can act on.
      </p>
      <ul className="hero-proof">
        <li>{ICONS.vault}<span>A separate database for every institution</span></li>
        <li>{ICONS.seal}<span>Access approved by your Office of Research</span></li>
        <li>{ICONS.layers}<span>Role-based views for faculty and leadership</span></li>
      </ul>
    </section>
  );
}

const RISE = [
  { letter: 'R', name: 'Record', icon: ICONS.record, text: 'Every publication, grant, FDP and conference captured once, at the source, with its evidence.' },
  { letter: 'I', name: 'Insight', icon: ICONS.insight, text: 'Output, funding and participation by department, year and researcher, the moment entries are approved.' },
  { letter: 'S', name: 'Stewardship', icon: ICONS.steward, text: 'Clear review and approval workflows, a full audit trail, and data that never leaves its institution.' },
  { letter: 'E', name: 'Elevate', icon: ICONS.elevate, text: 'Verified records become accreditation-ready reports and decisions that raise research standing.' },
];

const AUDIENCES = [
  { who: 'Faculty', icon: ICONS.faculty, line: 'Your research record, always current.', points: ['Log achievements in minutes', 'Track every approval', 'Print a ready CV'] },
  { who: 'Top-Level Management', icon: ICONS.leadership, line: 'Clarity for every decision.', points: ['Department benchmarks and targets', 'Trends across academic years', 'Annual reports on demand'] },
  { who: 'Office of Research', icon: ICONS.office, line: 'Governance without the paperwork.', points: ['Verify affiliation before access', 'Approve, suspend or restore accounts', 'Every decision on record'] },
];

export function LandingShowcase() {
  return (
    <div className="showcase">
      <section className="show-block" aria-labelledby="rise-title">
        <Reveal className="show-head">
          <p className="eyebrow">The RISE framework</p>
          <h2 id="rise-title">From faculty activity to institutional intelligence</h2>
          <p className="show-sub">Four disciplines that turn scattered academic records into a research strategy.</p>
        </Reveal>
        <ul className="rise-grid">
          {RISE.map((r, i) => (
            <Reveal as="li" key={r.letter} className="rise-card" delay={i * 80}>
              <div className="rise-top"><span className="rise-letter" aria-hidden>{r.letter}</span><span className="rise-icon">{r.icon}</span></div>
              <h3>{r.name}</h3>
              <p>{r.text}</p>
            </Reveal>
          ))}
        </ul>
      </section>

      <section className="show-block" aria-labelledby="roles-title">
        <Reveal className="show-head">
          <p className="eyebrow">One platform, three perspectives</p>
          <h2 id="roles-title">Built for everyone who shapes research</h2>
        </Reveal>
        <ul className="role-grid">
          {AUDIENCES.map((a, i) => (
            <Reveal as="li" key={a.who} className="role-card" delay={i * 80}>
              <span className="role-icon">{a.icon}</span>
              <p className="role-who">{a.who}</p>
              <h3>{a.line}</h3>
              <ul>{a.points.map((p) => <li key={p}>{p}</li>)}</ul>
            </Reveal>
          ))}
        </ul>
      </section>

      <Reveal as="section" className="show-close">
        <p className="close-line">Where scholarship becomes institutional strength.</p>
        <p className="close-sign">UniRise by MentorEdge · powering research</p>
      </Reveal>
    </div>
  );
}
