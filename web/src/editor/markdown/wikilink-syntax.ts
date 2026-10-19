/**
 * Wikilink syntax, kept identical to the server (server/src/markdown/wikilink-scan.ts):
 * `[[Target]]`, `[[Target|alias]]`, `[[Target#Heading]]`, `[[Target#Heading|alias]]`, embeds
 * `![[…]]`. Links are found in raw text, never span lines, `\[[` is not a link, and for `[[[x]]]`
 * the innermost `[[` opens. In tables the alias separator is written `\|`.
 */
import type { WikilinkAttributes } from '../schema/wikilink-node';

export interface WikilinkHit extends WikilinkAttributes {
  /** Offsets in the scanned text; `start` includes the `!` of an embed. */
  start: number;
  end: number;
}

const OPEN = 91; // [
const CLOSE = 93; // ]

/** Splits the text between `[[` and `]]`; null when it names nothing (`[[]]`, `[[|x]]`). */
export function parseWikilinkInner(
  inner: string,
): Pick<WikilinkAttributes, 'target' | 'heading' | 'alias'> | null {
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
  const target = (hash === -1 ? targetPart : targetPart.slice(0, hash)).trim();
  if (target === '' && heading === null) return null;
  return { target, heading, alias };
}

/** Every wikilink lying entirely inside `[from, to)` of `text`, in order. */
export function scanWikilinks(text: string, from: number, to: number): WikilinkHit[] {
  const hits: WikilinkHit[] = [];
  let open = text.indexOf('[[', from);
  while (open !== -1 && open + 5 <= to) {
    if (text.charCodeAt(open + 2) === OPEN || isEscaped(text, open, from)) {
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
      hits.push({ ...parts, embed, start: embed ? open - 1 : open, end: close + 2 });
    }
    open = text.indexOf('[[', parts ? close + 2 : open + 1);
  }
  return hits;
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

/** The raw Markdown of a wikilink node; inside a table cell the alias pipe is escaped. */
export function formatWikilink(attrs: WikilinkAttributes, inTable: boolean): string {
  let inner = attrs.target;
  if (attrs.heading !== null) inner += `#${attrs.heading}`;
  if (attrs.alias !== null) inner += `${inTable ? '\\|' : '|'}${attrs.alias}`;
  return `${attrs.embed ? '!' : ''}[[${inner}]]`;
}
