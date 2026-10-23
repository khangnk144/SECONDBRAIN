import { useLayoutEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { nextStripKey } from './today-strip-model';
import { useFocusRescue } from './use-focus-rescue';

/** The strip's cell button for `key`, when it is drawn. */
export function stripCellButton(
  row: HTMLElement | null,
  key: string | null,
): HTMLButtonElement | null {
  if (key === null) return null;
  return row?.querySelector<HTMLButtonElement>(`[data-key="${key}"]`) ?? null;
}

/**
 * The strip's one Tab stop (roving tabindex, F10.3): the last cell she used, else today's.
 * ←/→, Home and End move it (focus without scrolling the page, then the cell into view); a cell
 * can ask for focus after the next render (the popover closing), and today's cell takes over when
 * the focused one vanished (the overdue cell after its last tick).
 */
export function useStripRoving(
  rowRef: RefObject<HTMLElement | null>,
  keys: string[],
  todayKey: string | null,
) {
  const [activeKey, setActiveKey] = useState<string | null>(null);
  /** Cell to focus after the next render (set when the popover closes). */
  const focusRequest = useRef<string | null>(null);
  const tabStop = activeKey !== null && keys.includes(activeKey) ? activeKey : todayKey;
  const cellButton = (key: string | null) => stripCellButton(rowRef.current, key);

  // A focused cell can also vanish later: the overdue cell goes once its last tick is confirmed,
  // which may be after the popover closed. Today's cell takes focus instead of <body>.
  useFocusRescue(rowRef, () => cellButton(todayKey), '.today-strip__cell');

  // Focus goes back to a cell after the render that closed the popover (the overdue cell may be
  // gone by then: today's cell takes it).
  useLayoutEffect(() => {
    const key = focusRequest.current;
    if (key === null) return;
    focusRequest.current = null;
    (cellButton(key) ?? cellButton(todayKey))?.focus();
  });

  return {
    tabStop,
    setActiveKey,
    requestFocus(key: string) {
      focusRequest.current = key;
      setActiveKey(key);
    },
    /** Arrow keys, Home and End on cell `current`. */
    onKeyDown(event: KeyboardEvent<HTMLElement>, current: string) {
      const next = nextStripKey(keys, current, event.key);
      if (next === null) return;
      event.preventDefault();
      setActiveKey(next);
      const button = cellButton(next);
      button?.focus({ preventScroll: true });
      button?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    },
  };
}
