/**
 * Emphasis/strikethrough markers (`*`, `_`, `~`) only matter for the readable text of a note
 * (search and snippets), never for links, tags or tasks. Instead of the full delimiter
 * matching algorithm, a run is dropped when CommonMark's flanking rules say it could open or
 * close emphasis (GFM strikethrough: runs of one or two `~`). Unmatched markers may therefore
 * disappear where the full parser keeps them; search tokens are unaffected either way.
 */

const WHITESPACE = /\s/u;
const PUNCTUATION = /[\p{P}\p{S}]/u;

export function isEmphasisMarker(src: string, at: number, run: number, code: number): boolean {
  if (code === 126 && run > 2) return false;
  const before = at > 0 ? charBefore(src, at) : ' ';
  const after = at + run < src.length ? String.fromCodePoint(src.codePointAt(at + run) ?? 32) : ' ';
  const beforeSpace = WHITESPACE.test(before);
  const afterSpace = WHITESPACE.test(after);
  const beforePunct = PUNCTUATION.test(before);
  const afterPunct = PUNCTUATION.test(after);
  const left = !afterSpace && (!afterPunct || beforeSpace || beforePunct);
  const right = !beforeSpace && (!beforePunct || afterSpace || afterPunct);
  if (code !== 95) return left || right;
  // `_` inside a word (`snake_case`) is never emphasis.
  return (left && (!right || beforePunct)) || (right && (!left || afterPunct));
}

function charBefore(src: string, at: number): string {
  const code = src.charCodeAt(at - 1);
  if (code >= 0xdc00 && code <= 0xdfff && at >= 2) return src.slice(at - 2, at);
  return src[at - 1] as string;
}
