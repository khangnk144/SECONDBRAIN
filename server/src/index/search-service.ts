/**
 * Palette search: filter tokens + diacritic-insensitive prefix full-text search. Notes whose
 * TITLE contains every term rank first, then body matches by bm25; snippets come from the
 * original text. An empty query lists the most recently modified searchable notes.
 */
import type Database from 'better-sqlite3';
import { foldForMatch, normalizeForIndex } from '../markdown/normalize-text.js';
import type { ContentClass } from '../markdown/markdown-types.js';
import type { VaultPath } from '../vault/vault-types.js';
import { foldedTerms, ftsMatchExpression, searchTerms } from './fts-query.js';
import { SEARCHABLE_SQL } from './index-reader.js';
import type { SearchQuery, SearchResult } from './index-types.js';
import { hasFilters, parseSearchQuery, type ParsedSearch } from './search-query-parser.js';
import { buildSnippet } from './search-snippet.js';
import { buildTermPattern } from './term-pattern.js';

/** Recents shown for an empty query (the client replaces them with recently opened notes). */
export const RECENT_LIMIT = 8;
/** Title matches always outrank body matches; bm25 magnitudes stay far below this. */
const TITLE_BONUS = 1000;

interface Row {
  id: number;
  path: VaultPath;
  title: string;
  folder: string;
  class: ContentClass;
  rank: number;
}

interface FilterSql {
  where: string[];
  params: unknown[];
}

/**
 * SQL conditions for the filters. `duePaths` = the notes owning an open deadline item in the
 * requested range (computed by the caller from the deadline rules), passed as one JSON array.
 */
function filterSql(parsed: ParsedSearch, duePaths: readonly VaultPath[] | null): FilterSql {
  const where: string[] = [];
  const params: unknown[] = [];
  for (const tag of parsed.tags) {
    // Diacritic-insensitive like tag autocomplete; `tag:môn` also matches `môn/giải-tích`.
    const fold = foldForMatch(tag);
    where.push(
      `EXISTS (SELECT 1 FROM tags t WHERE t.note_id = n.id AND (t.tag_fold = ? OR instr(t.tag_fold, ?) = 1))`,
    );
    params.push(fold, `${fold}/`);
  }
  if (parsed.folder !== null) {
    where.push('instr(n.path_norm, ?) = 1');
    params.push(`${normalizeForIndex(parsed.folder)}/`);
  }
  if (parsed.type !== null) {
    where.push('n.type = ? COLLATE NOCASE');
    params.push(parsed.type);
  }
  if (duePaths !== null) {
    where.push('n.path IN (SELECT value FROM json_each(?))');
    params.push(JSON.stringify(duePaths));
  }
  return { where, params };
}

const and = (where: string[]) => (where.length > 0 ? ` AND ${where.join(' AND ')}` : '');

function ftsRows(db: Database.Database, match: string, filters: FilterSql, limit: number): Row[] {
  const sql = `SELECT n.id AS id, n.path AS path, n.title AS title, n.folder AS folder,
      n.class AS class, bm25(notes_fts, 0.0, 10.0, 1.0) AS rank
    FROM notes_fts JOIN notes n ON n.id = notes_fts.rowid
    WHERE notes_fts MATCH ?${and(filters.where)}
    ORDER BY rank, length(n.title), n.path LIMIT ?`;
  return db.prepare(sql).all(match, ...filters.params, limit) as Row[];
}

function plainRows(db: Database.Database, filters: FilterSql, limit: number): Row[] {
  const sql = `SELECT n.id AS id, n.path AS path, n.title AS title, n.folder AS folder,
      n.class AS class, 0 AS rank
    FROM notes n WHERE n.class IN (${SEARCHABLE_SQL})${and(filters.where)}
    ORDER BY n.mtime DESC, n.path LIMIT ?`;
  return db.prepare(sql).all(...filters.params, limit) as Row[];
}

const clampRank = (rank: number) => Math.min(Math.max(-rank, 0), TITLE_BONUS - 1);

export interface SearchDeps {
  db: Database.Database;
  /** Notes with an open deadline item matching the `due:` filter (archived only on request). */
  duePaths: (due: NonNullable<ParsedSearch['due']>, includeArchive: boolean) => VaultPath[];
}

export function runSearch(deps: SearchDeps, query: SearchQuery): SearchResult[] {
  const { db } = deps;
  const parsed = parseSearchQuery(query);
  const terms = searchTerms(parsed.text);
  const toResult = (row: Row, matchedIn: SearchResult['matchedIn'], score: number) => ({
    path: row.path,
    title: row.title,
    folder: row.folder,
    class: row.class,
    matchedIn,
    snippet: null as SearchResult['snippet'],
    score,
  });
  if (terms.length === 0 && !hasFilters(parsed)) {
    // Text with nothing searchable in it (emoji, punctuation) finds nothing; only a blank box
    // shows the recent notes.
    if (parsed.text.trim() !== '') return [];
    return plainRows(db, { where: [], params: [] }, RECENT_LIMIT).map((r) =>
      toResult(r, 'recent', 0),
    );
  }

  const due = parsed.due ? deps.duePaths(parsed.due, parsed.includeArchive) : null;
  const filters = filterSql(parsed, due);
  if (terms.length === 0)
    return plainRows(db, filters, parsed.limit).map((r) => toResult(r, 'filter', 0));

  const titleMatch = ftsMatchExpression(terms, 'title_norm') as string;
  const anyMatch = ftsMatchExpression(terms) as string;
  const titleRows = ftsRows(db, titleMatch, filters, parsed.limit);
  const ids = titleRows.map((r) => r.id);
  const results = titleRows.map((r) => toResult(r, 'title', TITLE_BONUS + clampRank(r.rank)));
  if (results.length < parsed.limit) {
    const seen = new Set(ids);
    for (const row of ftsRows(db, anyMatch, filters, parsed.limit + titleRows.length)) {
      if (seen.has(row.id)) continue;
      ids.push(row.id);
      results.push(toResult(row, 'body', clampRank(row.rank)));
      if (results.length >= parsed.limit) break;
    }
  }
  const folded = foldedTerms(terms);
  const pattern = buildTermPattern(folded);
  const text = db.prepare('SELECT plain FROM note_text WHERE note_id = ?').pluck();
  results.forEach((result, i) => {
    const plain = (text.get(ids[i]) as string | undefined) ?? '';
    result.snippet = buildSnippet(plain, folded, pattern);
  });
  return results;
}
