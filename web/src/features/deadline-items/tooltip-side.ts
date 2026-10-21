/** Gap between a row and its tooltip (`--space-1`). */
const GAP_PX = 4;

/** The vertical span of the viewport where `element` can be seen, inside every clipping box. */
function visibleSpan(element: HTMLElement): { top: number; bottom: number } {
  let top = 0;
  let bottom = window.innerHeight;
  for (let node = element.parentElement; node; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (style.overflowX === 'visible' && style.overflowY === 'visible') continue;
    const rect = node.getBoundingClientRect();
    top = Math.max(top, rect.top);
    bottom = Math.min(bottom, rect.bottom);
  }
  return { top, bottom };
}

/**
 * Whether the row's tooltip should open upward: only when it would be cut off below (by a
 * scrolling popover or the window) and fits above. Scrolling still reaches what is cut below,
 * never what is cut above, so below stays the default.
 */
export function tooltipOpensAbove(row: HTMLElement, tooltip: HTMLElement): boolean {
  const span = visibleSpan(row);
  const rect = row.getBoundingClientRect();
  const height = tooltip.getBoundingClientRect().height + GAP_PX;
  return rect.bottom + height > span.bottom && rect.top - height >= span.top;
}
