import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), ' +
  'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function focusableElements(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (element) => !element.hasAttribute('hidden') && element.getAttribute('aria-hidden') !== 'true',
  );
}

export interface FocusTrapOptions {
  onEscape: () => void;
  /** Element focused on open; defaults to the first focusable element. */
  initialFocus?: RefObject<HTMLElement | null>;
  /**
   * Open at the top of a tall dialog: the first focus does not scroll it to the focused element
   * (consent dialogs focus their last button but must be read from the title down).
   */
  startAtTop?: boolean;
}

/** Open traps, innermost last: only that one answers keys that land outside every dialog. */
const openTraps: HTMLElement[] = [];

function precedes(a: Node, b: Node): boolean {
  return (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}

/**
 * Where Tab goes from `active` when the browser would leave the dialog, or null to let it move:
 * from the last item, or from anything inside after it (a `tabIndex=-1` status line that took
 * focus), on to the first; Shift+Tab from the first, or from anything before it (the dialog box
 * itself), back to the last. From outside the dialog (focus fell to the page) it comes back in.
 */
function wrapTarget(container: HTMLElement, active: Element | null, back: boolean) {
  const items = focusableElements(container);
  const first = items[0];
  const last = items[items.length - 1];
  if (!first || !last) return container;
  if (!active || !container.contains(active)) return back ? last : first;
  // Focus on something that is not a Tab stop (a status line, the dialog box itself).
  const offList = !items.includes(active as HTMLElement);
  if (back) return active === first || (offList && precedes(active, first)) ? last : null;
  return active === last || (offList && precedes(last, active)) ? first : null;
}

/**
 * Modal focus handling: focus moves in on open, Tab/Shift+Tab cycle inside, Esc calls `onEscape`,
 * and focus returns to where it was when the trap unmounts. Keys pressed while focus is outside
 * the dialog (the focused element was removed, or focus fell to the page) still reach the
 * innermost open dialog: Tab comes back in and Esc closes it.
 */
export function useFocusTrap(
  containerRef: RefObject<HTMLElement | null>,
  options: FocusTrapOptions,
): void {
  const latest = useRef(options);
  useEffect(() => {
    latest.current = options;
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const initial = latest.current.initialFocus?.current ?? focusableElements(container)[0];
    if (latest.current.startAtTop) {
      (initial ?? container).focus({ preventScroll: true });
      container.scrollTop = 0;
    } else (initial ?? container).focus();
    openTraps.push(container);

    function handle(event: KeyboardEvent) {
      if (!container) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        latest.current.onEscape();
        return;
      }
      if (event.key !== 'Tab') return;
      const target = wrapTarget(container, document.activeElement, event.shiftKey);
      if (!target) return;
      event.preventDefault();
      target.focus();
    }

    // Inside the dialog: handled here first, before anything else on the page hears the key.
    const onKeyDown = (event: KeyboardEvent) => handle(event);
    // Outside it: only for the innermost dialog, and only when no dialog holds the focus.
    const onDocumentKeyDown = (event: KeyboardEvent) => {
      if (openTraps[openTraps.length - 1] !== container) return;
      if (openTraps.some((trap) => trap.contains(document.activeElement))) return;
      handle(event);
    };
    container.addEventListener('keydown', onKeyDown);
    document.addEventListener('keydown', onDocumentKeyDown);
    return () => {
      container.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('keydown', onDocumentKeyDown);
      const index = openTraps.lastIndexOf(container);
      if (index !== -1) openTraps.splice(index, 1);
      if (previous?.isConnected) previous.focus();
    };
  }, [containerRef]);
}
