/**
 * Row-level writes of the index on one connection (prepared once). Callers wrap calls in a
 * transaction; a note keeps its row id across edits and renames, children are replaced.
 */
import type Database from 'better-sqlite3';
import { foldForMatch, normalizeForIndex } from '../markdown/normalize-text.js';
import type { FileStat, VaultPath } from '../vault/vault-types.js';
import type { LinkResolver } from './link-targets.js';
import { folderOf, titleForPath, type NoteRecord } from './note-record.js';
import { CLASS_RULES, classifyPath } from '../markdown/content-classes.js';

export interface NoteRowState {
  id: number;
  revision: string;
  mtime: number;
  size: number;
}

export type IndexWriter = ReturnType<typeof createIndexWriter>;

export function createIndexWriter(db: Database.Database) {
  const s = {
    noteByPath: db.prepare('SELECT id, revision, mtime, size FROM notes WHERE path = ?'),
    noteId: db.prepare('SELECT id FROM notes WHERE path = ?').pluck(),
    insertNote: db.prepare(
      `INSERT INTO notes(path, title, title_norm, folder, class, type, status, deadline, created,
         mtime, size, revision, frontmatter, word_count, path_norm, frontmatter_error)
       VALUES (@path, @title, @titleNorm, @folder, @cls, @type, @status, @deadline, @created,
         @mtimeMs, @size, @revision, @frontmatterJson, @wordCount, @pathNorm, @frontmatterError)`,
    ),
    updateNote: db.prepare(
      `UPDATE notes SET path = @path, title = @title, title_norm = @titleNorm, folder = @folder,
         class = @cls, type = @type, status = @status, deadline = @deadline, created = @created,
         mtime = @mtimeMs, size = @size, revision = @revision, frontmatter = @frontmatterJson,
         word_count = @wordCount, path_norm = @pathNorm, frontmatter_error = @frontmatterError
       WHERE id = @id`,
    ),
    touchNote: db.prepare('UPDATE notes SET mtime = ?, size = ? WHERE id = ?'),
    moveNote: db.prepare(
      `UPDATE notes SET path = ?, title = ?, title_norm = ?, folder = ?, class = ?, path_norm = ?
       WHERE id = ?`,
    ),
    deleteNote: db.prepare('DELETE FROM notes WHERE id = ?'),
    deleteLinks: db.prepare('DELETE FROM links WHERE from_id = ?'),
    deleteTags: db.prepare('DELETE FROM tags WHERE note_id = ?'),
    deleteTasks: db.prepare('DELETE FROM tasks WHERE note_id = ?'),
    deleteText: db.prepare('DELETE FROM note_text WHERE note_id = ?'),
    deleteFts: db.prepare('DELETE FROM notes_fts WHERE rowid = ?'),
    insertLink: db.prepare(
      `INSERT INTO links(from_id, target_raw, to_id, heading, line, ambiguous, kind, raw, alias,
         frontmatter_key, target_key, to_path, context)
       VALUES (?, ?, (SELECT id FROM notes WHERE path = ?), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ),
    insertTag: db.prepare('INSERT INTO tags(note_id, tag, tag_norm, tag_fold) VALUES (?, ?, ?, ?)'),
    insertTask: db.prepare(
      `INSERT INTO tasks(note_id, line, text, done, due, completed, line_text, invalid_dates)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ),
    insertText: db.prepare('INSERT INTO note_text(note_id, plain) VALUES (?, ?)'),
    selectText: db.prepare('SELECT plain FROM note_text WHERE note_id = ?').pluck(),
    insertFts: db.prepare(
      'INSERT INTO notes_fts(rowid, path, title_norm, body_norm) VALUES (?, ?, ?, ?)',
    ),
    fileByPath: db.prepare('SELECT size, mtime FROM files WHERE path = ?'),
    upsertFile: db.prepare(
      `INSERT INTO files(path, name_key, size, mtime) VALUES (?, ?, ?, ?)
       ON CONFLICT(path) DO UPDATE SET name_key = excluded.name_key, size = excluded.size,
         mtime = excluded.mtime`,
    ),
    deleteFile: db.prepare('DELETE FROM files WHERE path = ?'),
  };

  function clearChildren(id: number): void {
    s.deleteLinks.run(id);
    s.deleteTags.run(id);
    s.deleteTasks.run(id);
    s.deleteText.run(id);
    s.deleteFts.run(id);
  }

  return {
    noteState(path: VaultPath): NoteRowState | null {
      return (s.noteByPath.get(path) as NoteRowState | undefined) ?? null;
    },

    noteId(path: VaultPath): number | null {
      return (s.noteId.get(path) as number | undefined) ?? null;
    },

    /** Inserts or fully replaces the note at `record.path` (row id kept). Returns the id. */
    writeNote(record: NoteRecord, resolve: LinkResolver): number {
      const existing = s.noteId.get(record.path) as number | undefined;
      let id: number;
      if (existing === undefined) {
        id = Number(s.insertNote.run(record).lastInsertRowid);
      } else {
        id = existing;
        s.updateNote.run({ ...record, id });
        clearChildren(id);
      }
      for (const link of record.links) {
        const { toPath, ambiguous } = resolve(link, record.path);
        s.insertLink.run(
          id,
          link.target,
          toPath,
          link.heading,
          link.line,
          ambiguous ? 1 : 0,
          link.kind,
          link.raw,
          link.alias,
          link.frontmatterKey,
          link.targetKey,
          toPath,
          link.context,
        );
      }
      for (const tag of record.tags) s.insertTag.run(id, tag.tag, tag.norm, foldForMatch(tag.tag));
      for (const t of record.tasks) {
        s.insertTask.run(
          id,
          t.line,
          t.text,
          t.done ? 1 : 0,
          t.due,
          t.completed,
          t.lineText,
          t.invalidDates.length > 0 ? JSON.stringify(t.invalidDates) : null,
        );
      }
      s.insertText.run(id, record.plain);
      if (record.searchable)
        s.insertFts.run(id, record.path, record.titleNorm, normalizeForIndex(record.plain));
      return id;
    },

    touchNote(id: number, mtimeMs: number, size: number): void {
      s.touchNote.run(Math.trunc(mtimeMs), size, id);
    },

    /** Gives an existing row a new path (title, folder, class follow); content rows stay. */
    moveNote(id: number, newPath: VaultPath): void {
      const title = titleForPath(newPath);
      const cls = classifyPath(newPath);
      const titleNorm = normalizeForIndex(title);
      s.moveNote.run(
        newPath,
        title,
        titleNorm,
        folderOf(newPath),
        cls,
        normalizeForIndex(newPath),
        id,
      );
      s.deleteFts.run(id);
      if (CLASS_RULES[cls].searchable) {
        const plain = (s.selectText.get(id) as string | undefined) ?? '';
        s.insertFts.run(id, newPath, titleNorm, normalizeForIndex(plain));
      }
    },

    deleteNote(path: VaultPath): number | null {
      const id = s.noteId.get(path) as number | undefined;
      if (id === undefined) return null;
      clearChildren(id);
      s.deleteNote.run(id);
      return id;
    },

    fileState(path: VaultPath): { size: number; mtime: number } | null {
      return (s.fileByPath.get(path) as { size: number; mtime: number } | undefined) ?? null;
    },

    writeFile(stat: FileStat): void {
      const name = stat.path.slice(stat.path.lastIndexOf('/') + 1);
      s.upsertFile.run(stat.path, normalizeForIndex(name), stat.size, Math.trunc(stat.mtimeMs));
    },

    deleteFile(path: VaultPath): boolean {
      return s.deleteFile.run(path).changes > 0;
    },
  };
}
