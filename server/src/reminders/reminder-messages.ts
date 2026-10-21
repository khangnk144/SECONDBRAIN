/**
 * Toast texts in the UI language (SPEC F17, F19). The server owns these strings: a toast is shown
 * while no app window may be open, so the web translations cannot be used. Titles are NFC (some
 * notes come from NFD file systems) and cut at 120 characters.
 */
import { parseCalendarDate } from '../lib/local-date.js';
import type { ReminderThreshold } from './reminder-types.js';

export type ReminderLanguage = 'vi' | 'en';

export interface ToastContent {
  title: string;
  body: string;
  /** Opened when the toast is clicked. */
  link: string;
}

export interface ReminderToastInput {
  title: string;
  path: string;
  due: string;
  threshold: ReminderThreshold;
  /** The due-day reminder caught up after its day ended. */
  overdue: boolean;
}

export const MAX_TOAST_TITLE = 120;

const EN_MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const TEXT = {
  vi: {
    prefix: { 3: 'Còn 3 ngày', 1: 'Còn 1 ngày', 0: 'Hôm nay đến hạn', overdue: 'Đã quá hạn' },
    body: (date: string) => `Hạn chót ${date}. Bấm để mở ghi chú.`,
    summary: (n: number) => `Bạn có ${n} deadline sắp tới`,
    summaryBody: 'Bấm để xem trang Hôm nay.',
  },
  en: {
    prefix: { 3: '3 days left', 1: '1 day left', 0: 'Due today', overdue: 'Overdue' },
    body: (date: string) => `Due ${date}. Click to open the note.`,
    summary: (n: number) => `You have ${n} upcoming deadlines`,
    summaryBody: 'Click to open Today.',
  },
} as const;

/** `vi` → `24/10/2026`, `en` → `24 October 2026`. */
export function formatDueDate(due: string, language: ReminderLanguage): string {
  const parts = parseCalendarDate(due);
  if (!parts) return due;
  if (language === 'en') return `${parts.day} ${EN_MONTHS[parts.month - 1]} ${parts.year}`;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(parts.day)}/${pad(parts.month)}/${parts.year}`;
}

/** NFC, whitespace runs (line breaks too) collapsed, at most 120 code points ending in "…". */
export function toastTitleText(title: string): string {
  const clean = title.normalize('NFC').replace(/\s+/g, ' ').trim();
  const chars = Array.from(clean);
  if (chars.length <= MAX_TOAST_TITLE) return clean;
  return `${chars
    .slice(0, MAX_TOAST_TITLE - 1)
    .join('')
    .trimEnd()}…`;
}

/** The app's note route on the canonical origin. */
export function noteDeepLink(port: number, path: string): string {
  return `http://localhost:${port}/#/note?path=${encodeURIComponent(path.normalize('NFC'))}`;
}

export function todayDeepLink(port: number): string {
  return `http://localhost:${port}/#/`;
}

export function languageOf(value: unknown): ReminderLanguage {
  return value === 'en' ? 'en' : 'vi';
}

export function reminderToast(
  input: ReminderToastInput,
  language: ReminderLanguage,
  port: number,
): ToastContent {
  const text = TEXT[language];
  const prefix = input.overdue ? text.prefix.overdue : text.prefix[input.threshold];
  return {
    title: `${prefix}: ${toastTitleText(input.title)}`,
    body: text.body(formatDueDate(input.due, language)),
    link: noteDeepLink(port, input.path),
  };
}

/** One toast for a burst of reminders, opening Today. */
export function summaryToast(
  count: number,
  language: ReminderLanguage,
  port: number,
): ToastContent {
  const text = TEXT[language];
  return { title: text.summary(count), body: text.summaryBody, link: todayDeepLink(port) };
}
