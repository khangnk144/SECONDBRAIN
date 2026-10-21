/**
 * The calendar's URL state (`/calendar?month=YYYY-MM&day=YYYY-MM-DD`), read by the screen and the
 * right pane alike. Changes replace the history entry: browsing months adds no Back steps.
 */
import { useCallback } from 'react';
import { useSearchParams } from 'react-router';
import { todayIso, useLocalDay } from '../../lib/local-day';
import {
  calendarSearchParams,
  readCalendarParams,
  type CalendarRouteState,
} from './calendar-month-model';

export interface CalendarRoute extends CalendarRouteState {
  /** Today's local date (re-renders at midnight). */
  today: string;
  /** Changes the month and/or the opened day in one navigation. */
  update: (next: Partial<CalendarRouteState>) => void;
}

export function useCalendarRoute(): CalendarRoute {
  const today = useLocalDay();
  const [params, setParams] = useSearchParams();
  const state = readCalendarParams(params, today);
  const update = useCallback(
    (next: Partial<CalendarRouteState>) => {
      setParams(
        (current) => calendarSearchParams({ ...readCalendarParams(current, todayIso()), ...next }),
        { replace: true },
      );
    },
    [setParams],
  );
  return { ...state, today, update };
}
