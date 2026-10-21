import { useLayoutEffect, useState, type RefObject } from 'react';
import { useUiPrefsStore } from '../../lib/ui-prefs-store';
import { NARROW_VISIBLE_DAYS, WIDE_VISIBLE_DAYS } from './today-strip-model';
import { useMediaQuery } from './use-media-query';

/** SPEC F10: below 720 px of window width, 7 days are visible and the rest scroll. */
export const NARROW_STRIP_QUERY = '(max-width: 719.98px)';

/**
 * Strip width (in rem) from which 14 days are shown: next to the overdue cell (4rem + 4 px) each
 * day still gets about 2.85rem (46 px at the default 16 px font), the cell width of the design
 * mock. The content column is at most 720 px, so at 18 px the strip always shows 7 wider days,
 * and so do the windows where the sidebar leaves the content narrower than that.
 */
export const WIDE_STRIP_MIN_REM = 44;

export function visibleDaysForWidth(width: number, rootFontPx: number): number {
  return width >= WIDE_STRIP_MIN_REM * rootFontPx ? WIDE_VISIBLE_DAYS : NARROW_VISIBLE_DAYS;
}

/**
 * How many days the strip shows, from the width it really gets (the sidebar and the 720 px content
 * cap decide it, not the window). Followed while the strip resizes and when the base font size
 * changes. Without layout (no width measured yet) the window rule of the SPEC applies.
 */
export function useStripVisibleDays(ref: RefObject<HTMLElement | null>): number {
  const fontSize = useUiPrefsStore((state) => state.prefs.fontSize);
  const narrowWindow = useMediaQuery(NARROW_STRIP_QUERY);
  const [width, setWidth] = useState<number | null>(null);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => {
      const measured = element.getBoundingClientRect().width;
      setWidth(measured > 0 ? measured : null);
    };
    measure();
    if (typeof ResizeObserver !== 'function') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);

  if (width === null) return narrowWindow ? NARROW_VISIBLE_DAYS : WIDE_VISIBLE_DAYS;
  return visibleDaysForWidth(width, fontSize);
}
