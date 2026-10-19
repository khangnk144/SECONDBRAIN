import { useState, type KeyboardEvent } from 'react';

/**
 * Keyboard model of a single-select listbox driven by `aria-activedescendant`: ↑/↓ move,
 * Home/End jump, Enter chooses. The active index is clamped when the list shrinks.
 */
export function useListboxNavigation(count: number, onChoose: (index: number) => void) {
  const [active, setActive] = useState(0);
  const activeIndex = count === 0 ? -1 : Math.min(active, count - 1);

  function onKeyDown(event: KeyboardEvent) {
    if (count === 0) return;
    const moves: Record<string, number> = {
      ArrowDown: Math.min(activeIndex + 1, count - 1),
      ArrowUp: Math.max(activeIndex - 1, 0),
      Home: 0,
      End: count - 1,
    };
    if (event.key in moves) {
      event.preventDefault();
      setActive(moves[event.key] ?? 0);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      onChoose(activeIndex);
    }
  }

  return { activeIndex, setActiveIndex: setActive, onKeyDown };
}
