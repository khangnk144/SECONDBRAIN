import { useEffect, useRef, type KeyboardEvent, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { monthWeeks, moveByKey } from '../../editor/popups/calendar-model';
import { formatIsoDate, sameDate, type CalendarDate } from '../../editor/local-dates';
import { formatLongDate } from '../../lib/format-long-date';

interface DatePickerGridProps {
  active: CalendarDate;
  today: CalendarDate;
  labelledBy: string;
  describedBy: string;
  /** Receives the active day's button (the dialog focuses it on open). */
  activeRef: RefObject<HTMLButtonElement>;
  onMove: (date: CalendarDate) => void;
  onPick: (date: CalendarDate) => void;
}

function utc(date: CalendarDate): Date {
  return new Date(Date.UTC(date.year, date.month - 1, date.day));
}

/**
 * A day or month of the picker in the app's own wording and sentence case ("Thứ ba, 20/10/2026",
 * "Tháng 10, 2026"), like the daily note row and the calendar; Intl would say "Thứ Ba".
 */
export function pickerDateText(date: CalendarDate, language: string, pattern: string): string {
  return formatLongDate(new Date(date.year, date.month - 1, date.day), language, pattern);
}

/**
 * Month grid of the date picker (WAI-ARIA grid, Monday first) with a roving tab stop: arrows
 * move by day/week, PageUp/PageDown by month, Home/End to the week's start/end, Enter or Space
 * picks. Focus follows the active day, also into the next month.
 */
export function DatePickerGrid({
  active,
  today,
  labelledBy,
  describedBy,
  activeRef,
  onMove,
  onPick,
}: DatePickerGridProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === 'en' ? 'en' : 'vi';
  const focusAfterMove = useRef(false);
  const weeks = monthWeeks(active);
  const weekdayFormat = new Intl.DateTimeFormat(locale, {
    weekday: locale === 'vi' ? 'narrow' : 'short',
    timeZone: 'UTC',
  });
  const dayPattern = t('dialogs.pickDate.dayFormat');

  useEffect(() => {
    if (!focusAfterMove.current) return;
    focusAfterMove.current = false;
    activeRef.current?.focus();
  }, [active, activeRef]);

  function onKeyDown(event: KeyboardEvent<HTMLTableElement>) {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const next = moveByKey(active, event.key);
    if (!next) return;
    event.preventDefault();
    focusAfterMove.current = true;
    onMove(next);
  }

  return (
    <table
      role="grid"
      className="pick-date__grid"
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      onKeyDown={onKeyDown}
    >
      <thead>
        <tr>
          {(weeks[0] ?? []).map((day) => (
            <th key={formatIsoDate(day)} scope="col" className="pick-date__weekday">
              {weekdayFormat.format(utc(day))}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {weeks.map((week) => (
          <tr key={formatIsoDate(week[0]!)}>
            {week.map((day) => {
              const isActive = sameDate(day, active);
              const classes = ['pick-date__day'];
              if (day.month !== active.month) classes.push('is-outside');
              if (sameDate(day, today)) classes.push('is-today');
              return (
                <td key={formatIsoDate(day)} role="gridcell" aria-selected={isActive}>
                  <button
                    ref={isActive ? activeRef : undefined}
                    type="button"
                    className={classes.join(' ')}
                    tabIndex={isActive ? 0 : -1}
                    aria-label={pickerDateText(day, locale, dayPattern)}
                    aria-current={sameDate(day, today) ? 'date' : undefined}
                    onClick={() => onPick(day)}
                  >
                    {day.day}
                  </button>
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
