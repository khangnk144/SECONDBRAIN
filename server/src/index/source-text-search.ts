/**
 * PDF page hits for search and retrieval: the best-matching page of each PDF (bm25 over the page
 * text; ties go to the earlier page), so one PDF is one result and the result names its page.
 */
import type Database from 'better-sqlite3';
import type { VaultPath } from '../vault/vault-types.js';

export interface SourcePageHit {
  path: VaultPath;
  page: number;
  /** `source_pages.id` of the page (snippet text). */
  id: number;
  /** bm25 (lower is better), comparable with the notes' `rank`. */
  rank: number;
}

export interface SourcePageQuery {
  /** FTS5 expression over `body_norm` (from `fts-query.ts`, never raw user text). */
  match: string;
  /** Distinct PDFs wanted. */
  limit: number;
  /** `folder:` filter: normalized folder path with a trailing `/`, or null. */
  folderPrefix?: string | null;
}

export function bestSourcePages(db: Database.Database, query: SourcePageQuery): SourcePageHit[] {
  const folder = query.folderPrefix ?? null;
  const sql = `SELECT sources_fts.path AS path, sources_fts.page AS page, sources_fts.rowid AS id,
      bm25(sources_fts, 0.0, 0.0, 1.0) AS rank
    FROM sources_fts${folder ? ' JOIN source_docs d ON d.path = sources_fts.path' : ''}
    WHERE sources_fts MATCH ?${folder ? ' AND instr(d.path_norm, ?) = 1' : ''}
    ORDER BY rank, sources_fts.path, sources_fts.page`;
  const params: unknown[] = folder ? [query.match, folder] : [query.match];
  const out: SourcePageHit[] = [];
  const seen = new Set<VaultPath>();
  if (query.limit <= 0) return out;
  for (const row of db.prepare(sql).iterate(...params) as Iterable<SourcePageHit>) {
    if (seen.has(row.path)) continue;
    seen.add(row.path);
    out.push(row);
    if (out.length >= query.limit) break;
  }
  return out;
}

/** Original text of one indexed page (snippets). */
export function sourcePageText(db: Database.Database, id: number): string {
  const row = db.prepare('SELECT text FROM source_pages WHERE id = ?').pluck().get(id);
  return typeof row === 'string' ? row : '';
}
