/**
 * Narrow reads for the M3 views: the rows the graph is built from (F16) and the notes of the
 * `Daily` folder (prev/next navigation, F13.3). Prepared once per connection.
 */
import type Database from 'better-sqlite3';
import type { ContentClass } from '../markdown/markdown-types.js';
import type { VaultPath } from '../vault/vault-types.js';

export interface GraphRows {
  notes: { path: VaultPath; title: string; class: ContentClass }[];
  /** Every non-note file (attachments, PDFs and other raw sources). */
  files: VaultPath[];
  /** Resolved links only (no ghost, no ambiguous), one row per linking note and target. */
  links: { from: VaultPath; to: VaultPath }[];
}

export function createViewRowQueries(db: Database.Database) {
  const s = {
    notes: db.prepare('SELECT path, title, class FROM notes'),
    files: db.prepare('SELECT path FROM files').pluck(),
    links: db.prepare(
      `SELECT DISTINCT n.path AS "from", l.to_path AS "to"
       FROM links l JOIN notes n ON n.id = l.from_id
       WHERE l.to_path IS NOT NULL AND l.ambiguous = 0`,
    ),
    daily: db.prepare(`SELECT path FROM notes WHERE lower(folder) = 'daily'`).pluck(),
  };
  return {
    graphRows(): GraphRows {
      return {
        notes: s.notes.all() as GraphRows['notes'],
        files: s.files.all() as VaultPath[],
        links: s.links.all() as GraphRows['links'],
      };
    },
    dailyNotePaths(): VaultPath[] {
      return s.daily.all() as VaultPath[];
    },
  };
}
