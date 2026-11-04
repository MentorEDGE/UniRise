/** UniRise mark and wordmark, as in ../unirise-web/src/components/layout/Logo.tsx. */
export function LogoMark() {
  return (
    <span className="brand-mark" aria-hidden>
      <svg viewBox="0 0 32 32"><path d="M9 8v9a7 7 0 0 0 14 0V8" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" /></svg>
    </span>
  );
}

export function Logo() {
  return (
    <span className="brand">
      <LogoMark />
      <span className="brand-word">Uni<span>Rise</span></span>
    </span>
  );
}
