/**
 * Moving an item to another day from the calendar, by drag or by "Dời ngày…": the cell list moves
 * at once, the server rewrites only the date token or `deadline:` value at the item's revision
 * (journaled, 10 s undo toast), and the month reloads – with the new revision on success, back to
 * the truth when the write was refused (SPEC F11.2).
 */
import type { CalendarView, DeadlineItem } from '../../lib/api/deadlines-types';
import { todayIso } from '../../lib/local-day';
import { rescheduleItem, type DeadlineActionOutcome } from '../deadline-items/deadline-actions';
import { moveItemInView } from './calendar-month-model';

export interface CalendarRescheduleContext {
  /** Optimistic change of the month on screen. */
  mutate?: (update: (view: CalendarView) => CalendarView) => void;
  /** Reloads what the calendar shows. */
  refresh: () => Promise<unknown>;
}

export async function rescheduleCalendarItem(
  item: DeadlineItem,
  date: string,
  context: CalendarRescheduleContext,
): Promise<DeadlineActionOutcome> {
  // Same day: nothing to write, nothing to undo.
  if (date === item.date) return 'done';
  context.mutate?.((view) => moveItemInView(view, item.id, date, todayIso()));
  const outcome = await rescheduleItem(item, date, { refresh: context.refresh });
  // A conflict already reloaded the list (and said which note changed).
  if (outcome !== 'conflict') void context.refresh();
  return outcome;
}
