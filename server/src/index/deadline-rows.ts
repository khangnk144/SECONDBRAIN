/**
 * The narrow read the deadline service and the `due:` search filter need: only notes of classes
 * that can produce items, and only those with a deadline, a project type or tasks. On a 5k-note
 * vault this is a few hundred rows instead of every note with its parsed front matter.
 */
import type Database from 'better-sqlite3';
import { CLASS_RULES } from '../markdown/content-classes.js';
import type { ContentClass } from '../markdown/markdown-types.js';
import type { DeadlineRows, IndexedTask } from './index-types.js';

/** Classes whose notes may own deadline items (archived ones on request) – see producesItems. */
const ITEM_CLASSES = (Object.keys(CLASS_RULES) as ContentClass[])
  .filter((cls) => CLASS_RULES[cls].tasksCounted || cls === 'archived')
  .map((cls) => `'${cls}'`)
  .join(', ');

interface TaskRow extends Omit<IndexedTask, 'done' | 'invalidDates'> {
  done: number;
  invalid: string | null;
}

export const TASK_COLUMNS = `n.path AS path, t.line AS line, t.line_text AS lineText, t.text AS text,
  t.done AS done, t.due AS due, t.completed AS completed, t.invalid_dates AS invalid`;

export function toIndexedTask({ invalid, done, ...rest }: TaskRow): IndexedTask {
  return {
    ...rest,
    done: done === 1,
    invalidDates: invalid ? (JSON.parse(invalid) as string[]) : [],
  };
}

export function createDeadlineRowsQuery(db: Database.Database): () => DeadlineRows {
  const notes = db.prepare(
    `SELECT path, title, class, type, status, deadline FROM notes n
     WHERE class IN (${ITEM_CLASSES})
       AND (deadline IS NOT NULL OR lower(trim(type)) = 'project'
            OR EXISTS (SELECT 1 FROM tasks t WHERE t.note_id = n.id))`,
  );
  const tasks = db.prepare(
    `SELECT ${TASK_COLUMNS} FROM tasks t JOIN notes n ON n.id = t.note_id
     WHERE n.class IN (${ITEM_CLASSES}) ORDER BY n.path, t.line`,
  );
  return () => ({
    notes: notes.all() as DeadlineRows['notes'],
    tasks: (tasks.all() as TaskRow[]).map(toIndexedTask),
  });
}
