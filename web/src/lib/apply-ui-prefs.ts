import type { ThemePreference, UiPrefs } from './ui-prefs';

const LIGHT_QUERY = '(prefers-color-scheme: light)';

/** Resolves 'system' to the OS color scheme; 'dark' and 'light' pass through. */
export function resolveTheme(theme: ThemePreference, win: Window = window): 'dark' | 'light' {
  if (theme !== 'system') return theme;
  const prefersLight = typeof win.matchMedia === 'function' && win.matchMedia(LIGHT_QUERY).matches;
  return prefersLight ? 'light' : 'dark';
}

/**
 * Applies theme, palette, font size and language to <html>. Returns a cleanup
 * function that stops following OS theme changes (only relevant for 'system').
 */
export function applyUiPrefs(prefs: UiPrefs, doc: Document = document): () => void {
  const root = doc.documentElement;
  const win = doc.defaultView ?? window;
  const apply = () => {
    root.dataset.theme = resolveTheme(prefs.theme, win);
  };
  apply();
  root.dataset.palette = prefs.palette;
  root.dataset.fontSize = String(prefs.fontSize);
  root.lang = prefs.language;

  if (prefs.theme !== 'system' || typeof win.matchMedia !== 'function') return () => {};
  const query = win.matchMedia(LIGHT_QUERY);
  query.addEventListener('change', apply);
  return () => query.removeEventListener('change', apply);
}
