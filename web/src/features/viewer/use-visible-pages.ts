/**
 * Which pages of the viewer are on screen (an IntersectionObserver on the page frames inside the
 * scroll container) and which one counts as "the current page": the one showing the most of
 * itself, the earlier one on a tie. Only these pages and their neighbours get drawn.
 */
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

const THRESHOLDS = Array.from({ length: 21 }, (_, i) => i / 20);

export interface VisiblePages {
  /** Pages with any part on screen, ascending. */
  visible: number[];
  current: number;
}

/** Visible pages plus one on each side (drawn ahead so scrolling never shows an empty page). */
export function pagesToDraw(visible: number[], pageCount: number): Set<number> {
  const draw = new Set<number>();
  for (const page of visible) {
    for (const n of [page - 1, page, page + 1]) if (n >= 1 && n <= pageCount) draw.add(n);
  }
  if (draw.size === 0 && pageCount > 0) draw.add(1);
  return draw;
}

/** The page showing the most visible pixels; the earlier page wins a tie. */
export function currentPageOf(shown: ReadonlyMap<number, number>, fallback: number): number {
  let best = fallback;
  let bestArea = 0;
  for (const [page, area] of [...shown].sort((a, b) => a[0] - b[0])) {
    if (area > bestArea + 0.5) {
      best = page;
      bestArea = area;
    }
  }
  return best;
}

export function useVisiblePages(container: RefObject<HTMLElement | null>, active: boolean) {
  const elements = useRef(new Map<number, HTMLElement>());
  const shown = useRef(new Map<number, number>());
  const observer = useRef<IntersectionObserver | null>(null);
  const [state, setState] = useState<VisiblePages>({ visible: [1], current: 1 });

  useEffect(() => {
    const root = container.current;
    const onScreen = shown.current;
    if (!active || !root || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const page = Number((entry.target as HTMLElement).dataset.page);
          if (entry.isIntersecting) onScreen.set(page, entry.intersectionRect.height);
          else onScreen.delete(page);
        }
        const visible = [...onScreen.keys()].sort((a, b) => a - b);
        setState((previous) => ({
          visible,
          current: currentPageOf(onScreen, previous.current),
        }));
      },
      { root, threshold: THRESHOLDS },
    );
    observer.current = io;
    for (const element of elements.current.values()) io.observe(element);
    return () => {
      io.disconnect();
      observer.current = null;
      onScreen.clear();
    };
  }, [container, active]);

  const setElement = useCallback((page: number, element: HTMLElement | null) => {
    const previous = elements.current.get(page);
    if (previous && previous !== element) observer.current?.unobserve(previous);
    if (element) {
      elements.current.set(page, element);
      observer.current?.observe(element);
    } else {
      elements.current.delete(page);
      shown.current.delete(page);
    }
  }, []);

  /** A jump (toolbar, keys) names the page at once; the observer confirms after the scroll. */
  const setCurrent = useCallback((page: number) => {
    setState((previous) => (previous.current === page ? previous : { ...previous, current: page }));
  }, []);

  const elementOf = useCallback((page: number) => elements.current.get(page) ?? null, []);

  return { ...state, setElement, setCurrent, elementOf };
}
