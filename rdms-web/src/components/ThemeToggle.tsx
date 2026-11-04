import { toggleTheme, useTheme } from '../lib/theme';

/** Sun / moon switch between light and dark mode. The choice is kept in this browser. */
export function ThemeToggle() {
  const dark = useTheme() === 'dark';
  const label = dark ? 'Switch to light mode' : 'Switch to dark mode';
  return (
    <button type="button" className="theme-toggle" onClick={toggleTheme} aria-label={label} title={label}>
      {dark ? (
        <svg viewBox="0 0 24 24" aria-hidden><circle cx="12" cy="12" r="4.5" /><path d="M12 2v2.5M12 19.5V22M4.2 4.2l1.8 1.8M18 18l1.8 1.8M2 12h2.5M19.5 12H22M4.2 19.8 6 18M18 6l1.8-1.8" /></svg>
      ) : (
        <svg viewBox="0 0 24 24" aria-hidden><path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11Z" /></svg>
      )}
    </button>
  );
}
