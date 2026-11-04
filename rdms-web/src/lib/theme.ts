import { useSyncExternalStore } from 'react';

export type Theme = 'light' | 'dark';
const KEY = 'rdms-theme';
const listeners = new Set<() => void>();

function initial(): Theme {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch { /* storage blocked: fall through */ }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

let current: Theme = initial();
document.documentElement.dataset.theme = current;

export function setTheme(t: Theme) {
  current = t;
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem(KEY, t); } catch { /* not persisted */ }
  listeners.forEach((l) => l());
}

export const toggleTheme = () => setTheme(current === 'dark' ? 'light' : 'dark');

export function useTheme(): Theme {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => current);
}
