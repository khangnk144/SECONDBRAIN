/**
 * Calendar dates in the machine's local time zone (SPEC §4.7): a date is a day number, never a
 * UTC instant, so day differences ignore daylight-saving shifts and the time of day.
 */
export interface CalendarDate {
  year: number;
  /** 1–12 */
  month: number;
  day: number;
}

const DAY_MS = 86_400_000;

export function todayDate(now: Date = new Date()): CalendarDate {
  return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
}

/** `YYYY-MM-DD`. */
export function formatIsoDate(date: CalendarDate): string {
  const pad = (n: number, width = 2) => String(n).padStart(width, '0');
  return `${pad(date.year, 4)}-${pad(date.month)}-${pad(date.day)}`;
}

/** Local calendar date of `now` as `YYYY-MM-DD`. */
export function localDateString(now: Date = new Date()): string {
  return formatIsoDate(todayDate(now));
}

/** Parses `YYYY-MM-DD`; null when the text is not a real date (`2026-02-30`). */
export function parseIsoDate(text: string): CalendarDate | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return null;
  const date = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  if (date.month < 1 || date.month > 12) return null;
  if (date.day < 1 || date.day > daysInMonth(date.year, date.month)) return null;
  return date;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function dayNumber(date: CalendarDate): number {
  return Math.round(Date.UTC(date.year, date.month - 1, date.day) / DAY_MS);
}

function fromDayNumber(day: number): CalendarDate {
  const d = new Date(day * DAY_MS);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/** Whole calendar days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: CalendarDate, to: CalendarDate): number {
  return dayNumber(to) - dayNumber(from);
}

export function addDays(date: CalendarDate, days: number): CalendarDate {
  return fromDayNumber(dayNumber(date) + days);
}

/** Same day `months` later, clamped to the month's length (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(date: CalendarDate, months: number): CalendarDate {
  const index = date.year * 12 + (date.month - 1) + months;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return { year, month, day: Math.min(date.day, daysInMonth(year, month)) };
}

/** 0 = Monday … 6 = Sunday (weeks start on Monday, SPEC §4.7). */
export function weekdayIndex(date: CalendarDate): number {
  return (dayNumber(date) + 3) % 7;
}

export function sameDate(a: CalendarDate, b: CalendarDate): boolean {
  return a.year === b.year && a.month === b.month && a.day === b.day;
}

export type Urgency = 'urgent' | 'soon' | 'ok';

/** SPEC §4.7: due within 2 days or overdue → urgent; 3–7 days → soon; later → ok. */
export function urgencyOf(daysLeft: number): Urgency {
  if (daysLeft <= 2) return 'urgent';
  if (daysLeft <= 7) return 'soon';
  return 'ok';
}
