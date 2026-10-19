/**
 * GFM autolink literals (`https://…`, `www.…`) as the reference parser recognises them. In the
 * inline pass a literal is plain text that swallows characters which would otherwise be syntax
 * (`[`, backticks, `*`, `&`…), so the scanner must know exactly where one ends. Email literals
 * never contain such characters and are not needed. Not recognised inside a pending `[` label.
 */

const PUNCTUATION = /^[\p{P}\p{S}]$/u;
const WHITESPACE = /^\s$/u;
const CANDIDATE = /(?:https?:\/\/|www\.)/gi;

function charAt(src: string, i: number): string | null {
  if (i < 0 || i >= src.length) return null;
  return String.fromCodePoint(src.codePointAt(i) ?? 0);
}

const isSpace = (ch: string | null) => ch !== null && WHITESPACE.test(ch);
const isPunct = (ch: string | null) => ch !== null && PUNCTUATION.test(ch);
const isAsciiAlpha = (ch: string | null) => ch !== null && /^[A-Za-z]$/.test(ch);

/**
 * Walks the literal candidates of one leaf in order, alongside the inline scan.
 */
export class AutolinkLiterals {
  private readonly candidates: [number, number][];
  private next = 0;

  constructor(private readonly src: string) {
    this.candidates = autolinkCandidates(src);
  }

  /**
   * End of a literal that starts in the plain text `[from, to)` and runs past `to` (into
   * characters that would otherwise be syntax), or -1.
   */
  crossing(from: number, to: number): number {
    while (this.next < this.candidates.length) {
      const [start, prefix] = this.candidates[this.next] as [number, number];
      if (start >= to) return -1;
      this.next += 1;
      if (start < from) continue;
      const end = autolinkLiteralEnd(this.src, start, prefix);
      if (end < 0) continue;
      while (
        this.next < this.candidates.length &&
        (this.candidates[this.next] as [number, number])[0] < end
      ) {
        this.next += 1;
      }
      if (end > to) return end;
    }
    return -1;
  }

  /** Inside a pending `[` label no literal starts: drop the candidates before `to`. */
  skipTo(to: number): number {
    while (
      this.next < this.candidates.length &&
      (this.candidates[this.next] as [number, number])[0] < to
    ) {
      this.next += 1;
    }
    return -1;
  }
}

/** Start offsets (and prefix lengths) of every `https://`, `http://` and `www.` in `src`. */
function autolinkCandidates(src: string): [number, number][] {
  const found: [number, number][] = [];
  if (!/:\/\/|www\./i.test(src)) return found;
  CANDIDATE.lastIndex = 0;
  for (let match = CANDIDATE.exec(src); match; match = CANDIDATE.exec(src)) {
    found.push([match.index, match[0].length]);
  }
  return found;
}

/** End of the literal starting at `at` (prefix of `prefix` characters), or -1. */
function autolinkLiteralEnd(src: string, at: number, prefix: number): number {
  const before = charAt(src, at - 1);
  if (prefix === 4) {
    const ok = before === null || '(*_[]~ \t\n\r'.includes(before);
    if (!ok || at + prefix >= src.length) return -1;
    const domain = domainEnd(src, at);
    return domain < 0 ? -1 : pathEnd(src, domain);
  }
  if (isAsciiAlpha(before)) return -1;
  const first = charAt(src, at + prefix);
  if (first === null || isSpace(first) || isPunct(first) || first.charCodeAt(0) < 32) return -1;
  const domain = domainEnd(src, at + prefix);
  return domain < 0 ? -1 : pathEnd(src, domain);
}

function domainEnd(src: string, start: number): number {
  let underscoreLast = false;
  let underscoreLastLast = false;
  let seen = false;
  let i = start;
  for (;;) {
    const ch = charAt(src, i);
    if (ch === '.' || ch === '_') {
      if (trailFollows(src, i)) break;
      if (ch === '_') underscoreLast = true;
      else {
        underscoreLastLast = underscoreLast;
        underscoreLast = false;
      }
      i += 1;
      continue;
    }
    if (ch === null || isSpace(ch) || (ch !== '-' && isPunct(ch))) break;
    seen = true;
    i += ch.length;
  }
  return underscoreLast || underscoreLastLast || !seen ? -1 : i;
}

const PATH_PUNCTUATION = '!"&\')*,.:;<?]_~';

function pathEnd(src: string, start: number): number {
  let open = 0;
  let close = 0;
  let i = start;
  for (;;) {
    const ch = charAt(src, i);
    if (ch === null || isSpace(ch)) return i;
    if (ch === '(') open += 1;
    else if (ch === ')' && close < open) close += 1;
    else if (PATH_PUNCTUATION.includes(ch)) {
      if (trailFollows(src, i)) return i;
      if (ch === ')') close += 1;
    }
    i += ch.length;
  }
}

/** Whether the text from `i` is trailing punctuation that ends the literal. */
function trailFollows(src: string, start: number): boolean {
  let i = start;
  for (;;) {
    const ch = charAt(src, i);
    if (ch !== null && '!"\')*,.:;?_~'.includes(ch)) i += 1;
    else if (ch === '&') {
      let j = i + 1;
      while (isAsciiAlpha(charAt(src, j))) j += 1;
      if (j === i + 1 || src[j] !== ';') return false;
      i = j + 1;
    } else if (ch === ']') {
      const next = charAt(src, i + 1);
      if (next === null || next === '(' || next === '[' || isSpace(next)) return true;
      i += 1;
    } else return ch === null || ch === '<' || isSpace(ch);
  }
}
