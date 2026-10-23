/**
 * "Deadline gần nhất" (design.md §12.3): the first open item of the 14-day strip (today …
 * today+13), most urgent first within its day. Overdue items do not count here – they have their
 * own cell on the strip – and neither do items ticked a moment ago.
 */
import { urgencyOf } from '../../../editor/local-dates';
import type { DeadlineItem, TodayView } from '../../../lib/api/deadlines-types';
import { compareStripItems, type OpenUrgency } from '../today-strip-model';

export const NEAREST_DAYS = 14;

export interface NearestDeadline {
  item: DeadlineItem;
  urgency: OpenUrgency;
  /** A project's note deadline: its open tasks ("2 việc còn mở"); null otherwise or unknown. */
  openTasks: number | null;
}

export function nearestDeadline(view: TodayView): NearestDeadline | null {
  for (const day of view.strip.days.slice(0, NEAREST_DAYS)) {
    const item = day.items.filter((entry) => !entry.done).sort(compareStripItems)[0];
    if (!item) continue;
    const project =
      item.kind === 'note' ? view.projects.find((entry) => entry.path === item.path) : undefined;
    const progress = project?.progress ?? null;
    return {
      item,
      urgency: urgencyOf(item.daysLeft),
      openTasks: progress ? progress.total - progress.done : null,
    };
  }
  return null;
}
