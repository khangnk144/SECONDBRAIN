/**
 * BM25 over the chunks of the candidate notes (SPEC F33 "Top 12 chunks"): the index finds the
 * notes (OR semantics), this ranks the passages inside them. Terms are folded like search
 * (`normalizeForIndex` + no diacritics) and matched as whole words (long terms also as prefixes); the
 * stop words are the index's own list so both steps ignore the same words.
 */
import { foldForMatch, normalizeForIndex } from '../../markdown/normalize-text.js';
import { isStopWord } from '../../index/stop-words.js';

const K1 = 1.2;
const B = 0.75;
const MAX_TERMS = 32;
const WORD = /[\p{L}\p{N}]+/gu;

/** Folded query terms without stop words, duplicates removed, input order kept. */
export function queryTerms(text: string): string[] {
  const out: string[] = [];
  for (const word of normalizeForIndex(text).match(WORD) ?? []) {
    if (isStopWord(word)) continue;
    const folded = foldForMatch(word);
    if (folded === '' || out.includes(folded)) continue;
    out.push(folded);
    if (out.length === MAX_TERMS) break;
  }
  return out;
}

export function foldedTokens(text: string): string[] {
  return foldForMatch(text).match(WORD) ?? [];
}

/**
 * Question words are whole words, so short terms match whole words only: folded Vietnamese
 * syllables are short and a prefix would join unrelated words ("hoa" of "hóa" → "hoạch",
 * "hoán"). Terms of 5+ letters also match as prefixes ("matrix" → "matrixes", "learn" → "learning").
 */
const matches = (token: string, term: string) =>
  term.length < 5 ? token === term : token.startsWith(term);

export interface Scored<T> {
  item: T;
  score: number;
}

/** Items with a positive BM25 score for `terms`, best first (ties keep the input order). */
export function rankBm25<T>(items: readonly T[], textOf: (item: T) => string, terms: string[]) {
  if (terms.length === 0 || items.length === 0) return [] as Scored<T>[];
  const docs = items.map((item) => foldedTokens(textOf(item)));
  const avgLength = docs.reduce((sum, tokens) => sum + tokens.length, 0) / docs.length || 1;
  const tf = docs.map((tokens) =>
    terms.map((term) => tokens.reduce((n, token) => (matches(token, term) ? n + 1 : n), 0)),
  );
  const idf = terms.map((_term, t) => {
    const df = tf.reduce((n, counts) => (counts[t]! > 0 ? n + 1 : n), 0);
    return Math.log(1 + (docs.length - df + 0.5) / (df + 0.5));
  });
  const scored: (Scored<T> & { order: number })[] = [];
  docs.forEach((tokens, d) => {
    let score = 0;
    terms.forEach((_term, t) => {
      const f = tf[d]![t]!;
      if (f === 0) return;
      score += (idf[t]! * f * (K1 + 1)) / (f + K1 * (1 - B + (B * tokens.length) / avgLength));
    });
    if (score > 0) scored.push({ item: items[d]!, score, order: d });
  });
  scored.sort((a, b) => b.score - a.score || a.order - b.order);
  return scored.map(({ item, score }) => ({ item, score }));
}
