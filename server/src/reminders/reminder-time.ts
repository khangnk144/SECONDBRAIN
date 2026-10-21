/**
 * The configured reminder time (`settings.reminders.time`, `HH:mm`, default 08:00) and the local
 * instant at which a threshold of a due date fires. Dates are local calendar dates (SPEC §4.7),
 * so "3 days before" is three calendar days, whatever the time zone.
 */
import { addDays, localMidnight } from '../lib/local-date.js';
import type { ReminderThreshold } from './reminder-types.js';

export const DEFAULT_REMINDER_TIME = '08:00';

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export interface ClockTime {
  hour: number;
  minute: number;
}

export const DEFAULT_CLOCK_TIME: Readonly<ClockTime> = { hour: 8, minute: 0 };

/** `HH:mm` → hour/minute; null for anything else. */
export function parseReminderTime(value: unknown): ClockTime | null {
  if (typeof value !== 'string') return null;
  const m = TIME_RE.exec(value);
  return m ? { hour: Number(m[1]), minute: Number(m[2]) } : null;
}

/**
 * The reminder time of the settings object, read on every evaluation so a change in Settings
 * applies at once. Missing or malformed → the default (never throws: a bad value must not stop
 * the scheduler).
 */
export function reminderTimeOf(settings: { [key: string]: unknown }): string {
  const reminders = settings.reminders as { time?: unknown } | null | undefined;
  const time = reminders && typeof reminders === 'object' ? reminders.time : undefined;
  return parseReminderTime(time) ? (time as string) : DEFAULT_REMINDER_TIME;
}

export const REMINDER_THRESHOLDS: readonly ReminderThreshold[] = [3, 1, 0];

/** Local instant of `due - threshold days` at the reminder time. */
export function fireInstant(due: string, threshold: ReminderThreshold, time: ClockTime): Date {
  const day = localMidnight(addDays(due, -threshold));
  // setHours on the local date: correct across DST changes (a fixed offset in ms would not be).
  day.setHours(time.hour, time.minute, 0, 0);
  return day;
}
