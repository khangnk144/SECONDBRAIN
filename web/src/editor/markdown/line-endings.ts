/**
 * Line endings. The parser works on `\n`-only text; every slice kept for writing back is cut from
 * the original text through `toOriginal`, so CRLF, LF and lone CR bytes survive untouched.
 */

export type Eol = '\n' | '\r\n';

/** The first line ending of the text decides; LF when there is none (a lone CR counts as LF). */
export function detectEol(text: string): Eol {
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code === 10) return '\n';
    if (code === 13) return text.charCodeAt(i + 1) === 10 ? '\r\n' : '\n';
  }
  return '\n';
}

export interface NormalizedText {
  /** The text with CRLF and lone CR turned into LF. */
  text: string;
  /** Maps an offset in `text` to the offset of the same position in the original. */
  toOriginal(offset: number): number;
}

export function normalizeLineEndings(original: string): NormalizedText {
  if (!original.includes('\r')) return { text: original, toOriginal: (offset) => offset };
  // Normalized offsets of the LFs whose CR was dropped (CRLF pairs); lone CRs map 1:1.
  const crlf: number[] = [];
  let text = '';
  let last = 0;
  for (let i = original.indexOf('\r'); i !== -1; i = original.indexOf('\r', i + 1)) {
    text += original.slice(last, i);
    if (original.charCodeAt(i + 1) === 10) {
      crlf.push(text.length);
      last = i + 1;
    } else {
      text += '\n';
      last = i + 1;
    }
  }
  text += original.slice(last);
  return { text, toOriginal: (offset) => offset + countBelow(crlf, offset) };
}

/** Number of sorted values strictly below `limit`. */
function countBelow(sorted: readonly number[], limit: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((sorted[mid] as number) < limit) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** `\n`-only text written with the file's line ending. */
export function withEol(lfText: string, eol: Eol): string {
  return eol === '\n' ? lfText : lfText.replace(/\n/g, eol);
}
