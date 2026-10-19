/**
 * Aligns the raw Markdown of an mdast `text` node with its decoded value, so a wikilink found in
 * the raw text (server semantics) can be cut out of the value at the right place. Handles
 * backslash escapes, character references, and line breaks inside paragraphs (trailing spaces,
 * indentation and `>` markers that micromark strips). Anything else fails, and the caller then
 * keeps the whole block verbatim.
 */
import { decodeNamedReference } from './character-references';

export interface TextAlignment {
  /** Value offset for every raw offset `0…raw.length`. */
  valueAt: Int32Array;
  /** Whether a raw offset lies between two raw tokens (not inside an escape or reference). */
  boundary: Uint8Array;
}

const ASCII_PUNCTUATION = /[!-/:-@[-`{-~]/;
const REFERENCE = /&(?:#[xX]([0-9a-fA-F]{1,6})|#([0-9]{1,7})|([A-Za-z][A-Za-z0-9]{0,31}));/y;

export function alignRawToValue(raw: string, value: string): TextAlignment | null {
  const valueAt = new Int32Array(raw.length + 1);
  const boundary = new Uint8Array(raw.length + 1);
  let i = 0;
  let j = 0;
  const token = (rawLength: number, valueLength: number): void => {
    boundary[i] = 1;
    for (let k = 0; k < rawLength; k += 1) valueAt[i + k] = j;
    i += rawLength;
    j += valueLength;
  };
  while (i < raw.length) {
    const char = raw[i] as string;
    if (char === '\\' && i + 1 < raw.length && ASCII_PUNCTUATION.test(raw[i + 1] as string)) {
      if (value[j] !== raw[i + 1]) return null;
      token(2, 1);
      continue;
    }
    if (char === '&') {
      const decoded = decodeReferenceAt(raw, i);
      if (decoded && value.startsWith(decoded.value, j)) {
        token(decoded.length, decoded.value.length);
        continue;
      }
    }
    if (char === '\n') {
      if (value[j] !== '\n') return null;
      token(1, 1);
      // The next line's container markers and indentation are not part of the value.
      while (i < raw.length && /[ \t>]/.test(raw[i] as string)) token(1, 0);
      continue;
    }
    if (value[j] === char) {
      token(1, 1);
      continue;
    }
    // Spaces before a line break or at the end of the node are dropped by the parser.
    if (char === ' ' || char === '\t') {
      token(1, 0);
      continue;
    }
    return null;
  }
  boundary[i] = 1;
  valueAt[i] = j;
  return j === value.length ? { valueAt, boundary } : null;
}

function decodeReferenceAt(raw: string, at: number): { value: string; length: number } | null {
  REFERENCE.lastIndex = at;
  const match = REFERENCE.exec(raw);
  if (!match) return null;
  const [whole, hex, decimal, name] = match;
  if (hex !== undefined)
    return { value: decodeNumeric(Number.parseInt(hex, 16)), length: whole.length };
  if (decimal !== undefined) {
    return { value: decodeNumeric(Number.parseInt(decimal, 10)), length: whole.length };
  }
  const value = decodeNamedReference(name as string);
  return value === null ? null : { value, length: whole.length };
}

/** micromark's rules for numeric references: invalid code points become U+FFFD. */
function decodeNumeric(code: number): string {
  if (
    code < 9 ||
    code === 11 ||
    (code > 13 && code < 32) ||
    (code > 126 && code < 160) ||
    (code > 55_295 && code < 57_344) ||
    (code > 64_975 && code < 65_008) ||
    (code & 65_535) === 65_535 ||
    (code & 65_535) === 65_534 ||
    code > 1_114_111
  ) {
    return '\uFFFD';
  }
  return String.fromCodePoint(code);
}
