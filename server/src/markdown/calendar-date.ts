/**
 * Calendar dates (`YYYY-MM-DD`) as used by `deadline:` front matter and task tokens
 * (SPEC §4.6, §4.7). Dates are plain calendar days, never instants, so validation is pure
 * arithmetic and never goes through `Date` time-zone handling.
 */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

// Same year range as `server/src/lib/local-date.ts`, so every view agrees on what a date is.
const MIN_YEAR = 1000;
const MAX_YEAR = 9999;

/**
 * True for a well-formed, existing calendar date with a year from 1000 to 9999
 * (`2026-02-29` false, `2028-02-29` true, `0000-01-01` false).
 */
export function isValidCalendarDate(value: string): boolean {
  const match = ISO_DATE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < MIN_YEAR || year > MAX_YEAR) return false;
  if (month < 1 || month > 12 || day < 1) return false;
  return day <= daysInMonth(year, month);
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}
