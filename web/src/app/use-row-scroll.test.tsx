import { render } from '@testing-library/react';
import { useRef } from 'react';
import { describe, expect, it } from 'vitest';
import { useRowScroll } from './use-row-scroll';

function Row({ scrollWidth, clientWidth }: { scrollWidth: number; clientWidth: number }) {
  const ref = useRef<HTMLUListElement | null>(null);
  useRowScroll(ref);
  return (
    <ul
      ref={(el) => {
        ref.current = el;
        if (!el) return;
        Object.defineProperty(el, 'scrollWidth', { configurable: true, value: scrollWidth });
        Object.defineProperty(el, 'clientWidth', { configurable: true, value: clientWidth });
      }}
      data-testid="row"
    />
  );
}

const wheel = (el: Element, init: WheelEventInit) => {
  const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...init });
  el.dispatchEvent(event);
  return event;
};

describe('useRowScroll (review B8)', () => {
  it('a vertical wheel scrolls an overflowing row sideways and flags the hidden edges', () => {
    const { getByTestId } = render(<Row scrollWidth={680} clientWidth={400} />);
    const row = getByTestId('row');
    expect(row.dataset).toMatchObject({ moreStart: 'false', moreEnd: 'true' });
    const first = wheel(row, { deltaY: 120 });
    expect(first.defaultPrevented).toBe(true);
    expect(row.scrollLeft).toBe(120);
    row.dispatchEvent(new Event('scroll'));
    expect(row.dataset).toMatchObject({ moreStart: 'true', moreEnd: 'true' });
    wheel(row, { deltaY: 3, deltaMode: 1 }); // three lines
    expect(row.scrollLeft).toBe(168);
    wheel(row, { deltaY: 500 });
    expect(row.scrollLeft).toBe(280);
    row.dispatchEvent(new Event('scroll'));
    expect(row.dataset).toMatchObject({ moreStart: 'true', moreEnd: 'false' });
    // At the end the page scrolls as usual; Shift and Ctrl keep their meaning.
    expect(wheel(row, { deltaY: 100 }).defaultPrevented).toBe(false);
    expect(wheel(row, { deltaY: -100, shiftKey: true }).defaultPrevented).toBe(false);
    expect(wheel(row, { deltaY: -100, ctrlKey: true }).defaultPrevented).toBe(false);
  });

  it('a row that fits (the vertical rail) leaves the wheel alone', () => {
    const { getByTestId } = render(<Row scrollWidth={84} clientWidth={84} />);
    const row = getByTestId('row');
    expect(row.dataset).toMatchObject({ moreStart: 'false', moreEnd: 'false' });
    expect(wheel(row, { deltaY: 120 }).defaultPrevented).toBe(false);
    expect(row.scrollLeft).toBe(0);
  });
});
