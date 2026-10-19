/**
 * The `(destination "title")` part of an inline link or image, per CommonMark: optional
 * whitespace (at most one line ending), a `<…>` or raw destination (balanced parentheses, at
 * most 32 deep, no spaces or controls), an optional title separated by whitespace, then `)`.
 */
import { decodeEscapesAndReferences, isAsciiPunctuation } from './character-references.js';

const MAX_PAREN_DEPTH = 32;

export interface LinkTail {
  /** Index just after the closing `)`. */
  end: number;
  /** Destination with escapes and character references decoded. */
  url: string;
}

/** Parses the link tail whose `(` is at `open`; null when it is not a valid inline link. */
export function parseLinkTail(src: string, open: number): LinkTail | null {
  let i = skipWhitespace(src, open + 1);
  if (src.charCodeAt(i) === 41) return { end: i + 1, url: '' };
  const destination = destinationAt(src, i, MAX_PAREN_DEPTH);
  if (!destination) return null;
  i = destination.end;
  let after = skipWhitespace(src, i);
  if (src.charCodeAt(after) !== 41) {
    if (after === i) return null;
    const titleEnd = skipTitle(src, after);
    if (titleEnd < 0) return null;
    after = skipWhitespace(src, titleEnd);
    if (src.charCodeAt(after) !== 41) return null;
  }
  return { end: after + 1, url: decodeEscapesAndReferences(destination.value) };
}

/** A `<…>` or raw destination at `start` (raw ones nest parentheses at most `maxDepth` deep). */
export function destinationAt(
  src: string,
  start: number,
  maxDepth: number,
): { value: string; end: number } | null {
  return src.charCodeAt(start) === 60
    ? angleDestination(src, start)
    : rawDestination(src, start, maxDepth);
}

/** Spaces and tabs with at most one line ending among them. */
export function skipWhitespace(src: string, from: number): number {
  let i = from;
  while (src.charCodeAt(i) === 32 || src.charCodeAt(i) === 9) i += 1;
  if (src.charCodeAt(i) === 10) {
    i += 1;
    while (src.charCodeAt(i) === 32 || src.charCodeAt(i) === 9) i += 1;
  }
  return i;
}

function angleDestination(src: string, start: number): { value: string; end: number } | null {
  for (let i = start + 1; i < src.length; i += 1) {
    const code = src.charCodeAt(i);
    if (code === 62) return { value: src.slice(start + 1, i), end: i + 1 };
    if (code === 10 || code === 60) return null;
    if (code === 92 && isAsciiPunctuation(src.charCodeAt(i + 1))) i += 1;
  }
  return null;
}

function rawDestination(
  src: string,
  start: number,
  maxDepth: number,
): { value: string; end: number } | null {
  let depth = 0;
  let i = start;
  for (; i < src.length; i += 1) {
    const code = src.charCodeAt(i);
    if (code === 92 && isAsciiPunctuation(src.charCodeAt(i + 1))) {
      i += 1;
    } else if (code === 40) {
      depth += 1;
      if (depth > maxDepth) return null;
    } else if (code === 41) {
      if (depth === 0) break;
      depth -= 1;
    } else if (code <= 32 || code === 127) break;
  }
  if (i === start || depth !== 0) return null;
  return { value: src.slice(start, i), end: i };
}

/** Index after a `"…"`, `'…'` or `(…)` title starting at `start`, or -1. */
export function skipTitle(src: string, start: number): number {
  const open = src.charCodeAt(start);
  const close = open === 40 ? 41 : open;
  if (open !== 34 && open !== 39 && open !== 40) return -1;
  for (let i = start + 1; i < src.length; i += 1) {
    const code = src.charCodeAt(i);
    if (code === close) return i + 1;
    if (open === 40 && code === 40) return -1;
    if (code === 92 && isAsciiPunctuation(src.charCodeAt(i + 1))) i += 1;
  }
  return -1;
}
