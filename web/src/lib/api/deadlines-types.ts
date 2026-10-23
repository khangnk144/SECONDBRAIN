/**
 * Deadline items, Today, Calendar and Tasks (SPEC §4.6, §4.7), mirrored by hand from
 * `server/src/index/index-types.ts` and `server/src/index/deadline-types.ts`, plus the task patch
 * and reschedule routes. Dates are local calendar dates `YYYY-MM-DD`, never instants.
 */
import type { GraphGroup } from './graph-types';
import type { ContentClass, VaultPath } from './vault-types';

/** SPEC §4.7: `done` when ticked or the note has `status: done`; else by days left. */
export type Urgency = 'done' | 'urgent' | 'soon' | 'ok';

/** A note with `deadline:` or a task with `📅` in a user note. */
export interface DeadlineItem {
  /** `note:<path>` or `task:<path>#<line>`. */
  id: string;
  kind: 'note' | 'task';
  /** Note title, or task text without tokens. */
  title: string;
  /** Due date. */
  date: string;
  path: VaultPath;
  noteTitle: string;
  /** 1-based file line (front matter counted); null for note items. */
  line: number | null;
  /** Expected line text for task patches; null for note items. */
  lineText: string | null;
  done: boolean;
  urgency: Urgency;
  /** Calendar days from today (negative = overdue). */
  daysLeft: number;
  class: ContentClass;
  /** Revision of the note the item lives in (every mutation sends it back). */
  revision: string;
}

/** A task as listed by Today and the Tasks view (dated or not). */
export interface TaskEntry {
  /** `task:<path>#<line>`. */
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
  revision: string;
}

/** A `type: project`, `status: doing` note on the Today screen. */
export interface ProjectSummary {
  path: VaultPath;
  title: string;
  deadline: string | null;
  daysLeft: number | null;
  urgency: Urgency | null;
  /** done/total of the note's tasks; null when it has none ("chưa có việc"). */
  progress: { done: number; total: number } | null;
  revision: string;
}

/** `GET /api/today`. */
export interface TodayView {
  /** Today's local calendar date. */
  date: string;
  /** Monday–Sunday week containing today. */
  week: { start: string; end: string };
  /**
   * Open items, each counted once: `overdue` before today; `deadlinesThisWeek` from today to
   * Sunday; `openToday` open tasks due today or undated in today's Daily note.
   */
  summary: { deadlinesThisWeek: number; openToday: number; overdue: number };
  /** Open items only: today … today+59 (one entry per day, possibly empty) and the overdue ones. */
  strip: { days: { date: string; items: DeadlineItem[] }[]; overdue: DeadlineItem[] };
  /** Open tasks due today or overdue, then the undated tasks of today's Daily note. */
  todayTasks: TaskEntry[];
  projects: ProjectSummary[];
  /**
   * M5: what was written lately ("7 ngày ghi chép", the encouragement line, "Não hôm nay").
   * `null` when the server could not read it; absent from servers older than M5 (and mocks).
   */
  activity?: TodayActivity | null;
}

/** A note on Today's "Não hôm nay" map; `group` is the brain map's colour group. */
export interface TodayBrainNode {
  path: VaultPath;
  title: string;
  group: GraphGroup;
}

/** `GET /api/today` `activity.brain` (F24.4): counts of today's events and a small map. */
export interface TodayBrain {
  /** Notes created today. */
  notesNew: number;
  /** Notes created or edited today (equals today's "7 ngày ghi chép" bar). */
  notesTouched: number;
  /** Links added today (unique linking note → target pairs). */
  linksAdded: number;
  /** Pages the AI wrote today (F34). */
  aiTouched: number;
  /** At most 24, most connected first. */
  nodes: TodayBrainNode[];
  /** Links among `nodes`; `from` is the linking note. */
  edges: { from: VaultPath; to: VaultPath }[];
}

/** `GET /api/today` `activity` (F35.9). Computed on the server from the index and the event log. */
export interface TodayActivity {
  /** The 7 local days ending today, oldest first: notes created or edited that day. */
  days: { date: string; count: number }[];
  /** Tasks ticked yesterday in user notes. */
  doneYesterday: number;
  brain: TodayBrain;
}

/** `GET /api/calendar?month=YYYY-MM`. */
export interface CalendarView {
  /** `YYYY-MM`. */
  month: string;
  /** Monday on or before the 1st and Sunday on or after the last day of the month. */
  start: string;
  end: string;
  /** Every date from start to end; done items included. */
  days: { date: string; inMonth: boolean; items: DeadlineItem[] }[];
}

/** `GET /api/tasks`: open tasks of user notes (archived ones on request), by due date. */
export interface TaskGroups {
  overdue: TaskEntry[];
  today: TaskEntry[];
  /** Due in 1–7 days. */
  next7: TaskEntry[];
  later: TaskEntry[];
  noDate: TaskEntry[];
}

/**
 * `PATCH /api/note/task`: exactly one of `done` / `due`. `line` is the 1-based file line the index
 * reports; the server also checks that line still reads `expectedText` (409 CONFLICT
 * `details.reason: 'revision' | 'line-changed'` otherwise).
 */
export interface PatchTaskRequest {
  path: VaultPath;
  expectedRevision: string;
  line: number;
  expectedText: string;
  done?: boolean;
  /** `YYYY-MM-DD` sets the `📅` date, null removes it. */
  due?: string | null;
}

export interface PatchTaskResponse {
  revision: string;
  /** The line as written. */
  lineText: string;
}

export type RescheduleTarget =
  { kind: 'note' } | { kind: 'task'; line: number; expectedText: string };

/** `POST /api/note/reschedule`: journaled, so the 10 s undo goes through the journal. */
export interface RescheduleRequest {
  path: VaultPath;
  expectedRevision: string;
  target: RescheduleTarget;
  date: string;
}

export interface RescheduleResponse {
  revision: string;
  /** Null when nothing changed (the item already had that date): there is nothing to undo. */
  journalId: string | null;
  /** Task targets: the line as written (absent from servers that do not send it). */
  lineText?: string;
}
