/**
 * Calendar dates (`YYYY-MM-DD`) in the machine's local time zone. "Today" is always derived from
 * the local wall clock, never from a UTC instant, so a deadline does not flip at 07:00 in Hanoi.
 * Arithmetic on dates that are already calendar strings goes through `Date.UTC` purely as a day
 * counter: it has no DST gaps, so adding a day never lands on 23:00 of the same day.
 */

const DAY_MS = 86_400_000;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_RE = /^(\d{4})-(\d{2})$/;

const pad2 = (n: number): string => String(n).padStart(2, '0');

function formatParts(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${pad2(month)}-${pad2(day)}`;
}

/** The local calendar date of an instant. */
export function toLocalDate(instant: Date): string {
  return formatParts(instant.getFullYear(), instant.getMonth() + 1, instant.getDate());
}

/**
 * Years the app accepts in dates; the same rule as the Markdown layer's `isValidCalendarDate`,
 * so a date the parser keeps is never rejected here (and the reverse).
 */
const MIN_YEAR = 1000;
const MAX_YEAR = 9999;

/** `{year, month (1-12), day}` of a valid calendar date, else null (`2026-02-30` is invalid). */
export function parseCalendarDate(
  value: string,
): { year: number; month: number; day: number } | null {
  const m = DATE_RE.exec(value);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (year < MIN_YEAR || year > MAX_YEAR || month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;
  return { year, month, day };
}

export function isCalendarDate(value: unknown): value is string {
  return typeof value === 'string' && parseCalendarDate(value) !== null;
}

/** `{year, month}` of `YYYY-MM`, else null. */
export function parseMonth(value: string): { year: number; month: number } | null {
  const m = MONTH_RE.exec(value);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const validYear = year >= MIN_YEAR && year <= MAX_YEAR;
  return validYear && month >= 1 && month <= 12 ? { year, month } : null;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function dayNumber(date: string): number {
  const parts = parseCalendarDate(date);
  if (!parts) throw new RangeError(`Not a calendar date: ${date}`);
  return Date.UTC(parts.year, parts.month - 1, parts.day) / DAY_MS;
}

function fromDayNumber(n: number): string {
  const d = new Date(n * DAY_MS);
  return formatParts(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

export function addDays(date: string, days: number): string {
  return fromDayNumber(dayNumber(date) + days);
}

/** Whole calendar days from `from` to `to` (positive when `to` is later). */
export function diffDays(from: string, to: string): number {
  return dayNumber(to) - dayNumber(from);
}

/** 1 = Monday … 7 = Sunday (ISO weekday). */
export function isoWeekday(date: string): number {
  const weekday = new Date(dayNumber(date) * DAY_MS).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

export function startOfWeekMonday(date: string): string {
  return addDays(date, 1 - isoWeekday(date));
}

export function endOfWeekSunday(date: string): string {
  return addDays(date, 7 - isoWeekday(date));
}

/** Local midnight of a calendar date, as an instant (for timestamps derived from a date). */
export function localMidnight(date: string): Date {
  const parts = parseCalendarDate(date);
  if (!parts) throw new RangeError(`Not a calendar date: ${date}`);
  return new Date(parts.year, parts.month - 1, parts.day);
}

/** Inclusive list of calendar dates from `start` to `end`. */
export function dateRange(start: string, end: string): string[] {
  const first = dayNumber(start);
  const last = dayNumber(end);
  const out: string[] = [];
  for (let n = first; n <= last; n += 1) out.push(fromDayNumber(n));
  return out;
}

/** First and last calendar date of a month given as `YYYY-MM`. */
export function monthBounds(month: string): { first: string; last: string } {
  const parts = parseMonth(month);
  if (!parts) throw new RangeError(`Not a month: ${month}`);
  return {
    first: formatParts(parts.year, parts.month, 1),
    last: formatParts(parts.year, parts.month, daysInMonth(parts.year, parts.month)),
  };
}
