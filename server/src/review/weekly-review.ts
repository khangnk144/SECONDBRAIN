/**
 * "Tổng kết tuần" (SPEC F26.1): the seven local days ending on `end`, from the activity service
 * (events + index) and the deadline-items service, so its numbers agree with Today:
 * - `inbox.count`: notes directly in `0 Inbox` now (F2.3);
 * - `notes`: user and archived notes created or edited in the week (SPEC §4.2; wiki pages, the
 *   generated "Học kỳ này" page – the activity service never counts it – and other classes left
 *   out), newest day first; `change` says
 *   `created` when the note's `created:` date is in the week, else `edited`;
 * - `tasksDone`: tasks of user notes ticked off (`✅`) in the week, newest first;
 * - `upcoming.count`: open deadline items of the seven days after `end`.
 * Lists stop at `MAX_REVIEW_ITEMS`; counts are complete.
 */
import type { ActivityService } from '../index/activity-service.js';
import { compareTitles } from '../index/deadline-rules.js';
import type { DeadlineService, IndexService } from '../index/index-types.js';
import { addDays } from '../lib/local-date.js';
import { linkIdentityKey } from '../markdown/normalize-text.js';
import type { VaultPath } from '../vault/vault-types.js';

export const REVIEW_DAYS = 7;
export const UPCOMING_DAYS = 7;
export const MAX_REVIEW_ITEMS = 50;
const INBOX_KEY = linkIdentityKey('0 Inbox');

export interface ReviewNote {
  path: VaultPath;
  title: string;
  /** Top folder ('' at the vault root). */
  folder: string;
  change: 'created' | 'edited';
  /** The last day of the week the note was touched. */
  day: string;
}

export interface ReviewTask {
  path: VaultPath;
  noteTitle: string;
  line: number;
  text: string;
  completed: string;
}

export interface WeekReview {
  start: string;
  end: string;
  inbox: { count: number };
  notes: { count: number; items: ReviewNote[] };
  tasksDone: { count: number; items: ReviewTask[] };
  upcoming: { count: number; from: string; to: string };
}

export interface ReviewDeps {
  /** Counted notes (the generated page never is), touches and done tasks. */
  activity: ActivityService;
  index: Pick<IndexService, 'getNote'>;
  deadlines: Pick<DeadlineService, 'items'>;
}

const parentKey = (path: VaultPath) =>
  linkIdentityKey(path.slice(0, Math.max(path.lastIndexOf('/'), 0)));
const topFolder = (path: VaultPath) => (path.includes('/') ? path.slice(0, path.indexOf('/')) : '');

export async function buildWeekReview(deps: ReviewDeps, end: string): Promise<WeekReview> {
  const start = addDays(end, 1 - REVIEW_DAYS);
  const rows = new Map(deps.activity.notes().map((row) => [row.path, row]));
  const inboxCount = [...rows.values()].filter(
    (row) => row.class === 'user' && parentKey(row.path) === INBOX_KEY,
  ).length;

  const lastDay = new Map<VaultPath, string>();
  for (const [day, paths] of await deps.activity.touchedNotesByDay(start, end)) {
    for (const path of paths) {
      const known = lastDay.get(path);
      if (known === undefined || day > known) lastDay.set(path, day);
    }
  }
  const notes: ReviewNote[] = [];
  for (const [path, day] of lastDay) {
    const row = rows.get(path);
    if (!row || (row.class !== 'user' && row.class !== 'archived')) continue;
    const created = deps.index.getNote(path)?.created ?? null;
    notes.push({
      path,
      title: row.title,
      folder: topFolder(path),
      change: created !== null && created >= start && created <= end ? 'created' : 'edited',
      day,
    });
  }
  notes.sort((a, b) => b.day.localeCompare(a.day) || compareTitles(a.title, b.title));

  const done = deps.activity.doneTasksBetween(start, end);
  const from = addDays(end, 1);
  const to = addDays(end, UPCOMING_DAYS);
  const upcoming = deps.deadlines.items({ from, to }).filter((item) => !item.done).length;
  return {
    start,
    end,
    inbox: { count: inboxCount },
    notes: { count: notes.length, items: notes.slice(0, MAX_REVIEW_ITEMS) },
    tasksDone: {
      count: done.length,
      items: done.slice(0, MAX_REVIEW_ITEMS).map(({ path, noteTitle, line, text, completed }) => ({
        path,
        noteTitle,
        line,
        text,
        completed,
      })),
    },
    upcoming: { count: upcoming, from, to },
  };
}
