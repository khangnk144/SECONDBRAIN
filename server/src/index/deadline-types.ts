/**
 * Contract of the deadline-items service (SPEC §4.7): the shapes Today, Calendar and
 * the Tasks view receive. Re-exported from `index-types.ts`.
 */
import type { ContentClass } from '../markdown/markdown-types.js';
import type { VaultPath } from '../vault/vault-types.js';
import type { DeadlineItem, Urgency } from './index-types.js';

/** A task as listed by Today and the Tasks view (dated or not). */
export interface TaskEntry {
  /** `task:<path>#<line>` (same id as the task's deadline item when it has a due date). */
  id: string;
  /** Task text without tokens. */
  title: string;
  path: VaultPath;
  noteTitle: string;
  line: number;
  lineText: string;
  done: boolean;
  /** Due date, null for undated tasks. */
  date: string | null;
  urgency: Urgency | null;
  daysLeft: number | null;
  class: ContentClass;
}

/** A `type: project`, `status: doing` note on the Today screen. */
export interface ProjectSummary {
  path: VaultPath;
  title: string;
  deadline: string | null;
  daysLeft: number | null;
  urgency: Urgency | null;
  /** done/total of the tasks in the project note; null when it has no tasks ("chưa có việc"). */
  progress: { done: number; total: number } | null;
}

export interface TodayView {
  /** Today's local calendar date. */
  date: string;
  /** Monday–Sunday week containing today. */
  week: { start: string; end: string };
  summary: { deadlinesThisWeek: number; openToday: number; overdue: number };
  /** Open items only: today … today+59 (one entry per day, possibly empty) and the overdue ones. */
  strip: { days: { date: string; items: DeadlineItem[] }[]; overdue: DeadlineItem[] };
  /** Open tasks due today or overdue, then the undated tasks of today's Daily note (open and done). */
  todayTasks: TaskEntry[];
  projects: ProjectSummary[];
}

export interface CalendarView {
  /** `YYYY-MM`. */
  month: string;
  /** Monday on or before the 1st and Sunday on or after the last day of the month. */
  start: string;
  end: string;
  /** Every date from start to end; done items included. */
  days: { date: string; inMonth: boolean; items: DeadlineItem[] }[];
}

/** Open tasks of user notes (plus archived ones on request), grouped by due date. */
export interface TaskGroups {
  overdue: TaskEntry[];
  today: TaskEntry[];
  /** Due in 1–7 days. */
  next7: TaskEntry[];
  later: TaskEntry[];
  noDate: TaskEntry[];
}

export interface DeadlineQueryOptions {
  /** Inclusive calendar-date range. */
  from?: string;
  to?: string;
  includeArchive?: boolean;
}

/** SPEC §4.7: the one source for Today, Calendar, Tasks (and later Reminders/AI). Never caches. */
export interface DeadlineService {
  items(options?: DeadlineQueryOptions): DeadlineItem[];
  today(): TodayView;
  /** `month` is `YYYY-MM`; anything else throws VaultError('VALIDATION'). */
  calendar(month: string, options?: { includeArchive?: boolean }): CalendarView;
  tasks(options?: { includeArchive?: boolean }): TaskGroups;
}
