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

/**
 * Bento cells never get narrower than the owner-approved mock's 66 px (scaled with the base font
 * size: 4.125rem), so the day number ("1/11", "Nov 1") and two lines of labels always fit; the
 * same minimum is `--today-strip-min-cell` in today-strip-bento.css. The gap between cells is
 * `--today-strip-gap` there.
 */
export const BENTO_MIN_CELL_PX = 66;
export const BENTO_MIN_CELL_REM = 4.125;
export const BENTO_CELL_GAP_PX = 8;

/** Calm (SPEC F10): 14 days when the strip is wide enough, else 7. */
export function visibleDaysForWidth(width: number, rootFontPx: number): number {
  return width >= WIDE_STRIP_MIN_REM * rootFontPx ? WIDE_VISIBLE_DAYS : NARROW_VISIBLE_DAYS;
}

/**
 * Bento (B3/D1 decision): as many whole days as fit in the scroller at the minimum cell width,
 * between 1 and 14; the cells then share the width equally and the rest scroll sideways.
 */
export function bentoVisibleDays(scrollerWidth: number, rootFontPx: number): number {
  const cell = Math.max(BENTO_MIN_CELL_PX, BENTO_MIN_CELL_REM * rootFontPx);
  const fit = Math.floor((scrollerWidth + BENTO_CELL_GAP_PX) / (cell + BENTO_CELL_GAP_PX));
  return Math.max(1, Math.min(WIDE_VISIBLE_DAYS, fit));
}

export interface StripVisibleDaysOptions {
  variant?: 'calm' | 'bento';
  /** Bento: the scroller (the strip without the overdue cell) is what is measured. */
  scroller?: RefObject<HTMLElement | null>;
}

/**
 * How many days the strip shows, from the width it really gets (the sidebar, the rail and the
 * 720 px content cap decide it, not the window). Followed while the strip resizes and when the
 * base font size changes. Without layout (no width measured yet) the window rule of the SPEC
 * applies in calm, and 14 in Bento (the cells' CSS minimum still keeps them readable).
 */
export function useStripVisibleDays(
  ref: RefObject<HTMLElement | null>,
  { variant = 'calm', scroller }: StripVisibleDaysOptions = {},
): number {
  const fontSize = useUiPrefsStore((state) => state.prefs.fontSize);
  const narrowWindow = useMediaQuery(NARROW_STRIP_QUERY);
  const [width, setWidth] = useState<number | null>(null);
  const bento = variant === 'bento';

  useLayoutEffect(() => {
    const element = (bento ? scroller?.current : null) ?? ref.current;
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
  }, [ref, scroller, bento]);

  if (bento) return width === null ? WIDE_VISIBLE_DAYS : bentoVisibleDays(width, fontSize);
  if (width === null) return narrowWindow ? NARROW_VISIBLE_DAYS : WIDE_VISIBLE_DAYS;
  return visibleDaysForWidth(width, fontSize);
}
