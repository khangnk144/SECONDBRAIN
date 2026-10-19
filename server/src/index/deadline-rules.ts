/**
 * Deadline semantics of SPEC §4.7 over plain index rows: which notes and tasks produce items,
 * when an item is done, and its urgency on local calendar dates. Pure: "today" is a parameter,
 * so every caller derives it from the injected clock at call time (correct after a sleep).
 */
import { CLASS_RULES } from '../markdown/content-classes.js';
import type { ContentClass } from '../markdown/markdown-types.js';
import type { VaultPath } from '../vault/vault-types.js';
import { diffDays } from '../lib/local-date.js';
import type { DeadlineItem, IndexedTask, TaskEntry, Urgency } from './index-types.js';

/** The note facts the deadline rules need (a subset of IndexedNote). */
export interface DeadlineNote {
  path: VaultPath;
  title: string;
  class: ContentClass;
  type: string | null;
  status: string | null;
  deadline: string | null;
}

export interface DeadlineSources {
  notes: ReadonlyMap<VaultPath, DeadlineNote>;
  tasks: readonly IndexedTask[];
}

export const URGENCY_RANK: Record<Urgency, number> = { urgent: 0, soon: 1, ok: 2, done: 3 };

export function urgencyFor(daysLeft: number, done: boolean): Urgency {
  if (done) return 'done';
  if (daysLeft <= 2) return 'urgent';
  if (daysLeft <= 7) return 'soon';
  return 'ok';
}

export function isDoneStatus(status: string | null): boolean {
  return status !== null && status.trim().toLowerCase() === 'done';
}

/** User notes always; archived notes only when the caller asked to include the archive. */
export function producesItems(cls: ContentClass, includeArchive: boolean): boolean {
  return CLASS_RULES[cls].tasksCounted || (includeArchive && cls === 'archived');
}

const collator = new Intl.Collator('vi', { sensitivity: 'base', numeric: true });

export function compareTitles(a: string, b: string): number {
  return collator.compare(a, b);
}

/** Strip and calendar order: urgent → soon → ok (→ done), then title, then id for stability. */
export function compareByUrgency(a: DeadlineItem, b: DeadlineItem): number {
  return (
    URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency] ||
    compareTitles(a.title, b.title) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

export function compareByDate(a: DeadlineItem, b: DeadlineItem): number {
  return a.date < b.date ? -1 : a.date > b.date ? 1 : compareByUrgency(a, b);
}

export function taskId(path: VaultPath, line: number): string {
  return `task:${path}#${line}`;
}

/** Every deadline item (note deadlines and dated tasks), unsorted. */
export function collectItems(
  sources: DeadlineSources,
  today: string,
  includeArchive: boolean,
): DeadlineItem[] {
  const items: DeadlineItem[] = [];
  for (const note of sources.notes.values()) {
    if (!note.deadline || !producesItems(note.class, includeArchive)) continue;
    const done = isDoneStatus(note.status);
    const daysLeft = diffDays(today, note.deadline);
    items.push({
      id: `note:${note.path}`,
      kind: 'note',
      title: note.title,
      date: note.deadline,
      path: note.path,
      noteTitle: note.title,
      line: null,
      lineText: null,
      done,
      urgency: urgencyFor(daysLeft, done),
      daysLeft,
      class: note.class,
    });
  }
  for (const task of sources.tasks) {
    const note = sources.notes.get(task.path);
    if (!task.due || !note || !producesItems(note.class, includeArchive)) continue;
    const entry = taskEntry(task, note, today);
    items.push({
      id: entry.id,
      kind: 'task',
      title: entry.title,
      date: task.due,
      path: task.path,
      noteTitle: note.title,
      line: task.line,
      lineText: task.lineText,
      done: entry.done,
      urgency: entry.urgency ?? 'ok',
      daysLeft: entry.daysLeft ?? 0,
      class: note.class,
    });
  }
  return items;
}

/** A task row with its note's facts; done when ticked or when its note has `status: done`. */
export function taskEntry(task: IndexedTask, note: DeadlineNote, today: string): TaskEntry {
  const done = task.done || isDoneStatus(note.status);
  const daysLeft = task.due ? diffDays(today, task.due) : null;
  return {
    id: taskId(task.path, task.line),
    title: task.text,
    path: task.path,
    noteTitle: note.title,
    line: task.line,
    lineText: task.lineText,
    done,
    date: task.due,
    urgency: daysLeft === null ? null : urgencyFor(daysLeft, done),
    daysLeft,
    class: note.class,
  };
}

/** Task view and Today order: by due date (undated last), then note title, then line. */
export function compareTaskEntries(a: TaskEntry, b: TaskEntry): number {
  if (a.date !== b.date) {
    if (a.date === null) return 1;
    if (b.date === null) return -1;
    return a.date < b.date ? -1 : 1;
  }
  return (
    compareTitles(a.noteTitle, b.noteTitle) ||
    (a.path < b.path ? -1 : a.path > b.path ? 1 : 0) ||
    a.line - b.line
  );
}
