import { useEffect, useLayoutEffect, useRef } from 'react';
import { focusIsLost, focusMainRegion } from '../lib/focus-recovery';
import type { Style } from '../lib/ui-prefs';
import { useUiPrefsStore } from '../lib/ui-prefs-store';

/**
 * What identifies the focused control in the other frame: a radio or checkbox by its group name
 * and value (the "Phong cách" radio she just used), anything else by its id.
 */
export type FocusMark = { name: string; value: string } | { id: string };

export function focusMark(element: Element | null): FocusMark | null {
  if (!(element instanceof HTMLElement) || element === element.ownerDocument.body) return null;
  if (element instanceof HTMLInputElement && element.name) {
    return { name: element.name, value: element.value };
  }
  return element.id ? { id: element.id } : null;
}

export function findMarked(mark: FocusMark, doc: Document = document): HTMLElement | null {
  if ('id' in mark) return doc.getElementById(mark.id);
  return (
    Array.from(doc.querySelectorAll<HTMLInputElement>('input[name]')).find(
      (input) => input.name === mark.name && input.value === mark.value,
    ) ?? null
  );
}

/**
 * Calm and Bento are different frames, so switching the style (F35.1) unmounts the screen and
 * mounts it again, with the control that had focus (review B10: the "Phong cách" radio, and the
 * next arrow key went nowhere). The focused control is noted when the style changes in the store
 * (the old frame is still on the page then) and focused again in the new frame before paint;
 * when it no longer exists, focus goes to the main region rather than `<body>`. A change while
 * nothing had focus (another window switched the style) moves no focus.
 */
export function useFocusAcrossFrames(style: Style): void {
  // Undefined: nothing had focus; null: something without a name or id had it.
  const pending = useRef<FocusMark | null | undefined>(undefined);
  useEffect(
    () =>
      useUiPrefsStore.subscribe((state, previous) => {
        if (state.prefs.style === previous.prefs.style) return;
        pending.current = focusIsLost() ? undefined : focusMark(document.activeElement);
      }),
    [],
  );
  const shown = useRef(style);
  useLayoutEffect(() => {
    if (shown.current === style) return;
    shown.current = style;
    const mark = pending.current;
    pending.current = undefined;
    if (mark === undefined || !focusIsLost()) return;
    const target = mark ? findMarked(mark) : null;
    if (target) target.focus();
    else focusMainRegion();
  }, [style]);
}
