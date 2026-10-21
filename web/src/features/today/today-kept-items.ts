/**
 * Items ticked on Today stay on screen, checked and dimmed, while Today is open (design.md screen
 * 1: "Gửi email thầy (đã xong)"), so an accidental tick can be unticked right there. The server's
 * fresh view leaves done tasks out; these helpers put the ones ticked during this visit back in
 * place. Counts are never touched: the summary keeps counting a ticked task as done.
 */
import type { DeadlineItem, TaskEntry, TodayView } from '../../lib/api/deadlines-types';
import { keepRow, withKeptRows, type KeptRows } from '../deadline-items/kept-rows';

export interface KeptItems {
  /** The day they were kept on: a new day starts from the server's lists alone. */
  date: string | null;
  tasks: KeptRows<TaskEntry>;
  /** Strip items (the popover lists them while it stays open). */
  strip: ReadonlyMap<string, DeadlineItem>;
}

export const NO_KEPT_ITEMS: KeptItems = { date: null, tasks: new Map(), strip: new Map() };

function stripItems(view: TodayView): DeadlineItem[] {
  return [...view.strip.overdue, ...view.strip.days.flatMap((day) => day.items)];
}

/** `kept` once the server confirmed that item `id`, as `view` shows it, is now `done`. */
export function keepItem(kept: KeptItems, view: TodayView, id: string, done: boolean): KeptItems {
  const sameDay = kept.date === view.date;
  const tasks = keepRow(sameDay ? kept.tasks : new Map(), view.todayTasks, id, done);
  const strip = new Map(sameDay ? kept.strip : []);
  const item = stripItems(view).find((entry) => entry.id === id);
  if (item) strip.set(id, { ...item, done });
  return { date: view.date, tasks, strip };
}

/**
 * `view` with the items ticked during this visit that it no longer lists. Only ticked ones come
 * back: an item unticked here is open again, so the server lists it itself.
 */
export function withKeptItems(view: TodayView, kept: KeptItems): TodayView {
  if (kept.date !== view.date) return view;
  const todayTasks = withKeptRows(view.todayTasks, kept.tasks);
  const present = new Set(stripItems(view).map((item) => item.id));
  const missing = [...kept.strip.values()].filter((item) => item.done && !present.has(item.id));
  if (missing.length === 0 && todayTasks === view.todayTasks) return view;
  const days = view.strip.days.map((day) => {
    const back = missing.filter((item) => item.date === day.date);
    return back.length > 0 ? { ...day, items: [...day.items, ...back] } : day;
  });
  const overdue = [...view.strip.overdue, ...missing.filter((item) => item.date < view.date)];
  return { ...view, todayTasks, strip: { days, overdue } };
}
