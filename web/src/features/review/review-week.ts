/**
 * Calendar rules of the weekly review (SPEC F26.1, F26.2) on local `YYYY-MM-DD` dates: the card
 * belongs to Sundays; "Để sau" hides it for the ISO week of that Sunday, per vault, in this
 * browser (the per-vault storage helper swallows storage errors: then it simply comes back).
 */
import { addDays, parseIsoDate, weekdayIndex } from '../../editor/local-dates';
import { vaultStorage } from '../../lib/vault-storage';

export const REVIEW_DISMISSED_KEY = 'review.dismissedWeek';

/** Monday = 0 … Sunday = 6 (the editor's calendar helpers). */
export function isSunday(iso: string): boolean {
  const date = parseIsoDate(iso);
  return date !== null && weekdayIndex(date) === 6;
}

/** ISO 8601 week of a date, e.g. `2026-W10` (the week's Thursday decides the year). */
export function isoWeekOf(iso: string): string {
  const date = parseIsoDate(iso);
  if (!date) throw new RangeError(`not a calendar date: ${iso}`);
  const thursday = addDays(date, 3 - weekdayIndex(date));
  const january4 = { year: thursday.year, month: 1, day: 4 };
  const firstThursday = addDays(january4, 3 - weekdayIndex(january4));
  const utc = (d: typeof date) => Date.UTC(d.year, d.month - 1, d.day);
  const week = 1 + Math.round((utc(thursday) - utc(firstThursday)) / (7 * 86_400_000));
  return `${thursday.year}-W${String(week).padStart(2, '0')}`;
}

export function isReviewDismissed(today: string): boolean {
  return vaultStorage.get<unknown>(REVIEW_DISMISSED_KEY, null) === isoWeekOf(today);
}

export function dismissReview(today: string): void {
  vaultStorage.set(REVIEW_DISMISSED_KEY, isoWeekOf(today));
}
