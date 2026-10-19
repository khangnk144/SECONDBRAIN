/**
 * Cached Unicode character classes for the hot loops of the parser (word count, tag scan).
 * Unicode-property regexes are correct but cost a third of the parse time when run over every
 * character of a 50 MB vault; a per-code-unit cache of the same tests is an order faster.
 */

const WORD = /^[\p{L}\p{N}\p{M}]$/u;
const LETTER = /^\p{L}$/u;
const WHITESPACE = /^\s$/u;

// Per BMP code unit: bit 1 = classified, 2 = letter/number/mark, 4 = letter, 8 = whitespace.
const classes = new Uint8Array(65536);

function classify(code: number): number {
  let bits = classes[code] as number;
  if (bits === 0) {
    const ch = String.fromCharCode(code);
    bits = 1 | (WORD.test(ch) ? 2 : 0) | (LETTER.test(ch) ? 4 : 0) | (WHITESPACE.test(ch) ? 8 : 0);
    classes[code] = bits;
  }
  return bits;
}

/** Letter, number or combining mark at `i` (astral characters tested directly). */
export function isWordCharAt(text: string, i: number): boolean {
  const code = text.charCodeAt(i);
  if (code >= 0xd800 && code <= 0xdbff)
    return WORD.test(String.fromCodePoint(text.codePointAt(i) ?? code));
  return (classify(code) & 2) !== 0;
}

export function isLetterAt(text: string, i: number): boolean {
  const code = text.charCodeAt(i);
  if (code >= 0xd800 && code <= 0xdbff)
    return LETTER.test(String.fromCodePoint(text.codePointAt(i) ?? code));
  return (classify(code) & 4) !== 0;
}

/** Same set as the regex `\s` (BMP only, which is where all of it lives). */
export function isWhitespaceCode(code: number): boolean {
  return (classify(code) & 8) !== 0;
}

/** UTF-16 length of the character at `i` (2 for a surrogate pair). */
export function charLengthAt(text: string, i: number): number {
  const code = text.charCodeAt(i);
  if (code >= 0xd800 && code <= 0xdbff) {
    const next = text.charCodeAt(i + 1);
    if (next >= 0xdc00 && next <= 0xdfff) return 2;
  }
  return 1;
}

/**
 * Unicode words: runs of letters, numbers and marks; an apostrophe (`'` or `’`) between word
 * characters joins them (`don't` is one word).
 */
export function countWords(text: string): number {
  let count = 0;
  let inWord = false;
  for (let i = 0; i < text.length; i += charLengthAt(text, i)) {
    if (isWordCharAt(text, i)) {
      if (!inWord) count += 1;
      inWord = true;
      continue;
    }
    const code = text.charCodeAt(i);
    const joins =
      (code === 39 || code === 0x2019) && i + 1 < text.length && isWordCharAt(text, i + 1);
    if (!(inWord && joins)) inWord = false;
  }
  return count;
}
