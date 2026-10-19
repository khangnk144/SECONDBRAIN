/**
 * Link reference definitions (`[label]: destination "title"`) and GFM footnote labels for the
 * fast scanner, with the reference parser's rules. Definitions only exist at the start of a
 * paragraph; they produce no text and no link, but decide which `[x]`, `[x][y]`, `[x][]` and
 * `[^n]` in the document become references (which in turn affects bracket matching).
 */
import { destinationAt, skipTitle, skipWhitespace } from './fast-link-destination.js';

const MAX_LABEL = 999;

/** Label identity of the reference parser: whitespace runs collapsed, trimmed, case-folded. */
export function normalizeLabel(label: string): string {
  return label
    .replace(/[\t\n\r ]+/g, ' ')
    .replace(/^ | $/g, '')
    .toLowerCase()
    .toUpperCase();
}

/**
 * End (after `]`) of a link label whose `[` is at `at`, or -1: at most 999 characters, no
 * unescaped `[`, at least one character other than space/tab; line endings are allowed.
 */
export function labelEnd(text: string, at: number): number {
  let size = 0;
  let seen = false;
  for (let i = at + 1; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code === 10 || code === 13) continue;
    if (size > MAX_LABEL || code === 91) return -1;
    if (code === 93) return seen ? i + 1 : -1;
    size += 1;
    if (code !== 32 && code !== 9) seen = true;
    const next = text.charCodeAt(i + 1);
    if (code === 92 && (next === 91 || next === 92 || next === 93)) {
      i += 1;
      size += 1;
    }
  }
  return -1;
}

/**
 * End (after `]`) of a GFM footnote label `[^…]` at `at`, or -1: no whitespace, no `[`, not
 * empty, at most 999 characters, `\[ \\ \]` escapes allowed.
 */
export function footnoteLabelEnd(text: string, at: number): number {
  if (text.charCodeAt(at) !== 91 || text.charCodeAt(at + 1) !== 94) return -1;
  let size = 0;
  for (let i = at + 2; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (
      size > MAX_LABEL ||
      code === 91 ||
      code === 32 ||
      code === 9 ||
      code === 10 ||
      code === 13
    ) {
      return -1;
    }
    if (code === 93) return size > 0 ? i + 1 : -1;
    size += 1;
    const next = text.charCodeAt(i + 1);
    if (code === 92 && (next === 91 || next === 92 || next === 93)) {
      i += 1;
      size += 1;
    }
  }
  return -1;
}

export interface LeadingDefinitions {
  /** Normalized labels, in order. */
  labels: string[];
  /** Characters of the text taken by the definitions (always whole lines). */
  consumed: number;
}

/** Definitions at the start of a paragraph's text (lines joined by `\n`). */
export function leadingDefinitions(text: string): LeadingDefinitions {
  const labels: string[] = [];
  let consumed = 0;
  while (consumed < text.length) {
    let at = consumed;
    while (text.charCodeAt(at) === 32 || text.charCodeAt(at) === 9) at += 1;
    const definition = definitionAt(text, at);
    if (!definition) break;
    labels.push(definition.label);
    consumed = definition.end;
  }
  return { labels, consumed };
}

function definitionAt(text: string, at: number): { label: string; end: number } | null {
  if (text.charCodeAt(at) !== 91) return null;
  const close = labelEnd(text, at);
  if (close < 0 || text.charCodeAt(close) !== 58) return null;
  const label = normalizeLabel(text.slice(at + 1, close - 1));
  if (label === '') return null;
  const destination = destinationAt(text, skipWhitespace(text, close + 1), Infinity);
  if (!destination) return null;
  const titleStart = skipWhitespace(text, destination.end);
  if (titleStart > destination.end) {
    const titleEnd = skipTitle(text, titleStart);
    const end = titleEnd < 0 ? -1 : lineEndAfterSpaces(text, titleEnd);
    if (end >= 0) return { label, end };
  }
  const end = lineEndAfterSpaces(text, destination.end);
  return end < 0 ? null : { label, end };
}

/** Index after the line ending (or the text end) when only spaces/tabs follow `from`. */
function lineEndAfterSpaces(text: string, from: number): number {
  let i = from;
  while (text.charCodeAt(i) === 32 || text.charCodeAt(i) === 9) i += 1;
  if (i === text.length) return i;
  return text.charCodeAt(i) === 10 ? i + 1 : -1;
}
