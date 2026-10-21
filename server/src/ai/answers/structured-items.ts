/**
 * Items of a structured answer (SPEC F33.1, S5), always from the deadline-items service – the
 * same rows Today and Calendar show – never from the index directly. Deadline questions get the
 * open items of the range in Today's order (for "this week": today … Sunday, exactly Today's
 * `deadlinesThisWeek`) plus the open overdue items in their own group; task questions get Today's
 * open `todayTasks`. Items of notes outside the AI scope are dropped and counted.
 */
import type { DeadlineItem, DeadlineService, TaskEntry } from '../../index/index-types.js';
import { addDays } from '../../lib/local-date.js';
import type { VaultPath } from '../../vault/vault-types.js';
import type { QuestionIntent } from '../intent/intent-types.js';

export interface AnswerEntry {
  kind: 'note' | 'task';
  id: string;
  /** Note title, or the task text without tokens. */
  title: string;
  path: VaultPath;
  noteTitle: string;
  date: string | null;
  daysLeft: number | null;
}

export interface AnswerGroup {
  /** `overdue`: before today; `day`: one calendar date (undated Daily tasks go under today). */
  kind: 'overdue' | 'day';
  date: string | null;
  entries: AnswerEntry[];
}

export interface StructuredAnswer {
  kind: 'deadlines' | 'tasks';
  range: { from: string; to: string } | null;
  about: string[];
  groups: AnswerGroup[];
  total: number;
  /** Items left out because their note is outside the AI folder scope. */
  hidden: number;
  /**
   * True when no open item of the range belongs to the topics of `about` although some exist:
   * the answer lists all of them instead of a confident "none" (a course she names in plain
   * words, or not at all, must not make Today's items disappear).
   */
  aboutUnmatched: boolean;
}

export interface StructuredDeps {
  deadlines: Pick<DeadlineService, 'items' | 'today'>;
  today: string;
  inScope: (path: VaultPath) => boolean;
  /** Whether an item belongs to the topics of `intent.about` (see topic-relations). */
  relatesToTopics: ((entry: AnswerEntry) => boolean) | null;
}

const fromItem = (item: DeadlineItem): AnswerEntry => ({
  kind: item.kind,
  id: item.id,
  title: item.title,
  path: item.path,
  noteTitle: item.noteTitle,
  date: item.date,
  daysLeft: item.daysLeft,
});

const fromTask = (task: TaskEntry): AnswerEntry => ({
  kind: 'task',
  id: task.id,
  title: task.title,
  path: task.path,
  noteTitle: task.noteTitle,
  date: task.date,
  daysLeft: task.daysLeft,
});

/** Day groups in the order the entries arrive (already sorted by date). */
function byDay(entries: AnswerEntry[], today: string): AnswerGroup[] {
  const groups: AnswerGroup[] = [];
  for (const entry of entries) {
    const date = entry.date ?? today;
    const last = groups.at(-1);
    if (last && last.date === date) last.entries.push(entry);
    else groups.push({ kind: 'day', date, entries: [entry] });
  }
  return groups;
}

function rangeEntries(intent: QuestionIntent, deps: StructuredDeps): AnswerEntry[] {
  if (intent.from === null || intent.to === null) return [];
  // Open items before today are overdue: they belong to the overdue group, as on Today.
  const from = intent.from < deps.today && intent.to >= deps.today ? deps.today : intent.from;
  return deps.deadlines
    .items({ from, to: intent.to })
    .filter((item) => !item.done)
    .map(fromItem);
}

function overdueEntries(deps: StructuredDeps): AnswerEntry[] {
  return deps.deadlines
    .items({ to: addDays(deps.today, -1) })
    .filter((item) => !item.done)
    .map(fromItem);
}

export function selectStructuredItems(
  intent: QuestionIntent,
  deps: StructuredDeps,
): StructuredAnswer {
  const kind = intent.kind === 'tasks' ? 'tasks' : 'deadlines';
  let overdue: AnswerEntry[];
  let current: AnswerEntry[];
  if (kind === 'tasks') {
    const open = deps.deadlines
      .today()
      .todayTasks.filter((task) => !task.done)
      .map(fromTask);
    overdue = open.filter((entry) => entry.date !== null && entry.date < deps.today);
    current = open.filter((entry) => entry.date === null || entry.date >= deps.today);
  } else {
    current = rangeEntries(intent, deps);
    const shown = new Set(current.map((entry) => entry.id));
    overdue = intent.overdue ? overdueEntries(deps).filter((entry) => !shown.has(entry.id)) : [];
  }
  const all = [...overdue, ...current];
  const shown = (entry: AnswerEntry) => deps.inScope(entry.path);
  overdue = overdue.filter(shown);
  current = current.filter(shown);
  let hidden = all.length - overdue.length - current.length;
  let aboutUnmatched = false;
  const related = deps.relatesToTopics;
  if (related) {
    const topicOverdue = overdue.filter(related);
    const topicCurrent = current.filter(related);
    if (topicOverdue.length + topicCurrent.length > 0 || overdue.length + current.length === 0) {
      overdue = topicOverdue;
      current = topicCurrent;
      // Only the topic's own items outside the scope are worth a notice.
      hidden = all.filter((entry) => !shown(entry) && related(entry)).length;
    } else aboutUnmatched = true;
  }
  const groups: AnswerGroup[] = [];
  if (overdue.length > 0) groups.push({ kind: 'overdue', date: null, entries: overdue });
  groups.push(...byDay(current, deps.today));
  const range =
    kind === 'tasks'
      ? { from: deps.today, to: deps.today }
      : intent.from && intent.to
        ? { from: intent.from, to: intent.to }
        : null;
  return {
    kind,
    range,
    about: intent.about,
    groups,
    total: overdue.length + current.length,
    hidden,
    aboutUnmatched,
  };
}
