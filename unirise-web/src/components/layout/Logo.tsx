export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <span className="grid size-9 place-items-center rounded-xl bg-primary text-primary-foreground shadow-[0_10px_24px_hsl(var(--primary)/0.25)]" aria-hidden>
        <svg viewBox="0 0 32 32" className="size-5"><path d="M9 8v9a7 7 0 0 0 14 0V8" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" /></svg>
      </span>
      <span className="text-lg font-semibold tracking-tight">Uni<span className="text-primary">Rise</span></span>
    </span>
  );
}
