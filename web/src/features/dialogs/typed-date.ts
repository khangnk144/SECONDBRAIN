/** The typed field of the date picker: `dd/mm/yyyy` (also `d/m/yyyy`, `-` or `.`, and ISO). */
import { formatIsoDate, parseIsoDate, type CalendarDate } from '../../editor/local-dates';

const DAY_MONTH_YEAR = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/;

/** `YYYY-MM-DD` for a typed date, or null when it is not a real calendar date. */
export function parseTypedDate(text: string): string | null {
  const value = text.trim();
  const iso = parseIsoDate(value);
  if (iso) return formatIsoDate(iso);
  const match = DAY_MONTH_YEAR.exec(value);
  if (!match) return null;
  const date = { day: Number(match[1]), month: Number(match[2]), year: Number(match[3]) };
  const checked = parseIsoDate(formatIsoDate(date));
  return checked ? formatIsoDate(checked) : null;
}

/** `dd/mm/yyyy`. */
export function formatTypedDate(date: CalendarDate): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(date.day)}/${pad(date.month)}/${String(date.year).padStart(4, '0')}`;
}
