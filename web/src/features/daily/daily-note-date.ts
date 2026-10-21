import type { VaultPath } from '../../lib/api/vault-types';
import { formatLongDate } from '../../lib/format-long-date';
import { parseIsoDate } from '../../editor/local-dates';

/** `Daily/YYYY-MM-DD.md`, folder and extension in any case (as the server matches it). */
const DAILY_NOTE_PATH = /^daily\/(\d{4}-\d{2}-\d{2})\.md$/i;

/** The calendar date a daily note is for, or null when the path is not a daily note. */
export function dailyDateFromPath(path: VaultPath): string | null {
  const date = DAILY_NOTE_PATH.exec(path)?.[1];
  return date && parseIsoDate(date) ? date : null;
}

/** A `YYYY-MM-DD` date with a dayjs pattern from the i18n files (first letter capitalized). */
export function formatDay(iso: string, language: string, pattern: string): string {
  const date = parseIsoDate(iso);
  if (!date) return iso;
  return formatLongDate(new Date(date.year, date.month - 1, date.day), language, pattern);
}
