/**
 * Texts of one reminder: how far its due date is ("Còn 3 ngày", "Hôm nay đến hạn", "Đã quá
 * hạn", always next to the urgency colour) and when it was delivered ("Đã nhắc lúc 08:00",
 * "Nhắc bù lúc 09:12" for one caught up after the machine slept).
 */
import type { TFunction } from 'i18next';
import {
  daysBetween,
  parseIsoDate,
  todayDate,
  urgencyOf,
  type Urgency,
} from '../../editor/local-dates';
import type { ReminderEntry } from '../../lib/api/reminders-types';

/** Calendar days from today to the due date (negative = overdue), or null for a bad date. */
export function reminderDaysLeft(due: string, now: Date = new Date()): number | null {
  const date = parseIsoDate(due);
  return date ? daysBetween(todayDate(now), date) : null;
}

export function reminderUrgency(daysLeft: number | null): Urgency {
  return urgencyOf(daysLeft ?? 0);
}

export function reminderDueText(daysLeft: number | null, t: TFunction): string {
  if (daysLeft === null || daysLeft < 0) return t('reminders.due.overdue');
  if (daysLeft === 0) return t('reminders.due.today');
  if (daysLeft === 1) return t('reminders.due.tomorrow');
  return t('reminders.due.daysLeft', { count: daysLeft });
}

const pad = (value: number) => String(value).padStart(2, '0');

export function reminderFiredText(entry: ReminderEntry, t: TFunction, now = new Date()): string {
  const fired = new Date(entry.firedAt);
  if (Number.isNaN(fired.getTime())) {
    return entry.missed ? t('reminders.fired.missedNoTime') : t('reminders.fired.onTimeNoTime');
  }
  const time = `${pad(fired.getHours())}:${pad(fired.getMinutes())}`;
  const sameDay = fired.toDateString() === now.toDateString();
  const date = `${pad(fired.getDate())}/${pad(fired.getMonth() + 1)}`;
  const key = entry.missed ? 'missed' : 'onTime';
  return sameDay
    ? t(`reminders.fired.${key}`, { time })
    : t(`reminders.fired.${key}OnDate`, { time, date });
}

/** `dd/mm/yyyy` of the due date, for the notification body. */
export function reminderDueDate(due: string): string {
  const date = parseIsoDate(due);
  return date ? `${pad(date.day)}/${pad(date.month)}/${date.year}` : due;
}
