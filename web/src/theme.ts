import { useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';
/**
 * What the user picked: a fixed theme, follow the system (stored as no entry), or 모니터링 — Dispatch's dark-first
 * theme: it renders as dark (data-theme="dark", so canvas and dark: variants follow) plus html.monitor for its tokens.
 */
export type ThemePref = Theme | 'system' | 'monitor';
const KEY = 'drawing.theme';

const systemTheme = (): Theme => (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

const parsePref = (s: string | null): ThemePref => (s === 'light' || s === 'dark' || s === 'monitor' ? s : 'system');

const initialPref = (): ThemePref => {
  try {
    return parsePref(localStorage.getItem(KEY));
  } catch {
    return 'system'; // storage blocked
  }
};

/** [theme in effect, toggle light/dark, preference, set preference, system scheme]. 'system' follows prefers-color-scheme live. */
export function useTheme() {
  const [pref, setPref] = useState<ThemePref>(initialPref);
  const [system, setSystem] = useState<Theme>(systemTheme);
  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const on = () => setSystem(mq.matches ? 'dark' : 'light');
    mq.addEventListener('change', on);
    // Another tab changed the choice: follow it.
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY || e.key === null) setPref(parsePref(e.newValue));
    };
    addEventListener('storage', onStorage);
    return () => {
      mq.removeEventListener('change', on);
      removeEventListener('storage', onStorage);
    };
  }, []);
  const theme: Theme = pref === 'system' ? system : pref === 'monitor' ? 'dark' : pref;
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme;
    root.classList.toggle('monitor', pref === 'monitor');
    try {
      if (pref === 'system') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, pref);
    } catch {
      /* ignore */
    }
  }, [theme, pref]);
  const toggle = () => setPref(theme === 'dark' ? 'light' : 'dark');
  return [theme, toggle, pref, setPref, system] as const;
}
