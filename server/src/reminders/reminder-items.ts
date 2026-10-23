/**
 * The deadline items reminders care about and the in-app list (`GET /api/reminders`). Both read
 * the deadline service afresh, so a ticked, rescheduled or deleted item drops out at once.
 */
import type { AppContext } from '../app-context/create-app-context.js';
import type { DeadlineItem } from '../index/index-types.js';
import { CLASS_RULES } from '../markdown/content-classes.js';
import type { ReminderEntry } from './reminder-types.js';

/** Listed reminders are at most this old. */
export const LIST_WINDOW_DAYS = 7;
const DAY_MS = 86_400_000;

/**
 * Open items of classes that are reminded (SPEC §4.2: user notes only). The deadline service
 * already leaves out templates, sources, wiki pages and the archive; the class rule is checked
 * again so the reminder column of the table is the one that decides.
 */
export function remindableItems(context: Pick<AppContext, 'deadlines'>): DeadlineItem[] {
  return context.deadlines
    .items()
    .filter((item) => !item.done && CLASS_RULES[item.class].reminders);
}

const taskText = (path: string, title: string, due: string) =>
  JSON.stringify([path, title.normalize('NFC'), due]);

/** What a fired reminder (or a Telegram/email message of it) says about its item. */
export type FiredItem = Pick<ReminderEntry, 'itemId' | 'path' | 'title' | 'due'>;

/**
 * Whether a fired reminder still points at an open item with the same due date: the rule of the
 * in-app list and of every later Telegram/email attempt (F17: done, rescheduled or deleted items
 * are never reminded). A task whose line moved is matched by note, text and date.
 */
export function stillOpenMatcher(open: readonly DeadlineItem[]): (fired: FiredItem) => boolean {
  const dueById = new Map(open.map((item) => [item.id, item.date]));
  const tasks = new Set(
    open.filter((i) => i.kind === 'task').map((i) => taskText(i.path, i.title, i.date)),
  );
  return (fired) =>
    dueById.get(fired.itemId) === fired.due ||
    (fired.itemId.startsWith('task:') && tasks.has(taskText(fired.path, fired.title, fired.due)));
}

/** Not dismissed, fired within the last 7 days, and its item still open (see above). Newest first. */
export function listReminders(
  entries: readonly ReminderEntry[],
  open: readonly DeadlineItem[],
  now: Date,
): ReminderEntry[] {
  const stillOpen = stillOpenMatcher(open);
  const cutoff = now.getTime() - LIST_WINDOW_DAYS * DAY_MS;
  return entries
    .filter((entry) => {
      if (entry.dismissed || Date.parse(entry.firedAt) < cutoff) return false;
      return stillOpen(entry);
    })
    .sort(
      (a, b) =>
        Date.parse(b.firedAt) - Date.parse(a.firedAt) ||
        a.threshold - b.threshold ||
        (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
    );
}
