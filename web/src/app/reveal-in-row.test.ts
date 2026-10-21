import { describe, expect, it } from 'vitest';
import { REVEAL_MARGIN_PX, revealInRow } from './reveal-in-row';

/** jsdom has no layout: give the row and the item the boxes a 360 px window would have. */
function setup(item: { left: number; width: number }, scrollLeft = 0, scrollWidth = 900) {
  const row = document.createElement('ul');
  const link = document.createElement('a');
  row.append(link);
  Object.defineProperty(row, 'clientWidth', { value: 328 });
  Object.defineProperty(row, 'scrollWidth', { value: scrollWidth });
  row.scrollLeft = scrollLeft;
  row.getBoundingClientRect = () => ({ left: 16, right: 344, width: 328 }) as DOMRect;
  link.getBoundingClientRect = () =>
    ({ left: item.left, right: item.left + item.width, width: item.width }) as DOMRect;
  return { row, link };
}

describe('the narrow navigation row shows its active item', () => {
  it('scrolls right just enough for an item cut off at the right edge (Nhắc nhở + badge)', () => {
    const { row, link } = setup({ left: 320, width: 120 });
    revealInRow(row, link);
    expect(row.scrollLeft).toBe(440 - 344 + REVEAL_MARGIN_PX);
  });

  it('scrolls back left for an item before the visible part', () => {
    const { row, link } = setup({ left: -60, width: 90 }, 200);
    revealInRow(row, link);
    expect(row.scrollLeft).toBe(200 - (16 + 60 + REVEAL_MARGIN_PX));
  });

  it('leaves a visible item and a row that does not scroll alone', () => {
    const visible = setup({ left: 40, width: 100 }, 50);
    revealInRow(visible.row, visible.link);
    expect(visible.row.scrollLeft).toBe(50);
    const wide = setup({ left: 400, width: 100 }, 0, 328);
    revealInRow(wide.row, wide.link);
    expect(wide.row.scrollLeft).toBe(0);
  });
});
