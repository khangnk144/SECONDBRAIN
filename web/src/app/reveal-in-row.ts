/**
 * Below 900 px the main navigation is one row that scrolls sideways: the active item (and the
 * reminders badge on it) must be in view. Only the row scrolls – never the page, which
 * `scrollIntoView` would also move.
 */
export const REVEAL_MARGIN_PX = 8;

export function revealInRow(row: HTMLElement, item: HTMLElement): void {
  if (row.scrollWidth <= row.clientWidth) return;
  const rowBox = row.getBoundingClientRect();
  const box = item.getBoundingClientRect();
  if (box.left < rowBox.left) {
    row.scrollLeft -= rowBox.left - box.left + REVEAL_MARGIN_PX;
  } else if (box.right > rowBox.right) {
    row.scrollLeft += box.right - rowBox.right + REVEAL_MARGIN_PX;
  }
}
