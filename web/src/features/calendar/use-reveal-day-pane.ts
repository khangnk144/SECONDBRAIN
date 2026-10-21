import { useEffect, useRef, type RefObject } from 'react';
import { useCalendarStore } from './calendar-store';

/** Below this width the right pane sits under the grid (`app-layout.css`). */
export const STACKED_PANE_QUERY = '(max-width: 899px)';

/**
 * When the user opens a day and the pane is stacked under the grid (narrow windows), its heading
 * scrolls into view: otherwise choosing a day would seem to do nothing. Keyboard focus stays on
 * the grid cell; wide windows show the pane beside the grid already.
 */
export function useRevealDayPane(day: string | null, heading: RefObject<HTMLElement | null>) {
  const reveal = useCalendarStore((s) => s.reveal);
  const handled = useRef(0);

  useEffect(() => {
    if (!reveal || reveal.day !== day || reveal.seq === handled.current) return;
    handled.current = reveal.seq;
    if (typeof window.matchMedia !== 'function') return;
    if (!window.matchMedia(STACKED_PANE_QUERY).matches) return;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    heading.current?.scrollIntoView?.({ block: 'start', behavior: still ? 'auto' : 'smooth' });
  }, [reveal, day, heading]);
}
