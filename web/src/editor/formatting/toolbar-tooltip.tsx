import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type PointerEvent,
} from 'react';
import { createPortal } from 'react-dom';
import './toolbar-tooltip.css';

export interface TooltipContent {
  label: string;
  /** Shortcut shown after the label ("Ctrl+B"); also the button's description. */
  keys?: string;
}

interface Shown extends TooltipContent {
  anchor: HTMLElement;
}

/** A first hover waits like a native tooltip; moving along the toolbar then shows at once. */
const HOVER_DELAY_MS = 400;
const WARM_MS = 600;
/** Time to move the pointer from the button onto its tooltip (it stays while hovered). */
const LEAVE_GRACE_MS = 150;
const EDGE_PX = 8;
const GAP_PX = 6;

/** Fixed position below `anchor`, centered on it and kept inside the viewport (360 px too). */
function placeBelow(tip: HTMLElement, anchor: HTMLElement): void {
  const rect = anchor.getBoundingClientRect();
  const viewport = document.documentElement.clientWidth || window.innerWidth;
  const width = tip.offsetWidth;
  const centered = rect.left + rect.width / 2 - width / 2;
  const left = Math.max(EDGE_PX, Math.min(centered, viewport - width - EDGE_PX));
  tip.style.left = `${Math.round(left)}px`;
  tip.style.top = `${Math.round(rect.bottom + GAP_PX)}px`;
}

/**
 * Tooltips of the formatting toolbar: the command and its shortcut ("Đậm Ctrl+B"), shown on
 * hover and on keyboard focus (a native `title` never shows for keyboard users), below the
 * control. Esc hides it; the pointer may move onto it; pressing the control hides it.
 * `props(content)` goes on each control; `tooltip` is rendered once.
 */
export function useToolbarTooltip() {
  const keysId = useId();
  const [shown, setShown] = useState<Shown | null>(null);
  const tip = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const hiddenAt = useRef(0);

  const cancel = () => window.clearTimeout(timer.current);
  const hide = useCallback(() => {
    window.clearTimeout(timer.current);
    setShown((current) => {
      if (current) hiddenAt.current = Date.now();
      return null;
    });
  }, []);
  const show = (anchor: HTMLElement, content: TooltipContent, delay: number) => {
    cancel();
    if (delay <= 0) setShown({ ...content, anchor });
    else timer.current = window.setTimeout(() => setShown({ ...content, anchor }), delay);
  };

  useLayoutEffect(() => {
    if (shown && tip.current) placeBelow(tip.current, shown.anchor);
  }, [shown]);
  useEffect(() => {
    if (!shown) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') hide();
    };
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', hide, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', hide, true);
    };
  }, [shown, hide]);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const props = (content: TooltipContent) => ({
    'aria-describedby': content.keys && shown?.label === content.label ? keysId : undefined,
    onPointerEnter: (event: PointerEvent<HTMLElement>) => {
      if (event.pointerType === 'touch') return;
      const warm = shown !== null || Date.now() - hiddenAt.current < WARM_MS;
      show(event.currentTarget, content, warm ? 0 : HOVER_DELAY_MS);
    },
    onPointerLeave: () => {
      cancel();
      timer.current = window.setTimeout(hide, LEAVE_GRACE_MS);
    },
    onPointerDown: hide,
    onFocus: (event: FocusEvent<HTMLElement>) => show(event.currentTarget, content, 0),
    onBlur: hide,
  });

  const tooltip = shown
    ? createPortal(
        <div
          ref={tip}
          role="tooltip"
          className="toolbar-tooltip"
          onPointerEnter={cancel}
          onPointerLeave={hide}
        >
          <span>{shown.label}</span>
          {shown.keys ? (
            <span id={keysId} className="toolbar-tooltip__keys">
              {shown.keys}
            </span>
          ) : null}
        </div>,
        document.body,
      )
    : null;

  return { props, tooltip };
}
