/**
 * Search snippets: an excerpt of the ORIGINAL plain text (case and diacritics intact) around the
 * first match, with highlight ranges found by diacritic-insensitive matching of the query terms
 * at word starts (the same prefix semantics as the FTS query).
 */
import { foldWithMap } from '../markdown/normalize-text.js';
import type { SearchSnippet } from './index-types.js';
import { firstMatchIndex } from './term-pattern.js';

export const SNIPPET_LENGTH = 160;
/** How much text before the first match stays visible, so the match is not the first word. */
const LEAD = 40;
/** How far a window edge may move to land on a word boundary. */
const SNAP = 20;
const ELLIPSIS = '…';
const WORD_CHAR = /[\p{L}\p{N}\p{M}]/u;
const SPACE = /\s/u;

/** Word-start matches of folded `terms` in `text` as [start, end) ranges of `text`. */
export function findMatches(text: string, terms: readonly string[]): [number, number][] {
  if (terms.length === 0 || text.length === 0) return [];
  const { folded, map } = foldWithMap(text);
  const found: { at: number; length: number }[] = [];
  for (const term of terms) {
    for (let at = folded.indexOf(term); at !== -1; at = folded.indexOf(term, at + 1)) {
      if (at === 0 || !WORD_CHAR.test(folded.charAt(at - 1)))
        found.push({ at, length: term.length });
    }
  }
  found.sort((a, b) => a.at - b.at || b.length - a.length);
  const out: [number, number][] = [];
  let coveredUntil = 0;
  for (const f of found) {
    if (f.at < coveredUntil) continue;
    out.push([map[f.at] ?? text.length, map[f.at + f.length] ?? text.length]);
    coveredUntil = f.at + f.length;
  }
  return out;
}

/** Moves a window start forward to just after whitespace, when one is near. */
function snapStart(plain: string, index: number): number {
  if (index <= 0) return 0;
  for (let i = index; i < Math.min(plain.length, index + SNAP); i += 1) {
    if (SPACE.test(plain.charAt(i - 1))) return i;
  }
  return index;
}

/** Moves a window end back onto whitespace, when one is near (never before `floor`). */
function snapEnd(plain: string, index: number, floor: number): number {
  if (index >= plain.length) return plain.length;
  for (let i = index; i > Math.max(floor, index - SNAP); i -= 1) {
    if (SPACE.test(plain.charAt(i))) return i;
  }
  return index;
}

/**
 * Snippet around the first match (`pattern` from `buildTermPattern`); without a body match, the
 * start of the text without highlights. Null when the note has no text at all.
 */
export function buildSnippet(
  plain: string,
  foldedTerms: readonly string[],
  pattern: RegExp | null,
): SearchSnippet | null {
  const first = firstMatchIndex(pattern, plain);
  let start = first === -1 ? 0 : snapStart(plain, Math.max(0, first - LEAD));
  if (first !== -1 && start > first) start = first;
  while (start < plain.length && SPACE.test(plain.charAt(start))) start += 1;
  if (start >= plain.length) return null;
  const end = snapEnd(
    plain,
    Math.min(plain.length, start + SNIPPET_LENGTH),
    Math.max(start, first),
  );
  const body = plain.slice(start, end).replace(/\s+/gu, ' ').trimEnd();
  const prefix = start > 0 ? ELLIPSIS : '';
  const text = `${prefix}${body}${end < plain.length ? ELLIPSIS : ''}`;
  const highlights = findMatches(body, foldedTerms).map(([from, to]): [number, number] => [
    from + prefix.length,
    to + prefix.length,
  ]);
  return { text, highlights };
}
