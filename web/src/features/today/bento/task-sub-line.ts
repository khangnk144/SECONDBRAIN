/**
 * The small line under a Bento "Hôm nay" task (design.md §12.3): "Quá hạn 1 ngày", "Hôm nay,
 * gấp", "Daily hôm nay" (undated tasks of today's Daily, the only undated ones Today lists), and
 * for a row ticked during this visit the note it lives in (its urgency no longer matters).
 * Urgent lines use the urgency text colour; the words say it too.
 */
import type { TFunction } from 'i18next';
import type { TaskEntry } from '../../../lib/api/deadlines-types';

export interface TaskSubLine {
  text: string;
  urgent: boolean;
}

export function taskSubLine(task: TaskEntry, t: TFunction): TaskSubLine {
  const daily = task.date === null;
  if (task.done)
    return { text: daily ? t('today.bento.tasks.daily') : task.noteTitle, urgent: false };
  if (task.daysLeft !== null && task.daysLeft < 0) {
    return { text: t('today.bento.tasks.overdue', { count: -task.daysLeft }), urgent: true };
  }
  if (task.daysLeft === 0) return { text: t('today.bento.tasks.dueToday'), urgent: true };
  return { text: daily ? t('today.bento.tasks.daily') : task.noteTitle, urgent: false };
}
