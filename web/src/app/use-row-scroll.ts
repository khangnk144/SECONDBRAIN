import { useEffect, type RefObject } from 'react';

/** Lines of a `deltaMode: 1` wheel (Firefox) in pixels. */
const LINE_PX = 16;

/**
 * A row that scrolls sideways (the Bento rail below 960 px, review B8) shows that it does and
 * follows a vertical mouse wheel:
 * - `data-more-start` / `data-more-end` say whether places hide past either edge (the CSS fades
 *   that edge), updated on scroll and resize;
 * - a vertical wheel scrolls the row sideways (with only a vertical wheel, the places past its
 *   edge were out of reach). At either end, or when the row does not overflow (the vertical
 *   rail), the wheel scrolls the page as usual; Shift and Ctrl keep their own meaning.
 */
export function useRowScroll(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const row = ref.current;
    if (!row) return;
    const update = () => {
      const max = row.scrollWidth - row.clientWidth;
      row.dataset.moreStart = String(max > 0 && row.scrollLeft > 1);
      row.dataset.moreEnd = String(max > 0 && row.scrollLeft < max - 1);
    };
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.shiftKey) return;
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      const max = row.scrollWidth - row.clientWidth;
      if (max <= 0) return;
      const delta = event.deltaMode === 1 ? event.deltaY * LINE_PX : event.deltaY;
      const next = Math.max(0, Math.min(max, row.scrollLeft + delta));
      if (next === row.scrollLeft) return;
      row.scrollLeft = next;
      event.preventDefault();
    };
    update();
    row.addEventListener('scroll', update, { passive: true });
    // Not passive: the page must not scroll as well while the row takes the wheel.
    row.addEventListener('wheel', onWheel, { passive: false });
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(update) : null;
    observer?.observe(row);
    return () => {
      row.removeEventListener('scroll', update);
      row.removeEventListener('wheel', onWheel);
      observer?.disconnect();
    };
  }, [ref]);
}
