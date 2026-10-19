/**
 * Deadline-items service (SPEC §4.7): one source for Today, Calendar, Tasks and later Reminders
 * and AI. Every call reads the index and the injected clock afresh – nothing is cached – so the
 * answer is right after midnight or after the machine wakes from sleep without a reindex.
 */
import {
  dateRange,
  endOfWeekSunday,
  isCalendarDate,
  monthBounds,
  parseMonth,
  startOfWeekMonday,
  toLocalDate,
} from '../lib/local-date.js';
import { VaultError, type VaultPath } from '../vault/vault-types.js';
import {
  collectItems,
  compareByDate,
  compareByUrgency,
  compareTaskEntries,
  producesItems,
  taskEntry,
  type DeadlineNote,
  type DeadlineSources,
} from './deadline-rules.js';
import type {
  CalendarView,
  DeadlineItem,
  DeadlineQueryOptions,
  DeadlineService,
  IndexService,
  TaskGroups,
} from './index-types.js';
import { buildTodayView } from './today-view.js';

/** Prefers the narrow `deadlineRows()` read; falls back for indexes that do not offer it. */
export function loadDeadlineSources(
  index: Pick<IndexService, 'listNotes' | 'allTasks' | 'deadlineRows'>,
): DeadlineSources {
  const rows = index.deadlineRows?.() ?? { notes: index.listNotes(), tasks: index.allTasks() };
  const notes = new Map<VaultPath, DeadlineNote>();
  for (const note of rows.notes) {
    notes.set(note.path, {
      path: note.path,
      title: note.title,
      class: note.class,
      type: note.type,
      status: note.status,
      deadline: note.deadline,
    });
  }
  return { notes, tasks: rows.tasks };
}

function checkDate(value: string | undefined, name: string): void {
  if (value !== undefined && !isCalendarDate(value))
    throw new VaultError('VALIDATION', `${name} must be a calendar date YYYY-MM-DD`, {
      [name]: value,
    });
}

export function createDeadlineService(index: IndexService, now: () => Date): DeadlineService {
  const today = () => toLocalDate(now());

  return {
    items(options: DeadlineQueryOptions = {}): DeadlineItem[] {
      checkDate(options.from, 'from');
      checkDate(options.to, 'to');
      const { from, to } = options;
      return collectItems(loadDeadlineSources(index), today(), options.includeArchive === true)
        .filter((item) => (!from || item.date >= from) && (!to || item.date <= to))
        .sort(compareByDate);
    },

    today() {
      return buildTodayView(loadDeadlineSources(index), today());
    },

    calendar(month: string, options: { includeArchive?: boolean } = {}): CalendarView {
      if (typeof month !== 'string' || !parseMonth(month))
        throw new VaultError('VALIDATION', 'month must be YYYY-MM', { month });
      const { first, last } = monthBounds(month);
      const start = startOfWeekMonday(first);
      const end = endOfWeekSunday(last);
      const byDate = new Map<string, DeadlineItem[]>();
      for (const item of collectItems(
        loadDeadlineSources(index),
        today(),
        options.includeArchive === true,
      )) {
        if (item.date < start || item.date > end) continue;
        const list = byDate.get(item.date) ?? [];
        list.push(item);
        byDate.set(item.date, list);
      }
      return {
        month,
        start,
        end,
        days: dateRange(start, end).map((date) => ({
          date,
          inMonth: date >= first && date <= last,
          items: (byDate.get(date) ?? []).sort(compareByUrgency),
        })),
      };
    },

    tasks(options: { includeArchive?: boolean } = {}): TaskGroups {
      const sources = loadDeadlineSources(index);
      const day = today();
      const groups: TaskGroups = { overdue: [], today: [], next7: [], later: [], noDate: [] };
      for (const task of sources.tasks) {
        const note = sources.notes.get(task.path);
        if (!note || !producesItems(note.class, options.includeArchive === true)) continue;
        const entry = taskEntry(task, note, day);
        if (entry.done) continue;
        const d = entry.daysLeft;
        if (d === null) groups.noDate.push(entry);
        else if (d < 0) groups.overdue.push(entry);
        else if (d === 0) groups.today.push(entry);
        else if (d <= 7) groups.next7.push(entry);
        else groups.later.push(entry);
      }
      for (const list of Object.values(groups)) list.sort(compareTaskEntries);
      return groups;
    },
  };
}
