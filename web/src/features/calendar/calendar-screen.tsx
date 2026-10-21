import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getCalendar } from '../../lib/api/deadlines-api';
import type { DeadlineItem } from '../../lib/api/deadlines-types';
import { isoMonth } from '../../lib/local-day';
import { usePanesStore } from '../../lib/panes-store';
import { useLiveQuery } from '../../lib/use-live-query';
import { CalendarHeader } from './calendar-header';
import { CalendarMonthGrid } from './calendar-month-grid';
import {
  defaultActiveDay,
  inRange,
  itemsByDate,
  monthGridRange,
  sameDayInMonth,
  shiftMonth,
} from './calendar-month-model';
import { rescheduleCalendarItem } from './calendar-reschedule';
import { useCalendarStore, useIncludeArchive } from './calendar-store';
import { useCalendarRoute } from './use-calendar-route';
import '../deadline-items/deadline-items.css';
import './calendar-screen.css';
import './calendar-compact.css';

export function calendarQueryKey(month: string, includeArchive: boolean): string {
  return `calendar:${month}:${includeArchive ? 'all' : 'open'}`;
}

/**
 * "Lịch" (SPEC F11): the month of deadline items from `GET /calendar`, kept current by vault
 * events and the day change. The month and the opened day live in the URL; opening a day shows it
 * in the right pane (expanding the pane when it was collapsed). Items move by drag here, or by
 * "Dời ngày…" in the pane.
 */
export function CalendarScreen() {
  const { t } = useTranslation();
  const titleId = useId();
  const { month, day, today, update } = useCalendarRoute();
  const includeArchive = useIncludeArchive();
  const setIncludeArchive = useCalendarStore((s) => s.setIncludeArchive);
  const query = useLiveQuery(calendarQueryKey(month, includeArchive), () =>
    getCalendar(month, { includeArchive }),
  );
  const { data, refresh, mutate } = query;
  const [focused, setFocused] = useState<string | null>(null);
  // The tab stop stays where the keyboard left it while that day is drawn; else a sensible day.
  const active =
    focused !== null && inRange(focused, monthGridRange(month))
      ? focused
      : defaultActiveDay(month, day, today);
  const items = useMemo(() => itemsByDate(data), [data]);

  const failed = query.status === 'error';
  useEffect(() => {
    useCalendarStore.getState().publish({ view: data ?? null, failed, refresh, mutate });
  }, [data, failed, refresh, mutate]);
  useEffect(() => () => useCalendarStore.getState().publish(null), []);

  const openDay = useCallback(
    (date: string) => {
      setFocused(date);
      update({ day: date });
      useCalendarStore.getState().requestReveal(date);
      const panes = usePanesStore.getState();
      if (panes.rightCollapsed) panes.toggleRight();
    },
    [update],
  );

  // Moving past the month's edge shows the next/previous month (focus follows once drawn).
  const move = useCallback(
    (date: string) => {
      setFocused(date);
      if (isoMonth(date) !== month) update({ month: isoMonth(date) });
    },
    [month, update],
  );

  const goToMonth = (next: string) => {
    setFocused(sameDayInMonth(active, next));
    update({ month: next });
  };

  const goToToday = () => {
    setFocused(today);
    update({ month: isoMonth(today), day: today });
  };

  const dropItem = useCallback(
    (item: DeadlineItem, date: string) => {
      void rescheduleCalendarItem(item, date, { mutate, refresh });
    },
    [mutate, refresh],
  );

  return (
    <section className="calendar-screen" aria-labelledby={titleId}>
      <CalendarHeader
        month={month}
        titleId={titleId}
        includeArchive={includeArchive}
        onPrevious={() => goToMonth(shiftMonth(month, -1))}
        onToday={goToToday}
        onNext={() => goToMonth(shiftMonth(month, 1))}
        onIncludeArchive={setIncludeArchive}
      />
      {failed ? (
        <div className="calendar-screen__error" role="alert">
          <p>{t('calendar.loadError')}</p>
          <button type="button" className="button button--secondary" onClick={() => void refresh()}>
            {t('calendar.retry')}
          </button>
        </div>
      ) : null}
      <CalendarMonthGrid
        month={month}
        labelledBy={titleId}
        items={items}
        today={today}
        selectedDay={day}
        activeDay={active}
        busy={query.status === 'loading'}
        onMove={move}
        onOpenDay={openDay}
        onDropItem={dropItem}
      />
    </section>
  );
}
