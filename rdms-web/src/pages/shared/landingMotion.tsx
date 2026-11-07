import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { SdgTile } from '../../components/sdg';

/**
 * Motion for the public introduction page: words that rise into place, a shuffling stack of product cards in the hero,
 * sections that fade up as they scroll into view, and the RISE framework as an expanding strip. Everything stays still
 * for people who ask their device for reduced motion, and the moving parts have a pause button.
 */

export const prefersReducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Fades content up as it enters the screen. Marks the elements matching `selector` inside `root` and watches them. */
export function useScrollReveal(selector: string) {
  useEffect(() => {
    const els = [...document.querySelectorAll<HTMLElement>(selector)];
    if (prefersReducedMotion() || !('IntersectionObserver' in window)) return;
    els.forEach((el) => {
      const siblings = el.parentElement ? [...el.parentElement.children].filter((c) => c.matches(selector)) : [el];
      el.style.setProperty('--rv-delay', `${Math.min(siblings.indexOf(el), 5) * 90}ms`);
      el.classList.add('rv');
    });
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.12 });
    els.forEach((el) => io.observe(el));
    return () => { io.disconnect(); els.forEach((el) => el.classList.remove('rv', 'in')); };
  }, [selector]);
}

/** A heading whose words rise into place one after another. Screen readers get the plain sentence. */
export function WordRise({ text, start = 0, step = 70 }: { text: string; start?: number; step?: number }) {
  const words = text.split(' ');
  return (
    <>
      <span className="sr-only">{text}</span>
      <span className="wr" aria-hidden>
        {words.map((w, i) => <span key={i} className="wr-w" style={{ animationDelay: `${start + i * step}ms` }}>{w}{i < words.length - 1 ? ' ' : ''}</span>)}
      </span>
    </>
  );
}

const STEP = 3400;

/** The hero's stack of cards showing what UniRise does; the front card steps back and the next one comes forward. */
export function HeroStack() {
  const cards: { key: string; body: ReactNode }[] = [
    { key: 'profile', body: <ProfileCard /> },
    { key: 'sdg', body: <SdgCard /> },
    { key: 'approval', body: <ApprovalCard /> },
    { key: 'network', body: <NetworkCard /> },
  ];
  const [front, setFront] = useState(0);
  const [paused, setPaused] = useState(() => prefersReducedMotion());
  const hover = useRef(false);
  useEffect(() => {
    if (paused) return;
    const t = setInterval(() => { if (!hover.current && !document.hidden) setFront((f) => (f + 1) % cards.length); }, STEP);
    return () => clearInterval(t);
  }, [paused, cards.length]);
  const n = cards.length;
  return (
    <div className="hs" onMouseEnter={() => { hover.current = true; }} onMouseLeave={() => { hover.current = false; }}>
      <button type="button" className="hs-pause" onClick={() => setPaused((p) => !p)} aria-label={paused ? 'Play the animation' : 'Pause the animation'} aria-pressed={paused}>
        {paused ? <svg viewBox="0 0 16 16" aria-hidden><path d="M5 3.5v9l7.5-4.5Z" /></svg> : <svg viewBox="0 0 16 16" aria-hidden><path d="M5 3.5h2v9H5zM9 3.5h2v9H9z" /></svg>}
      </button>
      <div className="hs-stage" aria-roledescription="carousel" aria-label="What UniRise brings together">
        {cards.map((c, i) => {
          const slot = (i - front + n) % n; // 0 front, 1 next (right), n-1 previous (left), others waiting behind
          const pos = slot === 0 ? 'front' : slot === 1 ? 'right' : slot === n - 1 ? 'left' : 'back';
          return <div key={c.key} className={`hs-card ${pos}`} aria-hidden={pos !== 'front'}>{c.body}</div>;
        })}
      </div>
      <div className="hs-dots" role="tablist" aria-label="Choose a card">
        {cards.map((c, i) => <button key={c.key} type="button" role="tab" aria-selected={i === front} aria-label={`Card ${i + 1} of ${n}`} className={i === front ? 'on' : ''} onClick={() => setFront(i)} />)}
      </div>
    </div>
  );
}

function ProfileCard() {
  const bars = [3, 5, 4, 7, 6, 9, 8];
  return (
    <div className="hc">
      <p className="hc-kicker">Researcher profile</p>
      <div className="hc-person">
        <span className="hc-avatar" aria-hidden><svg viewBox="0 0 40 44"><circle cx="20" cy="15" r="8.5" /><path d="M4 44c0-9.5 7.2-16 16-16s16 6.5 16 16Z" /></svg></span>
        <div><b>Dr. Faculty A</b><span>Professor · Computer Science &amp; Engineering</span></div>
      </div>
      <div className="hc-bars" aria-hidden>{bars.map((h, i) => <i key={i} style={{ height: `${h * 9}%`, ['--b' as string]: i }} className={i === bars.length - 1 ? 'now' : ''} />)}</div>
      <div className="hc-stats"><span><b>42</b> publications</span><span><b>6</b> grants</span><span><b>2</b> patents</span></div>
    </div>
  );
}
function SdgCard() {
  return (
    <div className="hc">
      <p className="hc-kicker">Sustainable Development Goals</p>
      <div className="hc-sdg"><SdgTile n={9} size={64} /><div><b>SDG 9</b><span>Industry, Innovation and Infrastructure</span></div></div>
      <div className="hc-rows">
        <span><b>16</b> profiles</span><span><b>3</b> research units</span><span><b>162</b> outputs</span>
      </div>
    </div>
  );
}
function ApprovalCard() {
  return (
    <div className="hc">
      <p className="hc-kicker">Office of Research</p>
      <span className="hc-tag">Patent · Filed</span>
      <p className="hc-title">A low-cost sensor for soil moisture</p>
      <ol className="hc-steps">
        <li className="done">Submitted by Dr. Faculty M</li>
        <li className="done">Filing receipt checked</li>
        <li className="ok">Approved</li>
      </ol>
    </div>
  );
}
function NetworkCard() {
  const nodes: [number, number, string][] = [[50, 48, 'a'], [20, 22, 'b'], [82, 20, 'c'], [16, 74, 'd'], [84, 76, 'b'], [52, 88, 'c'], [50, 14, 'd']];
  const links = [[0, 1], [0, 2], [0, 3], [0, 4], [0, 5], [1, 6], [2, 6], [3, 5], [4, 5], [1, 3]];
  return (
    <div className="hc">
      <p className="hc-kicker">Collaboration network</p>
      <svg className="hc-net" viewBox="0 0 100 100" aria-hidden>
        {links.map(([a, b]) => <line key={`${a}-${b}`} x1={nodes[a][0]} y1={nodes[a][1]} x2={nodes[b][0]} y2={nodes[b][1]} />)}
        {nodes.map(([x, y, t], i) => <circle key={i} cx={x} cy={y} r={i === 0 ? 6.5 : 4.5} className={t} />)}
      </svg>
      <div className="hc-stats"><span><b>36</b> faculty</span><span><b>250</b> shared outputs</span><span><b>8</b> countries</span></div>
    </div>
  );
}

/** The four RISE disciplines as panels: one open with its text, the rest slim; it moves on by itself or with the arrows. */
export function RiseStrip({ items }: { items: string[][] }) {
  const [open, setOpen] = useState(0);
  const [paused, setPaused] = useState(() => prefersReducedMotion());
  const hold = useRef(false);
  useEffect(() => {
    if (paused) return;
    const t = setInterval(() => { if (!hold.current && !document.hidden) setOpen((o) => (o + 1) % items.length); }, 5200);
    return () => clearInterval(t);
  }, [paused, items.length]);
  const go = (d: number) => setOpen((o) => (o + d + items.length) % items.length);
  return (
    <div className="rs" onMouseEnter={() => { hold.current = true; }} onMouseLeave={() => { hold.current = false; }} onFocus={() => { hold.current = true; }} onBlur={() => { hold.current = false; }}>
      <div className="rs-tools">
        <button type="button" onClick={() => setPaused((p) => !p)} aria-label={paused ? 'Play' : 'Pause'} aria-pressed={paused}>
          {paused ? <svg viewBox="0 0 16 16" aria-hidden><path d="M5 3.5v9l7.5-4.5Z" /></svg> : <svg viewBox="0 0 16 16" aria-hidden><path d="M5 3.5h2v9H5zM9 3.5h2v9H9z" /></svg>}
        </button>
        <button type="button" onClick={() => go(-1)} aria-label="Previous"><svg viewBox="0 0 16 16" aria-hidden><path d="M10 3 5 8l5 5" /></svg></button>
        <button type="button" onClick={() => go(1)} aria-label="Next"><svg viewBox="0 0 16 16" aria-hidden><path d="m6 3 5 5-5 5" /></svg></button>
      </div>
      <ol className="rs-row">
        {items.map(([l, t, d], i) => (
          <li key={l} className={`rs-panel ${i === open ? 'open' : ''}`}>
            <button type="button" className="rs-head" onClick={() => setOpen(i)} aria-expanded={i === open}>
              <span className="rs-letter">{l}</span><span className="rs-name">{t}</span>
            </button>
            <div className="rs-body" aria-hidden={i !== open}><h3>{t}</h3><p>{d}</p><span className="rs-step">{i + 1} / {items.length}</span></div>
          </li>
        ))}
      </ol>
    </div>
  );
}

const ECO_ICONS: ReactNode[] = [
  <><path d="M12 3 4 7v5c0 4.6 3.4 8.4 8 9 4.6-.6 8-4.4 8-9V7Z" /><path d="m8.5 12 2.5 2.5 4.5-5" /></>,
  <><path d="M8 12h8" /><rect x="2.5" y="8" width="6" height="8" rx="2" /><rect x="15.5" y="8" width="6" height="8" rx="2" /><path d="M5.5 8V5.5M18.5 8V5.5M5.5 16v2.5M18.5 16v2.5" /></>,
  <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /><path d="m3 7 6-3 6 6 6-4" /></>,
  <><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M8 21h8M12 17v4M7 9h4M7 12h7" /><circle cx="16.5" cy="9.5" r="1.5" /></>,
];

/** An ecosystem box: an icon that draws in, an accent line and a light that follows the pointer. */
export function EcoCard({ i, title, text }: { i: number; title: string; text: string }) {
  return (
    <div className="me-card eco-card" onPointerMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); e.currentTarget.style.setProperty('--mx', `${e.clientX - r.left}px`); e.currentTarget.style.setProperty('--my', `${e.clientY - r.top}px`); }}>
      <span className="eco-line" aria-hidden />
      <div className="eco-top">
        <svg className="eco-ic" viewBox="0 0 24 24" aria-hidden>{ECO_ICONS[i % ECO_ICONS.length]}</svg>
      </div>
      <h3>{title}</h3><p>{text}</p>
    </div>
  );
}

/** "What UniRise orbits around": a small orbit drawing, and the names lit one at a time as if in orbit. */
export function OrbitPanel({ names }: { names: string[] }) {
  const [on, setOn] = useState(0);
  const hold = useRef(false);
  useEffect(() => {
    if (prefersReducedMotion()) return;
    const t = setInterval(() => { if (!hold.current && !document.hidden) setOn((o) => (o + 1) % names.length); }, 2400);
    return () => clearInterval(t);
  }, [names.length]);
  return (
    <div className="me-panel orbit-panel">
      <div className="me-blob p1" aria-hidden />
      <div className="me-blob p2" aria-hidden />
      <svg className="orbit-art" viewBox="0 0 120 120" aria-hidden>
        <g transform="rotate(-20 60 60)">
          <path id="orbit-outer" className="ring" d="M8 60a52 22 0 1 0 104 0a52 22 0 1 0-104 0" />
          {!prefersReducedMotion() && <circle className="planet a" r="4.5"><animateMotion dur="14s" repeatCount="indefinite"><mpath href="#orbit-outer" /></animateMotion></circle>}
        </g>
        <g transform="rotate(28 60 60)">
          <path id="orbit-inner" className="ring" d="M26 60a34 14 0 1 0 68 0a34 14 0 1 0-68 0" />
          {!prefersReducedMotion() && <circle className="planet b" r="3.5"><animateMotion dur="8s" repeatCount="indefinite" keyPoints="1;0" keyTimes="0;1" calcMode="linear"><mpath href="#orbit-inner" /></animateMotion></circle>}
        </g>
        <circle className="sun" cx="60" cy="60" r="8" />
      </svg>
      <div className="me-panel-body">
        <div>
          <p className="me-panel-eyebrow">WHAT UNIRISE ORBITS AROUND</p>
          <p className="me-panel-title">A single view of research, partnerships and outcomes</p>
        </div>
        <div className="me-orbit" onMouseLeave={() => { hold.current = false; }}>
          {names.map((t, i) => (
            <div key={t} className={`orbit-row ${i === on ? 'on' : ''}`} style={{ ['--i' as string]: i }} onMouseEnter={() => { hold.current = true; setOn(i); }}>
              <span className="orbit-dot" aria-hidden />
              <p className="me-orbit-name">{t}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Photographs of research at work, in a mosaic that wipes in on scroll and drifts on hover. Photos from Unsplash. */
const SHOTS = [
  { src: '/images/research/microscope.jpg', label: 'Life sciences', alt: 'A researcher in a lab coat looking through a microscope', credit: 'Trust “Tru” Katsande' },
  { src: '/images/research/pipette.jpg', label: 'Experiments', alt: 'A scientist in blue gloves pipetting into a row of sample tubes', credit: 'Julia Koblitz' },
  { src: '/images/research/presenting.jpg', label: 'Presenting findings', alt: 'A researcher presenting a chart on a screen to colleagues', credit: 'Vitaly Gariev' },
  { src: '/images/research/engineering.jpg', label: 'Engineering', alt: 'A 3D printer building parts in an engineering lab', credit: 'Jakub Żerdzicki' },
  { src: '/images/research/field.jpg', label: 'Field research', alt: 'A surveyor looking through a surveying instrument in a green field', credit: 'Nazmul ahsan Meraz' },
  { src: '/images/research/library.jpg', label: 'Library research', alt: 'A researcher working on a laptop in a library lined with books', credit: 'Zoshua Colah' },
];
export function ResearchGallery() {
  return (
    <>
      <div className="rg">
        {SHOTS.map((s, i) => (
          <figure key={s.src} className={`rg-tile t${i}`} style={{ ['--i' as string]: i }}>
            <img src={s.src} alt={s.alt} loading="lazy" decoding="async" />
            <figcaption><span className="rg-dot" aria-hidden />{s.label}</figcaption>
          </figure>
        ))}
      </div>
      <p className="rg-credit">Photos: {SHOTS.map((s) => s.credit).filter((c, i, a) => a.indexOf(c) === i).join(', ')} on Unsplash</p>
    </>
  );
}

/** A short silent film of research at work beside a two-part line that appears as it scrolls into view. */
export function ResearchFilm() {
  const ref = useRef<HTMLVideoElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  const [paused, setPaused] = useState(() => prefersReducedMotion());
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    if (!('IntersectionObserver' in window)) { setShown(true); return; }
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) setShown(true);
      const v = ref.current;
      if (!v) return;
      if (e.isIntersecting && !paused) v.play().catch(() => {}); else v.pause();
    }, { threshold: 0.25 });
    io.observe(el);
    return () => io.disconnect();
  }, [paused]);
  const toggle = () => {
    const v = ref.current;
    if (!v) return;
    if (v.paused) { v.play().catch(() => {}); setPaused(false); } else { v.pause(); setPaused(true); }
  };
  return (
    <div ref={box} className={`rf ${shown ? 'shown' : ''}`}>
      <h2 className="rf-line">
        <span className="rf-a"><WordRise text="Every breakthrough begins with someone asking why" step={60} /></span>
        <span className="rf-b">UniRise makes sure the world sees the answer</span>
      </h2>
      <div className="rf-media">
        <img className="rf-peek l" src="/images/research/field.jpg" alt="" aria-hidden />
        <img className="rf-peek r" src="/images/research/library.jpg" alt="" aria-hidden />
        <div className="rf-frame">
          <video ref={ref} src="/video/research-reel.mp4" poster="/video/research-reel.jpg" muted loop playsInline preload="metadata"
            aria-label="Researchers at a microscope, sowing a seed, discussing at a whiteboard, working in a lab, over crop fields and studying a brain model on screen" />
          <button type="button" className="rf-pause" onClick={toggle} aria-label={paused ? 'Play the video' : 'Pause the video'} aria-pressed={paused}>
            {paused ? <svg viewBox="0 0 16 16" aria-hidden><path d="M5 3.5v9l7.5-4.5Z" /></svg> : <svg viewBox="0 0 16 16" aria-hidden><path d="M5 3.5h2v9H5zM9 3.5h2v9H9z" /></svg>}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Questions institutions ask before they start; one answer open at a time. */
export function Faqs({ items }: { items: [string, ReactNode][] }) {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <div className="faq">
      {items.map(([q, a], i) => {
        const on = open === i;
        return (
          <div key={q} className={`faq-item ${on ? 'on' : ''}`}>
            <h3>
              <button type="button" aria-expanded={on} aria-controls={`faq-a-${i}`} id={`faq-q-${i}`} onClick={() => setOpen(on ? null : i)}>
                <span>{q}</span><span className="faq-ic" aria-hidden />
              </button>
            </h3>
            <div className="faq-a" id={`faq-a-${i}`} role="region" aria-labelledby={`faq-q-${i}`}>
              <div><div className="faq-a-in">{a}</div></div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
