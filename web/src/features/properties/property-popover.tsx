import { useEffect, useRef, type ReactNode, type RefObject } from 'react';

interface PropertyPopoverProps {
  /** Translated name of what is being edited. */
  label: string;
  /** Clicks inside this element (the chip and the popover) do not close the popover. */
  boundaryRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  children: ReactNode;
}

/**
 * Small non-modal editor under a chip: focus moves into it (to `[data-autofocus]` if any), `Esc` or a click outside closes it
 * (the chip puts focus back on its button).
 */
export function PropertyPopover({ label, boundaryRef, onClose, children }: PropertyPopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    // An editor may name its starting point (the current value of a choice list).
    const start =
      ref.current?.querySelector<HTMLElement>('[data-autofocus]') ??
      ref.current?.querySelector<HTMLElement>('input, select, textarea, button');
    start?.focus();
    const onPointerDown = (event: MouseEvent) => {
      if (!boundaryRef.current?.contains(event.target as Node)) close.current();
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [boundaryRef]);

  return (
    <div
      ref={ref}
      className="property-popover"
      role="dialog"
      aria-label={label}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.stopPropagation();
        close.current();
      }}
    >
      {children}
    </div>
  );
}
