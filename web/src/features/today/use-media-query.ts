import { useEffect, useState } from 'react';

function currentMatch(query: string): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(query).matches;
}

/** Whether a CSS media query matches now; re-renders when it starts or stops matching. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => currentMatch(query));
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const list = window.matchMedia(query);
    const update = () => setMatches(list.matches);
    update();
    // Some test stubs (and very old engines) answer without listener methods.
    if (typeof list.addEventListener !== 'function') return;
    list.addEventListener('change', update);
    return () => list.removeEventListener('change', update);
  }, [query]);
  return matches;
}

/** design.md §6: no motion beyond instant state changes when the user asked for less. */
export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

export function prefersReducedMotion(): boolean {
  return currentMatch(REDUCED_MOTION_QUERY);
}
