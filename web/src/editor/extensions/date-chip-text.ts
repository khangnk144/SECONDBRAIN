import { i18n } from '../../i18n';
import {
  daysBetween,
  parseIsoDate,
  todayDate,
  urgencyOf,
  type CalendarDate,
  type Urgency,
} from '../local-dates';

export interface DateChipLook {
  /** `urgent` | `soon` | `ok` by days left, `done` in ticked tasks, `invalid` for `2026-02-30`. */
  state: Urgency | 'done' | 'invalid';
  /** Tooltip: relative text ("Còn 2 ngày", "Quá hạn 1 ngày"). */
  title: string;
  /**
   * Short text shown right after the token ("còn 2 ngày", "quá hạn 1 ngày"), so urgency never
   * relies on colour or hover (design.md §8); null for done tokens.
   */
  label: string | null;
}

/** Look of a `📅 YYYY-MM-DD` token on `today` (local calendar dates, SPEC §4.7). */
export function dueDateLook(
  iso: string,
  done: boolean,
  today: CalendarDate = todayDate(),
): DateChipLook {
  const date = parseIsoDate(iso);
  if (!date) return invalidLook(iso);
  const daysLeft = daysBetween(today, date);
  const title = relativeDueText(daysLeft);
  if (done) return { state: 'done', title, label: null };
  return { state: urgencyOf(daysLeft), title, label: relativeDueLabel(daysLeft) };
}

function invalidLook(iso: string): DateChipLook {
  return {
    state: 'invalid',
    title: i18n.t('editor.date.invalid', { date: iso }),
    label: i18n.t('editor.date.inline.invalid'),
  };
}

/** Look of a `✅ YYYY-MM-DD` completion token. */
export function doneDateLook(iso: string): DateChipLook {
  const date = parseIsoDate(iso);
  if (!date) return invalidLook(iso);
  const title = i18n.t('editor.date.done', { date: formatDisplayDate(date) });
  return { state: 'done', title, label: null };
}

/** The short in-line form of the relative text (lower case, it follows the date). */
export function relativeDueLabel(daysLeft: number): string {
  if (daysLeft === 0) return i18n.t('editor.date.inline.today');
  if (daysLeft === 1) return i18n.t('editor.date.inline.tomorrow');
  if (daysLeft > 0) return i18n.t('editor.date.inline.daysLeft', { count: daysLeft });
  return i18n.t('editor.date.inline.overdue', { count: -daysLeft });
}

export function relativeDueText(daysLeft: number): string {
  if (daysLeft === 0) return i18n.t('editor.date.dueToday');
  if (daysLeft === 1) return i18n.t('editor.date.dueTomorrow');
  if (daysLeft > 0) return i18n.t('editor.date.daysLeft', { count: daysLeft });
  return i18n.t('editor.date.overdue', { count: -daysLeft });
}

/** `dd/mm/yyyy` in Vietnamese, `MMM D, YYYY` in English (F7 date display). */
export function formatDisplayDate(date: CalendarDate): string {
  if (i18n.language === 'en') {
    const utc = new Date(Date.UTC(date.year, date.month - 1, date.day));
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(utc);
  }
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(date.day)}/${pad(date.month)}/${date.year}`;
}
