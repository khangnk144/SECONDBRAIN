/**
 * Turns free text into an FTS5 MATCH expression that can never be a syntax error: every term is
 * a quoted prefix phrase built only from letters, digits and combining marks, so user input such
 * as `"`, `*`, `-`, `(`, `:` or `NEAR` is either dropped or searched as plain text.
 */
import { foldForMatch, normalizeForIndex } from '../markdown/normalize-text.js';

/** More terms than this only slow the query down without narrowing results in practice. */
const MAX_TERMS = 16;
const WORD = /[\p{L}\p{N}\p{M}]+/gu;
const HAS_BASE_CHAR = /[\p{L}\p{N}]/u;

/**
 * Normalized search terms (SPEC §4.14 normalization, duplicates removed, input order kept).
 * A term made only of combining marks would become an empty prefix phrase in FTS5, which makes
 * the whole AND match nothing, so such terms are dropped.
 */
export function searchTerms(text: string): string[] {
  const out: string[] = [];
  for (const word of normalizeForIndex(text).match(WORD) ?? []) {
    if (!HAS_BASE_CHAR.test(word) || out.includes(word)) continue;
    out.push(word);
    if (out.length === MAX_TERMS) break;
  }
  return out;
}

/** Terms folded for JS-side matching (snippets, highlights): no diacritics at all. */
export function foldedTerms(terms: readonly string[]): string[] {
  const out: string[] = [];
  for (const term of terms) {
    const folded = foldForMatch(term);
    if (folded && !out.includes(folded)) out.push(folded);
  }
  // Longest first so a highlight covers `giai` rather than stopping at the `gia` of another term.
  return out.sort((a, b) => b.length - a.length);
}

/**
 * `"giai"* AND "tich"*`, optionally restricted to one column. Terms come from `searchTerms`, so
 * they contain no quote characters; quoting still guards against FTS keywords such as `NEAR`.
 */
export function ftsMatchExpression(terms: readonly string[], column?: 'title_norm'): string | null {
  if (terms.length === 0) return null;
  const body = terms.map((term) => `"${term.replaceAll('"', '""')}"*`).join(' AND ');
  return column ? `${column} : (${body})` : body;
}
