/**
 * The Today screen data (SPEC §4.7): week summary, the 60-day strip (14 visible, the rest
 * scrolls), today's tasks and the projects in progress. Built from one snapshot of the index rows.
 */
import {
  addDays,
  dateRange,
  diffDays,
  endOfWeekSunday,
  startOfWeekMonday,
} from '../lib/local-date.js';
import type { VaultPath } from '../vault/vault-types.js';
import {
  collectItems,
  compareByDate,
  compareByUrgency,
  compareTaskEntries,
  compareTitles,
  producesItems,
  taskEntry,
  urgencyFor,
  type DeadlineNote,
  type DeadlineSources,
} from './deadline-rules.js';
import type { DeadlineItem, ProjectSummary, TaskEntry, TodayView } from './index-types.js';

/** today … today+59: the strip shows 14 days and scrolls up to day 60. */
export const STRIP_DAYS = 60;

function isTodaysDaily(path: VaultPath, today: string): boolean {
  return path.normalize('NFC').toLowerCase() === `daily/${today}.md`;
}

/** Open tasks due today or overdue, then the undated tasks of today's Daily note (any state). */
function todayTasks(sources: DeadlineSources, today: string): TaskEntry[] {
  const dated: TaskEntry[] = [];
  const daily: TaskEntry[] = [];
  for (const task of sources.tasks) {
    const note = sources.notes.get(task.path);
    if (!note || !producesItems(note.class, false)) continue;
    const entry = taskEntry(task, note, today);
    if (entry.date !== null) {
      if (!entry.done && entry.date <= today) dated.push(entry);
    } else if (isTodaysDaily(task.path, today)) {
      daily.push(entry);
    }
  }
  dated.sort(compareTaskEntries);
  daily.sort((a, b) => a.line - b.line);
  return [...dated, ...daily];
}

function isDoingProject(note: DeadlineNote): boolean {
  return (
    producesItems(note.class, false) &&
    note.type?.trim().toLowerCase() === 'project' &&
    note.status?.trim().toLowerCase() === 'doing'
  );
}

function projects(sources: DeadlineSources, today: string): ProjectSummary[] {
  const counts = new Map<VaultPath, { done: number; total: number }>();
  for (const task of sources.tasks) {
    const c = counts.get(task.path) ?? { done: 0, total: 0 };
    c.total += 1;
    if (task.done) c.done += 1;
    counts.set(task.path, c);
  }
  const out: ProjectSummary[] = [];
  for (const note of sources.notes.values()) {
    if (!isDoingProject(note)) continue;
    const daysLeft = note.deadline ? diffDays(today, note.deadline) : null;
    out.push({
      path: note.path,
      title: note.title,
      deadline: note.deadline,
      daysLeft,
      urgency: daysLeft === null ? null : urgencyFor(daysLeft, false),
      progress: counts.get(note.path) ?? null,
    });
  }
  // Nearest deadline first; projects without a deadline after, by title.
  return out.sort(
    (a, b) =>
      (a.deadline ?? '9999').localeCompare(b.deadline ?? '9999') || compareTitles(a.title, b.title),
  );
}

export function buildTodayView(sources: DeadlineSources, today: string): TodayView {
  const open = collectItems(sources, today, false).filter((item) => !item.done);
  const week = { start: startOfWeekMonday(today), end: endOfWeekSunday(today) };
  const lastDay = addDays(today, STRIP_DAYS - 1);
  const byDate = new Map<string, DeadlineItem[]>();
  for (const item of open) {
    if (item.date < today || item.date > lastDay) continue;
    const list = byDate.get(item.date) ?? [];
    list.push(item);
    byDate.set(item.date, list);
  }
  const days = dateRange(today, lastDay).map((date) => ({
    date,
    items: (byDate.get(date) ?? []).sort(compareByUrgency),
  }));
  const overdue = open.filter((item) => item.date < today).sort(compareByDate);
  const tasks = todayTasks(sources, today);
  return {
    date: today,
    week,
    summary: {
      deadlinesThisWeek: open.filter((i) => i.date >= week.start && i.date <= week.end).length,
      openToday: tasks.filter((t) => !t.done).length,
      overdue: overdue.length,
    },
    strip: { days, overdue },
    todayTasks: tasks,
    projects: projects(sources, today),
  };
}
