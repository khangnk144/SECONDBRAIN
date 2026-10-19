import { foldText } from '../../lib/fold-text';
import {
  addDays,
  addMonths,
  formatIsoDate,
  parseIsoDate,
  weekdayIndex,
  type CalendarDate,
} from '../local-dates';

export interface QuickChoice {
  id: 'today' | 'tomorrow' | 'nextWeek';
  date: CalendarDate;
}

export function quickChoices(today: CalendarDate): QuickChoice[] {
  return [
    { id: 'today', date: today },
    { id: 'tomorrow', date: addDays(today, 1) },
    { id: 'nextWeek', date: addDays(today, 7) },
  ];
}

const PARTIAL_ISO = /^\d{1,4}(-(\d{1,2}(-\d{0,2})?)?)?$/;

/**
 * The day the popup starts on for what was typed after `@`/`📅`: a full date, today while a date
 * is being typed, the quick choice whose label contains the words (`@mai` → tomorrow), else null
 * (the popup hides, so `@someone` stays plain text).
 */
export function dateForQuery(
  query: string,
  today: CalendarDate,
  label: (choice: QuickChoice) => string,
): CalendarDate | null {
  if (query === '') return today;
  const exact = parseIsoDate(query);
  if (exact) return exact;
  if (PARTIAL_ISO.test(query)) return today;
  const folded = foldText(query);
  const choice = quickChoices(today).find((c) =>
    foldText(label(c))
      .split(/\s+/)
      .some((word) => word.startsWith(folded)),
  );
  return choice ? choice.date : null;
}

/** Weeks (Monday first) covering the month of `date`, with the neighbouring months' days. */
export function monthWeeks(date: CalendarDate): CalendarDate[][] {
  const first = { year: date.year, month: date.month, day: 1 };
  let day = addDays(first, -weekdayIndex(first));
  const weeks: CalendarDate[][] = [];
  do {
    const week: CalendarDate[] = [];
    for (let i = 0; i < 7; i += 1) {
      week.push(day);
      day = addDays(day, 1);
    }
    weeks.push(week);
  } while (day.month === date.month);
  return weeks;
}

/** Where a calendar key moves the active day; null for keys the calendar does not use. */
export function moveByKey(date: CalendarDate, key: string): CalendarDate | null {
  switch (key) {
    case 'ArrowLeft':
      return addDays(date, -1);
    case 'ArrowRight':
      return addDays(date, 1);
    case 'ArrowUp':
      return addDays(date, -7);
    case 'ArrowDown':
      return addDays(date, 7);
    case 'PageUp':
      return addMonths(date, -1);
    case 'PageDown':
      return addMonths(date, 1);
    case 'Home':
      return addDays(date, -weekdayIndex(date));
    case 'End':
      return addDays(date, 6 - weekdayIndex(date));
    default:
      return null;
  }
}

/** The text a picked date becomes (SPEC §4.6 due token). */
export function dueToken(date: CalendarDate): string {
  return `\u{1F4C5} ${formatIsoDate(date)}`;
}
