import { useEffect, useRef, type RefObject } from 'react';
import { showRightPanel } from '../../lib/panes-store';
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

/**
 * The grid side of a day opened by the user: once the URL shows that day, the right panel is
 * shown – the collapsed pane expands, and on phones the bottom sheet opens with the day (F28.1),
 * which the pane itself cannot do while it is not rendered. It waits for the URL so the sheet is
 * not closed again by the navigation that chose the day. A request made before this screen was
 * mounted (an earlier visit) is not replayed.
 */
export function useShowDayPanel(day: string | null) {
  const reveal = useCalendarStore((s) => s.reveal);
  const handled = useRef(useCalendarStore.getState().reveal?.seq ?? 0);

  useEffect(() => {
    if (!reveal || reveal.day !== day || reveal.seq === handled.current) return;
    handled.current = reveal.seq;
    showRightPanel();
  }, [reveal, day]);
}
