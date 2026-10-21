/**
 * Keeps keyboard focus in a list whose rows can disappear under it: a ticked task leaves Today,
 * the popover or the Tasks view when the fresh data arrives, a project marked done leaves its
 * list. Focus that fell to `<body>` would send the next key nowhere (WCAG 2.4.3), so the row now
 * at the same place gets it (the same kind of control when it has one), else `fallback()`.
 */
import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import { focusIsLost } from '../../lib/focus-recovery';

interface Remembered {
  element: HTMLElement;
  /** Index of its row among the list's rows. */
  index: number;
  /** First class of the focused control, to find the same control in the next row. */
  className: string;
}

const FOCUSABLE = 'input, button, a[href], textarea, [tabindex]:not([tabindex="-1"])';

function targetIn(row: Element, className: string): HTMLElement | null {
  const same = className ? row.getElementsByClassName(className)[0] : undefined;
  if (same instanceof HTMLElement) return same;
  return row.querySelector<HTMLElement>(FOCUSABLE);
}

export function useFocusRescue(
  listRef: RefObject<HTMLElement | null>,
  fallback: () => HTMLElement | null,
  rowSelector = 'li',
): void {
  const remembered = useRef<Remembered | null>(null);
  const fallbackRef = useRef(fallback);
  useEffect(() => {
    fallbackRef.current = fallback;
  });

  useEffect(() => {
    const onFocusIn = (event: FocusEvent) => {
      const list = listRef.current;
      const target = event.target;
      const row = target instanceof HTMLElement ? target.closest(rowSelector) : null;
      if (!list || !(target instanceof HTMLElement) || !row || !list.contains(row)) {
        remembered.current = null;
        return;
      }
      const rows = Array.from(list.querySelectorAll(rowSelector));
      remembered.current = {
        element: target,
        index: rows.indexOf(row),
        className: target.classList[0] ?? '',
      };
    };
    const onFocusOut = (event: FocusEvent) => {
      const current = remembered.current;
      if (!current || event.target !== current.element || event.relatedTarget !== null) return;
      // A click on empty space also drops focus to <body>, but leaves the row on the page: that
      // was the user's choice, so forget it (a removed row is not connected any more).
      window.setTimeout(() => {
        if (remembered.current === current && current.element.isConnected) {
          remembered.current = null;
        }
      }, 0);
    };
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    return () => {
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
    };
  }, [listRef, rowSelector]);

  // After every commit of the owner: the row that held focus may just have been removed.
  useLayoutEffect(() => {
    const current = remembered.current;
    if (!current || current.element.isConnected || !focusIsLost()) return;
    remembered.current = null;
    const rows = listRef.current ? Array.from(listRef.current.querySelectorAll(rowSelector)) : [];
    const row = rows[Math.min(current.index, rows.length - 1)];
    const target = row ? targetIn(row, current.className) : null;
    (target ?? fallbackRef.current())?.focus();
  });
}
