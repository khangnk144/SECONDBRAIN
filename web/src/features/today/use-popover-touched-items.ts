import { useState } from 'react';
import type { DeadlineItem } from '../../lib/api/deadlines-types';
import type { Anchored } from './today-strip-floating';

/**
 * Which done items the open strip popover lists: Today keeps every item ticked during the visit,
 * but a popover lists done ones only when they were ticked in it, so an accidental tick can be
 * unticked there. Each opening is a new `open` object, so reopening starts clean.
 */
export function usePopoverTouchedItems(open: Anchored | null) {
  const [touched, setTouched] = useState<{ open: Anchored; ids: ReadonlySet<string> } | null>(null);
  const ids = touched !== null && touched.open === open ? touched.ids : null;
  return {
    listed: (items: DeadlineItem[]) =>
      items.filter((item) => !item.done || ids?.has(item.id) === true),
    touch: (id: string) => {
      if (open === null) return;
      setTouched((current) => ({
        open,
        ids: new Set([...(current?.open === open ? current.ids : []), id]),
      }));
    },
  };
}
