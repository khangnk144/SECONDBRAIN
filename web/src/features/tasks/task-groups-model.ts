/** The "Việc cần làm" groups (SPEC F9): fixed order, empty groups left out. */
import type { TaskEntry, TaskGroups } from '../../lib/api/deadlines-types';
import { keepRow, withKeptRows, type KeptRows } from '../deadline-items/kept-rows';

export const TASK_GROUP_ORDER = ['overdue', 'today', 'next7', 'later', 'noDate'] as const;

export type TaskGroupId = (typeof TASK_GROUP_ORDER)[number];

export interface TaskGroup {
  id: TaskGroupId;
  tasks: TaskEntry[];
}

export function visibleGroups(groups: TaskGroups): TaskGroup[] {
  return TASK_GROUP_ORDER.map((id) => ({ id, tasks: groups[id] })).filter(
    (group) => group.tasks.length > 0,
  );
}

/**
 * A tick the server confirmed: the row stays in place, dimmed, until the fresh list (which only
 * holds open tasks) replaces it.
 */
export function markTaskDone(groups: TaskGroups, id: string, done: boolean): TaskGroups {
  const next = { ...groups };
  for (const group of TASK_GROUP_ORDER) {
    if (groups[group].some((task) => task.id === id)) {
      next[group] = groups[group].map((task) => (task.id === id ? { ...task, done } : task));
    }
  }
  return next;
}

/** Rows ticked during this visit of the Tasks view, by group, for the day they were ticked on. */
export interface KeptTaskRows {
  date: string | null;
  groups: Partial<Record<TaskGroupId, KeptRows<TaskEntry>>>;
}

export const NO_KEPT_TASKS: KeptTaskRows = { date: null, groups: {} };

/** `kept` once the server confirmed that task `id`, as `shown` lists it, is now `done`. */
export function keepTask(
  kept: KeptTaskRows,
  shown: TaskGroups,
  id: string,
  done: boolean,
  today: string,
): KeptTaskRows {
  const groups = kept.date === today ? { ...kept.groups } : {};
  for (const group of TASK_GROUP_ORDER) {
    if (shown[group].some((task) => task.id === id)) {
      groups[group] = keepRow(groups[group] ?? new Map(), shown[group], id, done);
    }
  }
  return { date: today, groups };
}

/**
 * The fresh groups plus the rows ticked during this visit that they left out (checked, dimmed,
 * where they were), so a mis-tick can be unticked right there. A new day starts from the server's
 * groups alone (the buckets moved).
 */
export function withKeptTasks(groups: TaskGroups, kept: KeptTaskRows, today: string): TaskGroups {
  if (kept.date !== today) return groups;
  let next = groups;
  for (const group of TASK_GROUP_ORDER) {
    const rows = kept.groups[group];
    if (!rows) continue;
    const tasks = withKeptRows(groups[group], rows);
    if (tasks !== groups[group]) next = { ...next, [group]: tasks };
  }
  return next;
}
