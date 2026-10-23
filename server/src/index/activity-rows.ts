/**
 * Narrow reads for the activity counts (M5, F35.9/F24.4/F26): the notes whose touches count and
 * the done tasks of a date range. Prepared once per connection (a rebuild swaps the connection,
 * so statements are kept per database object).
 */
import type Database from 'better-sqlite3';
import type { ContentClass } from '../markdown/markdown-types.js';
import type { VaultPath } from '../vault/vault-types.js';

/**
 * Notes the activity views know (titles, link targets, the AI-touched pages of "Não hôm nay"):
 * not templates, sources or control docs.
 */
export const ACTIVITY_CLASSES: readonly ContentClass[] = ['user', 'archived', 'wiki'];

/**
 * Notes whose creation, edits and links count as HER writing – "7 ngày ghi chép", "Não hôm nay"
 * ("+n ghi chú", "+n liên kết") and the weekly review alike (review L3): user and archived notes.
 * Wiki pages are the AI's (SPEC §4.2): they count only in "AI cập nhật n trang".
 */
export const OWN_WRITING_CLASSES: readonly ContentClass[] = ['user', 'archived'];

export const isOwnWriting = (row: Pick<ActivityNoteRow, 'class'>): boolean =>
  OWN_WRITING_CLASSES.includes(row.class);

export interface ActivityNoteRow {
  path: VaultPath;
  title: string;
  class: ContentClass;
  /** File modification time (ms), the fallback for days before `note_edited` existed. */
  mtimeMs: number;
}

/** A task ticked off (`✅ YYYY-MM-DD`) in a user note. */
export interface DoneTaskRow {
  path: VaultPath;
  /** Title of the note holding the task. */
  noteTitle: string;
  line: number;
  text: string;
  /** The `✅` calendar date. */
  completed: string;
}

export interface ActivityRowQueries {
  notes(): ActivityNoteRow[];
  /** Done tasks with `completed` in `[from, to]` (inclusive), newest first. */
  doneTasks(from: string, to: string): DoneTaskRow[];
}

const prepared = new WeakMap<Database.Database, ActivityRowQueries>();

export function activityRowQueries(db: Database.Database): ActivityRowQueries {
  const existing = prepared.get(db);
  if (existing) return existing;
  const classes = ACTIVITY_CLASSES.map((c) => `'${c}'`).join(', ');
  const notes = db.prepare(
    `SELECT path, title, class, mtime AS mtimeMs FROM notes WHERE class IN (${classes})`,
  );
  const done = db.prepare(
    `SELECT n.path AS path, n.title AS noteTitle, t.line AS line, t.text AS text,
       t.completed AS completed
     FROM tasks t JOIN notes n ON n.id = t.note_id
     WHERE n.class = 'user' AND t.done = 1 AND t.completed >= ? AND t.completed <= ?
     ORDER BY t.completed DESC, n.path, t.line`,
  );
  const queries: ActivityRowQueries = {
    notes: () => notes.all() as ActivityNoteRow[],
    doneTasks: (from, to) => done.all(from, to) as DoneTaskRow[],
  };
  prepared.set(db, queries);
  return queries;
}
