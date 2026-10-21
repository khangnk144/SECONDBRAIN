import type { ThemePreference, UiPrefs } from './ui-prefs';

const LIGHT_QUERY = '(prefers-color-scheme: light)';

/** Resolves 'system' to the OS color scheme; 'dark' and 'light' pass through. */
export function resolveTheme(theme: ThemePreference, win: Window = window): 'dark' | 'light' {
  if (theme !== 'system') return theme;
  const prefersLight = typeof win.matchMedia === 'function' && win.matchMedia(LIGHT_QUERY).matches;
  return prefersLight ? 'light' : 'dark';
}

/** The OS-theme listener of each document, so applying new prefs replaces the old one. */
const followers = new WeakMap<Document, () => void>();

/**
 * Applies theme, palette, font size and language to <html> (the CSS reads the data attributes,
 * so every screen restyles at once, without a reload). With 'system' it keeps following OS theme
 * changes until prefs are applied again. Returns a cleanup function that stops following.
 */
export function applyUiPrefs(prefs: UiPrefs, doc: Document = document): () => void {
  followers.get(doc)?.();
  followers.delete(doc);
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
  const stop = () => {
    query.removeEventListener('change', apply);
    if (followers.get(doc) === stop) followers.delete(doc);
  };
  followers.set(doc, stop);
  return stop;
}
