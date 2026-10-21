/**
 * Tags (SPEC §4.5): inline `#tag` and the front-matter `tags:` key. Tag characters are Unicode
 * letters (with combining marks, so NFD text keeps whole words), digits, `_`, `-` and `/`;
 * a tag needs at least one letter (`#1` is not a tag) and a trailing `/` is dropped. Inline
 * tags start after a line start, whitespace or `(` — but not after `](`, which is a link
 * destination such as `[x](#section)` (a URL fragment, not a tag). Underline tags (`<u>`, `</u>`)
 * right before the `#` are looked through.
 */
import type { ParsedTag } from './markdown-types.js';
import { normalizeForIndex } from './normalize-text.js';
import type { TextSpan } from './note-structure-types.js';
import { lineOfOffset } from './source-lines.js';
import { charLengthAt, isLetterAt, isWhitespaceCode, isWordCharAt } from './unicode-classes.js';

const HAS_LETTER = /\p{L}/u;
const VALID_TAG = /^[\p{L}\p{N}\p{M}_/-]+$/u;

function cleanTag(body: string): string | null {
  const tag = body.replace(/\/+$/, '');
  return tag !== '' && HAS_LETTER.test(tag) ? tag : null;
}

/** Inline tags in `content[from…]`, skipping the excluded (code/HTML) spans, sorted by start. */
export function scanInlineTags(
  content: string,
  from: number,
  excluded: readonly TextSpan[],
  lineStarts: readonly number[],
): ParsedTag[] {
  const tags: ParsedTag[] = [];
  let spanIndex = 0;
  let at = content.indexOf('#', from);
  while (at !== -1) {
    while (spanIndex < excluded.length && (excluded[spanIndex] as TextSpan).end <= at)
      spanIndex += 1;
    const span = excluded[spanIndex];
    if (span && span.start <= at) {
      at = content.indexOf('#', span.end);
      continue;
    }
    let end = at + 1;
    if (startsTag(content, at)) {
      let hasLetter = false;
      while (end < content.length && isTagCharAt(content, end)) {
        hasLetter ||= isLetterAt(content, end);
        end += charLengthAt(content, end);
      }
      const tag = hasLetter ? cleanTag(content.slice(at + 1, end)) : null;
      if (tag) {
        tags.push({
          tag,
          norm: normalizeForIndex(tag),
          source: 'inline',
          line: lineOfOffset(lineStarts, at),
        });
      }
    }
    at = content.indexOf('#', end);
  }
  return tags;
}

/**
 * Where the text before `at` really ends: the editor's underline tags `<u>`/`</u>` are a mark,
 * not characters, so `<u>#tag</u>` reads like `#tag` there and must count here too.
 */
function beforeUnderlineTags(content: string, at: number): number {
  let i = at;
  for (;;) {
    if (i >= 3 && content.startsWith('<u>', i - 3)) i -= 3;
    else if (i >= 4 && content.startsWith('</u>', i - 4)) i -= 4;
    else return i;
  }
}

function startsTag(content: string, hash: number): boolean {
  const at = beforeUnderlineTags(content, hash);
  if (at === 0) return true;
  const before = content.charCodeAt(at - 1);
  if (before === 40) return at < 2 || content.charCodeAt(at - 2) !== 93; // `(` but not `](`
  return isWhitespaceCode(before);
}

function isTagCharAt(content: string, i: number): boolean {
  const code = content.charCodeAt(i);
  return code === 95 || code === 45 || code === 47 || isWordCharAt(content, i);
}

/**
 * Front-matter `tags:` as a list or a comma/space separated string; a leading `#` is dropped.
 * Values that could not be written as an inline tag are ignored so both forms count alike.
 */
export function frontmatterTags(data: Record<string, unknown> | null, line: number): ParsedTag[] {
  const value = data?.['tags'];
  if (value === undefined || value === null) return [];
  const items = Array.isArray(value) ? value : [value];
  const tags: ParsedTag[] = [];
  for (const item of items) {
    if (typeof item !== 'string' && typeof item !== 'number') continue;
    for (const piece of String(item).split(/[\s,]+/)) {
      const tag = cleanTag(piece.replace(/^#+/, ''));
      if (tag && VALID_TAG.test(tag)) {
        tags.push({ tag, norm: normalizeForIndex(tag), source: 'frontmatter', line });
      }
    }
  }
  return tags;
}
