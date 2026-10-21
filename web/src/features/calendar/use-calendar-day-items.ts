/**
 * The opened day's items for the right pane. When the day is drawn in the month on screen, the
 * pane reads the screen's view (one request, and an optimistic move shows in both at once);
 * otherwise (the month was browsed away from the opened day) it loads that day's month itself.
 */
import { useCallback } from 'react';
import { getCalendar } from '../../lib/api/deadlines-api';
import type { CalendarView, DeadlineItem } from '../../lib/api/deadlines-types';
import { isoMonth } from '../../lib/local-day';
import { useLiveQuery } from '../../lib/use-live-query';
import { inRange, monthGridRange } from './calendar-month-model';
import { useCalendarStore, useIncludeArchive } from './calendar-store';

export interface CalendarDayItems {
  /** Null while not known yet. */
  items: DeadlineItem[] | null;
  /** The month could not be loaded (and nothing is known about the day). */
  failed: boolean;
  /** Reloads every view that lists the day. */
  refresh: () => Promise<void>;
  mutate?: (update: (view: CalendarView) => CalendarView) => void;
}

const SHARED_KEY = 'calendar-day:shared';

function itemsOf(view: CalendarView | null | undefined, day: string): DeadlineItem[] | null {
  return view?.days.find((entry) => entry.date === day)?.items ?? null;
}

export function useCalendarDayItems(day: string | null, screenMonth: string): CalendarDayItems {
  const includeArchive = useIncludeArchive();
  const shared = useCalendarStore((s) => s.shared);
  const onScreen = day === null || inRange(day, monthGridRange(screenMonth));
  const ownMonth = day === null ? null : isoMonth(day);
  const own = useLiveQuery<CalendarView | null>(
    onScreen || ownMonth === null ? SHARED_KEY : `calendar-day:${ownMonth}:${includeArchive}`,
    () =>
      onScreen || ownMonth === null
        ? Promise.resolve(null)
        : getCalendar(ownMonth, { includeArchive }),
  );
  const ownRefresh = own.refresh;
  const sharedRefresh = shared?.refresh;
  const refresh = useCallback(async () => {
    await Promise.all([sharedRefresh?.(), ownRefresh()]);
  }, [sharedRefresh, ownRefresh]);

  if (day === null) return { items: null, failed: false, refresh };
  if (onScreen) {
    const items = itemsOf(shared?.view, day);
    const failed = items === null && shared?.failed === true;
    return { items, failed, refresh, mutate: shared?.mutate };
  }
  const items = itemsOf(own.data, day);
  return { items, failed: items === null && own.status === 'error', refresh };
}
