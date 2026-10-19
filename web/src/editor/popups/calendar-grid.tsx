import { useTranslation } from 'react-i18next';
import { formatIsoDate, sameDate, type CalendarDate } from '../local-dates';
import { monthWeeks } from './calendar-model';

interface CalendarGridProps {
  id: string;
  active: CalendarDate;
  today: CalendarDate;
  describedBy: string;
  onPick: (date: CalendarDate) => void;
}

export function dayCellId(gridId: string, date: CalendarDate): string {
  return `${gridId}-${formatIsoDate(date)}`;
}

function utc(date: CalendarDate): Date {
  return new Date(Date.UTC(date.year, date.month - 1, date.day));
}

function capitalize(text: string): string {
  return text.charAt(0).toLocaleUpperCase() + text.slice(1);
}

/**
 * Month grid of the date popup (WAI-ARIA grid, Monday first). Focus stays in the editor: the
 * active day is announced through `aria-activedescendant`, set by the popup.
 */
export function CalendarGrid({ id, active, today, describedBy, onPick }: CalendarGridProps) {
  const { i18n } = useTranslation();
  const locale = i18n.language === 'en' ? 'en' : 'vi';
  const weeks = monthWeeks(active);
  const weekdayFormat = new Intl.DateTimeFormat(locale, {
    weekday: locale === 'vi' ? 'narrow' : 'short',
    timeZone: 'UTC',
  });
  const monthFormat = new Intl.DateTimeFormat(locale, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  const dayFormat = new Intl.DateTimeFormat(locale, { dateStyle: 'full', timeZone: 'UTC' });
  const monthLabel = capitalize(monthFormat.format(utc(active)));

  return (
    <table
      id={id}
      role="grid"
      className="date-popup__grid"
      aria-label={monthLabel}
      aria-describedby={describedBy}
    >
      <caption className="date-popup__month">{monthLabel}</caption>
      <thead>
        <tr>
          {(weeks[0] ?? []).map((day) => (
            <th key={formatIsoDate(day)} scope="col" className="date-popup__weekday">
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
              return (
                <td
                  key={formatIsoDate(day)}
                  id={dayCellId(id, day)}
                  role="gridcell"
                  aria-selected={isActive}
                  aria-current={sameDate(day, today) ? 'date' : undefined}
                  aria-label={capitalize(dayFormat.format(utc(day)))}
                  className={`date-popup__day${day.month === active.month ? '' : ' is-outside'}`}
                  onClick={() => onPick(day)}
                >
                  {day.day}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
