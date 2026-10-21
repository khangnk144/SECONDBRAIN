/**
 * BM25 candidates for AI retrieval (SPEC F33 "BM25 always"). Unlike palette search (every term
 * must match), a question's terms are OR-combined: "tóm tắt những gì mình học về đạo hàm" must
 * find a note that only says "đạo hàm". Stop words are dropped first; bm25 ranks by how many and
 * how rare the matched terms are. Note titles weigh 10× the body. PDF pages (one hit per PDF,
 * its best page) join on the same bm25 scale (two FTS tables: comparable, not identical).
 */
import type Database from 'better-sqlite3';
import { noteTitleFromPath, classifyPath } from '../markdown/content-classes.js';
import type { ContentClass } from '../markdown/markdown-types.js';
import type { VaultPath } from '../vault/vault-types.js';
import { ftsAnyTermExpression, searchTerms } from './fts-query.js';
import type { RetrievalHit, RetrievalQuery } from './index-types.js';
import { bestSourcePages } from './source-text-search.js';
import { isStopWord } from './stop-words.js';

export const MAX_RETRIEVAL_LIMIT = 200;
/** Questions are longer than palette queries; more terms only cost a little time. */
const MAX_RETRIEVAL_TERMS = 32;

/** Normalized, de-duplicated question terms without stop words. */
export function retrievalTerms(text: string): string[] {
  return searchTerms(text, { max: MAX_RETRIEVAL_TERMS, skip: isStopWord });
}

interface NoteRow {
  path: VaultPath;
  title: string;
  class: ContentClass;
  rank: number;
}

const byScore = (a: RetrievalHit, b: RetrievalHit) =>
  b.score - a.score || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

export function runRetrieval(db: Database.Database, query: RetrievalQuery): RetrievalHit[] {
  const limit = Math.min(Math.max(Math.trunc(query.limit) || 1, 1), MAX_RETRIEVAL_LIMIT);
  const match = ftsAnyTermExpression(retrievalTerms(query.text ?? ''));
  if (match === null) return [];
  // notes_fts only holds searchable classes (user, archived, wiki, source, control).
  const notes = db
    .prepare(
      `SELECT n.path AS path, n.title AS title, n.class AS class,
         bm25(notes_fts, 0.0, 10.0, 1.0) AS rank
       FROM notes_fts JOIN notes n ON n.id = notes_fts.rowid
       WHERE notes_fts MATCH ? ORDER BY rank, n.path LIMIT ?`,
    )
    .all(match, limit) as NoteRow[];
  const hits: RetrievalHit[] = notes.map((row) => ({
    path: row.path,
    title: row.title,
    class: row.class,
    page: null,
    score: -row.rank,
  }));
  if (query.includePdf) {
    for (const hit of bestSourcePages(db, { match, limit })) {
      hits.push({
        path: hit.path,
        title: noteTitleFromPath(hit.path),
        class: classifyPath(hit.path),
        page: hit.page,
        score: -hit.rank,
      });
    }
  }
  return hits.sort(byScore).slice(0, limit);
}
