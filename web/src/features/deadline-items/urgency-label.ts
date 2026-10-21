/**
 * Text that always accompanies an urgency colour (design.md §8: never colour alone):
 * "hôm nay", "ngày mai", "còn 5 ngày", "quá hạn 2 ngày".
 */
import type { TFunction } from 'i18next';
import { urgencyOf } from '../../editor/local-dates';
import type { DeadlineItem, TaskEntry, Urgency } from '../../lib/api/deadlines-types';

/** Relative due text for `daysLeft` calendar days from today (negative = overdue). */
export function dueLabel(daysLeft: number, t: TFunction): string {
  if (daysLeft === 0) return t('deadline-items.due.today');
  if (daysLeft === 1) return t('deadline-items.due.tomorrow');
  if (daysLeft > 1) return t('deadline-items.due.daysLeft', { count: daysLeft });
  return t('deadline-items.due.overdue', { count: -daysLeft });
}

/** True for a note-deadline item (`deadline:` in front matter); tasks are everything else. */
export function isNoteItem(item: DeadlineItem | TaskEntry): boolean {
  return 'kind' in item && item.kind === 'note';
}

/**
 * Urgency by days left alone (SPEC §4.7), ignoring the done flag, so a row unticked a moment ago
 * shows its colour before the list reloads; null for undated tasks.
 */
export function openUrgency(item: DeadlineItem | TaskEntry): Exclude<Urgency, 'done'> | null {
  return item.daysLeft === null ? null : urgencyOf(item.daysLeft);
}
