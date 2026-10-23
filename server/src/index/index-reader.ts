/**
 * Read-side queries of the index on one connection (prepared once per connection; the service
 * creates a new reader after a rebuild swaps the database file).
 */
import type Database from 'better-sqlite3';
import { CLASS_RULES } from '../markdown/content-classes.js';
import type { ContentClass } from '../markdown/markdown-types.js';
import type { VaultPath } from '../vault/vault-types.js';
import { compareTitles } from './deadline-rules.js';
import { createDeadlineRowsQuery, TASK_COLUMNS, toIndexedTask } from './deadline-rows.js';
import type { BacklinkRef, IndexedNote, IndexedTask, OutlinkRef, TagCount } from './index-types.js';

/** Classes with full-text rows; tag counts and filter searches use the same set. */
export const SEARCHABLE_CLASSES = (Object.keys(CLASS_RULES) as ContentClass[]).filter(
  (cls) => CLASS_RULES[cls].searchable,
);
export const SEARCHABLE_SQL = SEARCHABLE_CLASSES.map((c) => `'${c}'`).join(', ');

interface NoteRow {
  path: string;
  title: string;
  folder: string;
  class: ContentClass;
  type: string | null;
  status: string | null;
  deadline: string | null;
  created: string | null;
  mtime: number;
  size: number;
  revision: string;
  frontmatter: string | null;
  frontmatter_error: string | null;
  word_count: number;
}

const NOTE_COLUMNS = `path, title, folder, class, type, status, deadline, created, mtime, size,
  revision, frontmatter, frontmatter_error, word_count`;

function toIndexedNote(row: NoteRow): IndexedNote {
  return {
    path: row.path,
    title: row.title,
    folder: row.folder,
    class: row.class,
    type: row.type,
    status: row.status,
    deadline: row.deadline,
    created: row.created,
    mtimeMs: row.mtime,
    size: row.size,
    revision: row.revision,
    frontmatter: row.frontmatter ? (JSON.parse(row.frontmatter) as Record<string, unknown>) : null,
    frontmatterError: row.frontmatter_error,
    wordCount: row.word_count,
  };
}

export interface StoredFileState {
  path: VaultPath;
  size: number;
  mtime: number;
  /** null for non-note files (they are compared by size and mtime only). */
  revision: string | null;
}

export type IndexReader = ReturnType<typeof createIndexReader>;

export function createIndexReader(db: Database.Database) {
  const s = {
    note: db.prepare(`SELECT ${NOTE_COLUMNS} FROM notes WHERE path = ?`),
    notes: db.prepare(`SELECT ${NOTE_COLUMNS} FROM notes ORDER BY path`),
    backlinks: db.prepare(
      `SELECT n.path AS fromPath, n.title AS fromTitle, l.line AS line, l.context AS context,
         l.context_start AS hlStart, l.context_end AS hlEnd, MIN(l.rowid) AS first
       FROM links l JOIN notes n ON n.id = l.from_id
       WHERE l.to_path = ? AND n.path <> ? GROUP BY n.id, l.line`,
    ),
    outlinks: db.prepare(
      `SELECT raw, target_raw AS target, line, to_path AS toPath, ambiguous FROM links
       WHERE from_id = (SELECT id FROM notes WHERE path = ?) ORDER BY rowid`,
    ),
    noteTags: db
      .prepare(
        'SELECT tag FROM tags WHERE note_id = (SELECT id FROM notes WHERE path = ?) ORDER BY rowid',
      )
      .pluck(),
    allNoteTags: db.prepare(
      'SELECT n.path AS path, t.tag AS tag FROM tags t JOIN notes n ON n.id = t.note_id ORDER BY t.rowid',
    ),
    tags: db.prepare(
      `SELECT t.tag AS tag, t.tag_norm AS norm, MIN(t.rowid) AS first, COUNT(*) AS count
       FROM tags t JOIN notes n ON n.id = t.note_id
       WHERE n.class IN (${SEARCHABLE_SQL}) GROUP BY t.tag_norm`,
    ),
    linking: db
      .prepare(
        `SELECT DISTINCT n.path FROM links l JOIN notes n ON n.id = l.from_id
         WHERE l.to_path = ? AND l.ambiguous = 0 ORDER BY n.path`,
      )
      .pluck(),
    tasks: db.prepare(
      `SELECT ${TASK_COLUMNS} FROM tasks t JOIN notes n ON n.id = t.note_id ORDER BY n.path, t.line`,
    ),
    notePaths: db.prepare('SELECT path FROM notes').pluck(),
    noteTitles: db.prepare('SELECT path, title, class FROM notes ORDER BY path'),
    phrase: db.prepare('SELECT path FROM notes_fts WHERE notes_fts MATCH ? ORDER BY path').pluck(),
    filePaths: db.prepare('SELECT path FROM files').pluck(),
    noteStates: db.prepare('SELECT path, size, mtime, revision FROM notes'),
    fileStates: db.prepare('SELECT path, size, mtime, NULL AS revision FROM files'),
  };

  return {
    getNote(path: VaultPath): IndexedNote | null {
      const row = s.note.get(path) as NoteRow | undefined;
      return row ? toIndexedNote(row) : null;
    },
    listNotes(): IndexedNote[] {
      return (s.notes.all() as NoteRow[]).map(toIndexedNote);
    },
    backlinks(path: VaultPath): BacklinkRef[] {
      type Row = Omit<BacklinkRef, 'highlight'> & { hlStart: number; hlEnd: number };
      const rows = s.backlinks.all(path, path) as Row[];
      return rows
        .map(({ fromPath, fromTitle, line, context, hlStart, hlEnd }) => ({
          fromPath,
          fromTitle,
          line,
          context,
          highlight: [hlStart, hlEnd] as [number, number],
        }))
        .sort(
          (a, b) =>
            compareTitles(a.fromTitle, b.fromTitle) ||
            a.fromPath.localeCompare(b.fromPath) ||
            a.line - b.line,
        );
    },
    outlinks(path: VaultPath): OutlinkRef[] {
      const rows = s.outlinks.all(path) as (Omit<OutlinkRef, 'ambiguous'> & {
        ambiguous: number;
      })[];
      return rows.map((r) => ({ ...r, ambiguous: r.ambiguous === 1 }));
    },
    noteTags(path: VaultPath): string[] {
      return s.noteTags.all(path) as string[];
    },
    noteTagsByPath(): Map<VaultPath, string[]> {
      const byPath = new Map<VaultPath, string[]>();
      for (const { path, tag } of s.allNoteTags.all() as { path: VaultPath; tag: string }[]) {
        const tags = byPath.get(path);
        if (tags) tags.push(tag);
        else byPath.set(path, [tag]);
      }
      return byPath;
    },
    tags(): TagCount[] {
      const rows = s.tags.all() as (TagCount & { first: number })[];
      return rows
        .map(({ tag, norm, count }) => ({ tag, norm, count }))
        .sort((a, b) => compareTitles(a.norm, b.norm) || (a.norm < b.norm ? -1 : 1));
    },
    linkingNotes(path: VaultPath): VaultPath[] {
      return s.linking.all(path) as VaultPath[];
    },
    allTasks(): IndexedTask[] {
      return (s.tasks.all() as Parameters<typeof toIndexedTask>[0][]).map(toIndexedTask);
    },
    deadlineRows: createDeadlineRowsQuery(db),
    noteTitles(): { path: VaultPath; title: string; class: ContentClass }[] {
      return s.noteTitles.all() as { path: VaultPath; title: string; class: ContentClass }[];
    },
    /** Paths of searchable notes whose full text matches an FTS expression. */
    matchingNotes(expression: string): VaultPath[] {
      return s.phrase.all(expression) as VaultPath[];
    },
    allPaths(): VaultPath[] {
      return [...(s.notePaths.all() as VaultPath[]), ...(s.filePaths.all() as VaultPath[])];
    },
    storedStates(): StoredFileState[] {
      return [
        ...(s.noteStates.all() as StoredFileState[]),
        ...(s.fileStates.all() as StoredFileState[]),
      ];
    },
  };
}
