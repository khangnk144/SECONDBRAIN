import { useCallback, useLayoutEffect, useState, type RefObject } from 'react';

/** A primary button of the routed screen or of its right panel (not the top bar's own). */
const SCREEN_PRIMARY = '.app-main__inner .button--primary, .right-panel .button--primary';

/**
 * "At most one primary button per screen" (design.md §5, §12.7; F35.3): whether the screen on
 * show has a primary button of its own (Hỏi AI's "Gửi", the sample-data card on Today, a selected
 * node's "Mở ghi chú" on the brain map, a conflict view, a property form in the panel), so the
 * top bar's "Ghi chú mới" steps down to secondary there. Checked before paint after every route
 * change (`routeKey`) and again whenever the page changes (a primary that comes and goes).
 */
export function useScreenHasPrimary(
  rootRef: RefObject<HTMLElement | null>,
  routeKey: string,
): boolean {
  const [found, setFound] = useState(false);
  const check = useCallback(() => {
    const root = rootRef.current;
    setFound(root !== null && root.querySelector(SCREEN_PRIMARY) !== null);
  }, [rootRef]);

  useLayoutEffect(check, [check, routeKey]);
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || typeof MutationObserver !== 'function') return;
    // Batched by the browser: one check per burst of DOM changes (typing in the editor included).
    const observer = new MutationObserver(check);
    observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class'],
    });
    return () => observer.disconnect();
  }, [rootRef, check]);
  return found;
}
