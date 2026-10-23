import { useEffect, useState } from 'react';
import type { ShellWidth } from '../lib/panes-store';

/** Below this bento opens the folder tree as a drawer on note routes too: the note keeps room. */
export const MEDIUM_QUERY = '(max-width: 1199px)';
/** Below this the bento rail is a row on top (F35.5). */
export const NARROW_QUERY = '(max-width: 959px)';
/** Phone widths (F28.1): bottom tab bar, sidebar drawer, right panel as a bottom sheet. */
export const COMPACT_QUERY = '(max-width: 600px)';

type Listener = () => void;

function matchesNow(query: string): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return (window.matchMedia(query) as MediaQueryList | undefined)?.matches === true;
}

/**
 * Listens to one media list, defensively: jsdom has no `matchMedia`, some tests stub it with an
 * object without listener methods, and older engines only know `addListener`.
 */
function watch(query: string, onChange: Listener): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
  const list = window.matchMedia(query) as MediaQueryList | undefined;
  if (list && typeof list.addEventListener === 'function') {
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }
  if (list && typeof list.addListener === 'function') {
    list.addListener(onChange);
    return () => list.removeListener(onChange);
  }
  return () => {};
}

function read(): ShellWidth {
  if (matchesNow(COMPACT_QUERY)) return 'compact';
  if (matchesNow(NARROW_QUERY)) return 'narrow';
  if (matchesNow(MEDIUM_QUERY)) return 'medium';
  return 'wide';
}

/** The window width class of the shell; re-renders when it crosses 1200, 960 or 600 px. */
export function useShellWidth(): ShellWidth {
  const [width, setWidth] = useState(read);
  useEffect(() => {
    const update = () => setWidth(read());
    const stops = [MEDIUM_QUERY, NARROW_QUERY, COMPACT_QUERY].map((query) => watch(query, update));
    update();
    return () => stops.forEach((stop) => stop());
  }, []);
  return width;
}
