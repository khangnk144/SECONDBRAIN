/**
 * Wikilink syntax (SPEC §4.4): `[[Target]]`, `[[Target|alias]]`, `[[Target#Heading]]`,
 * `[[Target#Heading|alias]]`, embeds `![[…]]`. Found by scanning raw text (not Markdown text
 * nodes, where `[[x]]` may be split or turned into a reference). Inside tables the alias
 * separator is written `\|`; it is accepted everywhere because `|` cannot be in a file name.
 */

export interface WikilinkParts {
  target: string;
  heading: string | null;
  alias: string | null;
  /** Span of the (trimmed) target inside the inner text between `[[` and `]]`. */
  targetStart: number;
  targetEnd: number;
}

export interface WikilinkHit extends WikilinkParts {
  kind: 'wikilink' | 'embed';
  /** Offsets in the scanned text; `start` includes the `!` of an embed. */
  start: number;
  end: number;
}

const OPEN = 91; // [
const CLOSE = 93; // ]

/** Splits the text between `[[` and `]]`; null when it names nothing (`[[]]`, `[[|x]]`). */
export function parseWikilinkInner(inner: string): WikilinkParts | null {
  let targetPart = inner;
  let alias: string | null = null;
  const pipe = inner.indexOf('|');
  if (pipe !== -1) {
    targetPart = inner.slice(0, pipe);
    if (targetPart.endsWith('\\')) targetPart = targetPart.slice(0, -1);
    alias = inner.slice(pipe + 1).trim() || null;
  }
  const hash = targetPart.indexOf('#');
  const heading = hash === -1 ? null : targetPart.slice(hash + 1).trim() || null;
  const rawTarget = hash === -1 ? targetPart : targetPart.slice(0, hash);
  const target = rawTarget.trim();
  if (target === '' && heading === null) return null;
  const targetStart = target === '' ? 0 : rawTarget.indexOf(target);
  return { target, heading, alias, targetStart, targetEnd: targetStart + target.length };
}

/**
 * Calls `onHit` for every wikilink lying entirely inside `[from, to)` of `text`. A link never
 * spans lines; `\[[` is not a link; for `[[[x]]]` the innermost `[[` opens.
 */
export function scanWikilinks(
  text: string,
  from: number,
  to: number,
  onHit: (hit: WikilinkHit) => void,
  honorEscapes = true,
): void {
  let open = text.indexOf('[[', from);
  while (open !== -1 && open + 5 <= to) {
    if (text.charCodeAt(open + 2) === OPEN || (honorEscapes && isEscaped(text, open, from))) {
      open = text.indexOf('[[', open + 1);
      continue;
    }
    const close = findClose(text, open + 2, to);
    if (close < 0) {
      open = text.indexOf('[[', close === -1 ? open + 1 : -close);
      continue;
    }
    const parts = parseWikilinkInner(text.slice(open + 2, close));
    if (parts) {
      const embed = open > from && text.charCodeAt(open - 1) === 33; // !
      const hit = parts as WikilinkHit;
      hit.kind = embed ? 'embed' : 'wikilink';
      hit.start = embed ? open - 1 : open;
      hit.end = close + 2;
      onHit(hit);
    }
    open = text.indexOf('[[', parts ? close + 2 : open + 1);
  }
}

/**
 * Index of the `]]` closing a link whose inner text starts at `start`; -1 when the line ends
 * first; `-k` when another `[[` starts at `k` first (the scan restarts there).
 */
function findClose(text: string, start: number, to: number): number {
  for (let i = start; i + 1 < to; i += 1) {
    const code = text.charCodeAt(i);
    if (code === 10 || code === 13) return -1;
    const next = text.charCodeAt(i + 1);
    if (code === CLOSE && next === CLOSE) return i;
    if (code === OPEN && next === OPEN) return -i;
  }
  return -1;
}

/** An odd number of backslashes right before `index` escapes the bracket. */
function isEscaped(text: string, index: number, from: number): boolean {
  let count = 0;
  for (let i = index - 1; i >= from && text.charCodeAt(i) === 92; i -= 1) count += 1;
  return count % 2 === 1;
}

/**
 * Replaces wikilinks in already-extracted plain text by their alias, target or heading.
 * Backslash escapes were already resolved when the text was extracted, so none apply here.
 */
export function substituteWikilinks(text: string): string {
  if (!text.includes('[[')) return text;
  let out = '';
  let last = 0;
  const replace = (hit: WikilinkHit): void => {
    out += text.slice(last, hit.start) + (hit.alias ?? (hit.target || hit.heading || ''));
    last = hit.end;
  };
  scanWikilinks(text, 0, text.length, replace, false);
  return out + text.slice(last);
}
