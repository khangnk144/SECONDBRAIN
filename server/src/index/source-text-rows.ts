/**
 * Index rows of PDF page text (SPEC F30.1): `source_docs` (one row per PDF: content hash and the
 * normalized path for `folder:`), `source_pages` (original page text for snippets) and
 * `sources_fts` (normalized page text; rowid = `source_pages.id`). PDFs are not notes: they have
 * no `notes` row. The index never extracts; the sources plugin pushes the text in.
 */
import type Database from 'better-sqlite3';
import { CLASS_RULES, classifyPath } from '../markdown/content-classes.js';
import { normalizeForIndex } from '../markdown/normalize-text.js';
import type { VaultPath } from '../vault/vault-types.js';

/** Only PDFs of searchable classes keep rows (attachments are not searchable, §4.2). */
export function keepsSourceText(path: VaultPath): boolean {
  return /\.pdf$/i.test(path) && CLASS_RULES[classifyPath(path)].searchable;
}

export type SourceTextRows = ReturnType<typeof createSourceTextRows>;

export function createSourceTextRows(db: Database.Database) {
  const s = {
    hash: db.prepare('SELECT content_hash FROM source_docs WHERE path = ?').pluck(),
    upsertDoc: db.prepare(
      `INSERT INTO source_docs(path, path_norm, content_hash) VALUES (?, ?, ?)
       ON CONFLICT(path) DO UPDATE SET path_norm = excluded.path_norm,
         content_hash = excluded.content_hash`,
    ),
    insertPage: db.prepare('INSERT INTO source_pages(path, page, text) VALUES (?, ?, ?)'),
    insertFts: db.prepare(
      'INSERT INTO sources_fts(rowid, path, page, body_norm) VALUES (?, ?, ?, ?)',
    ),
    deleteFts: db.prepare(
      'DELETE FROM sources_fts WHERE rowid IN (SELECT id FROM source_pages WHERE path = ?)',
    ),
    deletePages: db.prepare('DELETE FROM source_pages WHERE path = ?'),
    deleteDoc: db.prepare('DELETE FROM source_docs WHERE path = ?'),
    moveDoc: db.prepare('UPDATE source_docs SET path = ?, path_norm = ? WHERE path = ?'),
    moveFts: db.prepare(
      'UPDATE sources_fts SET path = ? WHERE rowid IN (SELECT id FROM source_pages WHERE path = ?)',
    ),
    movePages: db.prepare('UPDATE source_pages SET path = ? WHERE path = ?'),
  };

  function remove(path: VaultPath): void {
    s.deleteFts.run(path);
    s.deletePages.run(path);
    s.deleteDoc.run(path);
  }

  return {
    hashOf(path: VaultPath): string | null {
      return (s.hash.get(path) as string | undefined) ?? null;
    },

    /** Replaces the text of `path` (pages[i] = page i + 1); empty text is not indexed. */
    write(path: VaultPath, contentHash: string, pages: readonly string[]): void {
      remove(path);
      if (!keepsSourceText(path)) return;
      s.upsertDoc.run(path, normalizeForIndex(path), contentHash);
      pages.forEach((text, i) => {
        if (text.trim() === '') return;
        const id = Number(s.insertPage.run(path, i + 1, text).lastInsertRowid);
        s.insertFts.run(id, path, i + 1, normalizeForIndex(text));
      });
    },

    remove,

    /** A renamed PDF keeps its text when it stays searchable, else its rows go. */
    move(from: VaultPath, to: VaultPath): void {
      if (s.hash.get(from) === undefined) return;
      if (!keepsSourceText(to)) {
        remove(from);
        return;
      }
      remove(to);
      s.moveFts.run(to, from);
      s.movePages.run(to, from);
      s.moveDoc.run(to, normalizeForIndex(to), from);
    },
  };
}

/**
 * Applies a push from the sources plugin on the live database: text for a file the index holds
 * (a push may arrive after the file was deleted), unchanged hash = nothing to do, null = remove.
 */
export function applySourceText(
  db: Database.Database,
  rows: SourceTextRows,
  fileKnown: (path: VaultPath) => boolean,
  push: { path: VaultPath; contentHash: string; pages: readonly string[] | null },
): void {
  const { path, contentHash, pages } = push;
  if (pages === null || !fileKnown(path) || !keepsSourceText(path)) {
    if (rows.hashOf(path) !== null) db.transaction(() => rows.remove(path))();
    return;
  }
  if (rows.hashOf(path) === contentHash) return;
  db.transaction(() => rows.write(path, contentHash, pages))();
}
