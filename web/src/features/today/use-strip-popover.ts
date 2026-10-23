import { useState, type RefObject } from 'react';
import { anchorLeft, useOutsidePointerDown, type Anchored } from './today-strip-floating';
import { stripCellButton } from './use-strip-roving';

const POPOVER_MAX_WIDTH = 480;
const TOOLTIP_MAX_WIDTH = 320;

interface StripPopoverRefs {
  /** The strip's frame: the popover and the tooltip are placed inside it, under their cell. */
  frame: RefObject<HTMLElement | null>;
  row: RefObject<HTMLElement | null>;
  popoverHost: RefObject<HTMLElement | null>;
}

/**
 * The strip's two floating boxes: the day popover (one cell at a time; the cell toggles its own,
 * a press anywhere else closes it and focus stays put) and the tooltip with the full titles.
 */
export function useStripPopover(refs: StripPopoverRefs) {
  const [open, setOpen] = useState<Anchored | null>(null);
  const [hint, setHint] = useState<Anchored | null>(null);

  useOutsidePointerDown(
    open !== null,
    (target) =>
      refs.popoverHost.current?.contains(target) === true ||
      stripCellButton(refs.row.current, open?.key ?? null)?.contains(target) === true,
    () => setOpen(null),
  );

  return {
    open,
    hint,
    /** A cell's own popover opens, or closes when it was open; the tooltip goes. */
    toggle(key: string, button: HTMLButtonElement) {
      setHint(null);
      setOpen((current) =>
        current?.key === key
          ? null
          : { key, left: anchorLeft(refs.frame.current, button, POPOVER_MAX_WIDTH) },
      );
    },
    close: () => setOpen(null),
    showHint(key: string | null, button: HTMLButtonElement | null) {
      setHint(
        key && button
          ? { key, left: anchorLeft(refs.frame.current, button, TOOLTIP_MAX_WIDTH) }
          : null,
      );
    },
    hideHint: () => setHint(null),
  };
}
