/**
 * Text normalization shared by the index, search, autocomplete, tags and link resolution
 * (SPEC §4.14). One function per purpose so no caller invents its own folding rule.
 */

const COMBINING_MARK = /\p{M}/gu;

/**
 * Comparison key used for the FTS columns, title search, autocomplete and tags (not for link
 * identity, see `linkIdentityKey`):
 * NFC → lowercase → `đ`→`d`. `Đ` lowercases to `đ` first, so both become `d`. The FTS
 * tokenizer (`remove_diacritics 2`) strips the remaining diacritics; `đ` is a separate letter
 * in Unicode, not `d` + mark, which is why it is folded here.
 */
export function normalizeForIndex(s: string): string {
  return s.normalize('NFC').toLowerCase().replaceAll('đ', 'd');
}

/**
 * Identity key of a title or path for link resolution: NFC + lowercase, nothing more. Unlike
 * `normalizeForIndex` it keeps `đ` distinct from `d`: `Đông.md` and `Dông.md` are different
 * files, and a link must never jump between them (search may still fold them together).
 */
export function linkIdentityKey(value: string): string {
  return value.normalize('NFC').toLowerCase();
}

/**
 * Fully diacritic-insensitive form for JS-side matching (snippets, autocomplete):
 * `normalizeForIndex` plus removal of every combining mark.
 */
export function foldForMatch(s: string): string {
  return normalizeForIndex(s).normalize('NFD').replace(COMBINING_MARK, '').normalize('NFC');
}

export interface FoldedText {
  /** The folded string (equal to `foldForMatch(s)` for Latin, Vietnamese and most scripts). */
  folded: string;
  /**
   * `map[i]` is the UTF-16 index in the original string of the character that produced
   * `folded[i]`; `map[folded.length]` is `s.length`, so `[map[a], map[b])` is the original span
   * of the folded span `[a, b)`.
   */
  map: number[];
}

/**
 * Folds `s` like `foldForMatch` while remembering where every folded character came from, so a
 * match found in folded text can be highlighted in the original (diacritics intact).
 *
 * Works per cluster (a base code point plus the combining marks after it): folding never moves
 * characters across clusters for Latin/Vietnamese text. Context-dependent cases (Greek final
 * sigma, decomposed Hangul jamo) may differ slightly from `foldForMatch`; they only affect
 * highlighting, never identity.
 */
export function foldWithMap(s: string): FoldedText {
  let folded = '';
  const map: number[] = [];
  let i = 0;
  while (i < s.length) {
    const start = i;
    i += codePointLength(s, i);
    while (i < s.length && isCombiningMarkAt(s, i)) i += codePointLength(s, i);
    const piece = foldForMatch(s.slice(start, i));
    for (let k = 0; k < piece.length; k += 1) map.push(start);
    folded += piece;
  }
  map.push(s.length);
  return { folded, map };
}

function codePointLength(s: string, i: number): number {
  const code = s.charCodeAt(i);
  if (code >= 0xd800 && code <= 0xdbff && i + 1 < s.length) {
    const next = s.charCodeAt(i + 1);
    if (next >= 0xdc00 && next <= 0xdfff) return 2;
  }
  return 1;
}

const SINGLE_MARK = /^\p{M}$/u;

function isCombiningMarkAt(s: string, i: number): boolean {
  const code = s.charCodeAt(i);
  // Fast path: the combining diacritical marks block covers Vietnamese NFD text.
  if (code >= 0x300 && code <= 0x36f) return true;
  if (code < 0x300) return false;
  return SINGLE_MARK.test(s.slice(i, i + codePointLength(s, i)));
}
