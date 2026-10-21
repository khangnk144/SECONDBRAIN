/** Placement and dismissal of the strip's floating boxes (tooltip, popover). */
import { useEffect, useRef } from 'react';

export interface Anchored {
  key: string;
  /** px from the strip's left edge, kept so the floating box stays inside the strip. */
  left: number;
}

/** Left offset of `cell` inside `frame`, clamped so a box up to `maxWidth` wide fits. */
export function anchorLeft(frame: HTMLElement | null, cell: HTMLElement, maxWidth: number): number {
  if (!frame) return 0;
  const offset = cell.getBoundingClientRect().left - frame.getBoundingClientRect().left;
  const room = Math.max(0, frame.clientWidth - Math.min(maxWidth, frame.clientWidth));
  return Math.round(Math.min(Math.max(0, offset), room));
}

/** While `active`, a pointer press outside (`isInside` false) calls `onOutside`. */
export function useOutsidePointerDown(
  active: boolean,
  isInside: (target: Node) => boolean,
  onOutside: () => void,
): void {
  const latest = useRef({ isInside, onOutside });
  useEffect(() => {
    latest.current = { isInside, onOutside };
  });
  useEffect(() => {
    if (!active) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && latest.current.isInside(target)) return;
      latest.current.onOutside();
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [active]);
}
