/**
 * Local, optimistic changes of the Today data after an action the server already confirmed, so
 * the summary line and the strip answer at once (F10.4) instead of waiting for the refetch that
 * the WebSocket event triggers. The fresh view from the server replaces all of this anyway.
 */
import type { DeadlineItem, TodayView } from '../../lib/api/deadlines-types';
import type { VaultPath } from '../../lib/api/vault-types';

/**
 * Item `id` (a task or a note deadline) was ticked (`done`) or unticked. Counts move only when its
 * state really flips, so applying the same change twice changes nothing. Done items stay in the
 * lists flagged `done`: rows keep their place until the fresh view arrives, the strip hides them.
 */
export function applyItemDone(view: TodayView, id: string, done: boolean): TodayView {
  const delta = done ? -1 : 1;
  let { overdue, deadlinesThisWeek, openToday } = view.summary;
  // As the server counts: an overdue item only as overdue; the week and today start at today.
  const fromToday = (date: string | null) => date === null || date >= view.date;

  const flip = (item: DeadlineItem, isOverdue: boolean): DeadlineItem => {
    if (item.id !== id || item.done === done) return item;
    if (isOverdue) overdue += delta;
    else if (fromToday(item.date) && item.date <= view.week.end) deadlinesThisWeek += delta;
    return { ...item, done };
  };

  const days = view.strip.days.map((day) => {
    const items = day.items.map((item) => flip(item, false));
    return items.some((item, index) => item !== day.items[index]) ? { ...day, items } : day;
  });
  const overdueItems = view.strip.overdue.map((item) => flip(item, true));
  const todayTasks = view.todayTasks.map((task) => {
    if (task.id !== id || task.done === done) return task;
    if (fromToday(task.date)) openToday += delta;
    return { ...task, done };
  });

  return {
    ...view,
    summary: {
      overdue: Math.max(0, overdue),
      deadlinesThisWeek: Math.max(0, deadlinesThisWeek),
      openToday: Math.max(0, openToday),
    },
    strip: { days, overdue: overdueItems },
    todayTasks,
  };
}

/** A project was marked done: it leaves "Đồ án đang làm" (it no longer has `status: doing`). */
export function withoutProject(view: TodayView, path: VaultPath): TodayView {
  return { ...view, projects: view.projects.filter((project) => project.path !== path) };
}
