/**
 * Ticking a task is a text patch, not a re-serialisation: `[ ]`↔`[x]` in the item's own line,
 * and on its first line a done token set in place, appended at the end or removed (see
 * `done-token-rules.ts`). Each patch returns null when the change is anything else; the save then
 * verifies the patched text.
 */
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import {
  applySplices,
  firstLineDoneTokens,
  firstLineEnd,
  removalRanges,
  removalSpan,
  scanDoneTokens,
  taskText,
  textRemovals,
  type DoneToken,
  type TaskText,
  type TextSplice,
} from './done-token-rules';
import type { SourceBlock } from './markdown-snapshot';

const CHECKBOX = /\[[ xX]\]/;
/** A done token appended at the end of a line, with its leading space. */
const APPENDED = /^ ✅\uFE0F? \d{4}-\d{2}-\d{2}$/u;
/** A done token set in place by a tick. */
const IN_PLACE = /^✅ \d{4}-\d{2}-\d{2}$/u;

export function patchCheckbox(head: string, checked: boolean): string | null {
  const match = CHECKBOX.exec(head);
  if (!match) return null;
  return head.slice(0, match.index) + (checked ? '[x]' : '[ ]') + head.slice(match.index + 3);
}

/** Replaces the digits of an ordered item's number when the width stays the same. */
export function patchItemNumber(head: string, number: number): string | null {
  const match = /^\d+/.exec(head);
  const digits = String(number);
  if (!match || match[0].length !== digits.length) return null;
  return digits + head.slice(digits.length);
}

/**
 * The first paragraph of a task whose first line changed only by a tick or an untick
 * (`done-token-rules.ts`): a token appended at the end of the line, a token set in place, or
 * tokens removed. The same edit is made on the source line the way the server's view patch makes
 * it, so both write the same bytes; the save then checks that the result parses back to `current`.
 */
export function patchDoneToken(original: SourceBlock, current: ProseMirrorNode): string | null {
  const before = taskText(original.node);
  const after = taskText(current).text;
  const source = original.source;
  const lineEnd = sourceLineEnd(source);
  const textEnd = firstLineEnd(before.text);
  const appended = after.slice(textEnd, textEnd + after.length - before.text.length);
  if (
    APPENDED.test(appended) &&
    after === before.text.slice(0, textEnd) + appended + before.text.slice(textEnd)
  ) {
    const at = contentEnd(source.slice(0, lineEnd), lineEnd < source.length);
    return source.slice(0, at) + appended + source.slice(at);
  }
  const pairs = tokenPairs(before.text.slice(0, textEnd), source.slice(0, lineEnd));
  if (!pairs) return null;
  const line = { text: source.slice(0, lineEnd), continues: lineEnd < source.length };
  for (const edit of tokenEdits(before, after, pairs, line)) {
    if (applySplices(before.text, edit.text) === after) return applySplices(source, edit.source);
  }
  return null;
}

interface TokenPair {
  text: DoneToken;
  source: DoneToken;
}

/** The first line's tokens in the text and in the source, one for one; null when they differ. */
function tokenPairs(textLine: string, sourceLine: string): TokenPair[] | null {
  const inText = scanDoneTokens(textLine);
  const inSource = scanDoneTokens(sourceLine);
  if (inText.length !== inSource.length) return null;
  const pairs = inText.map((text, i) => ({ text, source: inSource[i] as DoneToken }));
  const same = pairs.every(
    ({ text, source }) =>
      textLine.slice(text.emojiStart, text.end) === sourceLine.slice(source.emojiStart, source.end),
  );
  return same ? pairs : null;
}

/** The paragraph's first source line, and whether the paragraph goes on after it. */
interface SourceLine {
  text: string;
  continues: boolean;
}

interface TokenEdit {
  text: TextSplice[];
  source: TextSplice[];
}

/** Candidate token edits, each as splices of the text and of the source line. */
function* tokenEdits(
  before: TaskText,
  after: string,
  pairs: readonly TokenPair[],
  sourceLine: SourceLine,
): Generator<TokenEdit> {
  const grown = after.length - before.text.length;
  for (const { text, source } of pairs) {
    const token = after.slice(text.emojiStart, text.end + grown);
    if (!IN_PLACE.test(token)) continue;
    yield {
      text: [{ start: text.emojiStart, end: text.end, text: token }],
      source: [{ start: source.emojiStart, end: source.end, text: token }],
    };
  }
  // An untick removes the tokens outside code and links; one token may also go on its own.
  const removable = firstLineDoneTokens(before).map((token) =>
    pairs.find((pair) => pair.text.emojiStart === token.emojiStart && pair.text.end === token.end),
  );
  if (removable.length > 0 && removable.every((pair) => pair !== undefined)) {
    yield removalEdit(before.text, removable as TokenPair[], sourceLine);
  }
  for (const pair of pairs) yield removalEdit(before.text, [pair], sourceLine);
}

function removalEdit(text: string, pairs: readonly TokenPair[], sourceLine: SourceLine): TokenEdit {
  const inText = pairs.map((pair) => pair.text);
  const inSource = pairs.map((pair) => pair.source);
  return { text: textRemovals(text, inText), source: sourceRemovals(sourceLine, inSource) };
}

/**
 * The server's removal on the source line: each token with the blanks before it, except that one
 * blank stays after a backslash that would then end a line the paragraph goes on after (so it
 * does not become a hard break). In the text that blank is invisible (a line's trailing blanks
 * are not text).
 */
function sourceRemovals(line: SourceLine, tokens: readonly DoneToken[]): TextSplice[] {
  const spans = tokens.map((token) => {
    const span = removalSpan(line.text, token);
    const endsLine = /^[ \t]*$/.test(line.text.slice(span.end));
    const keepOne =
      line.continues &&
      endsLine &&
      span.start < token.emojiStart &&
      line.text[span.start - 1] === '\\';
    return keepOne ? { ...span, start: span.start + 1 } : span;
  });
  return removalRanges(line.text, spans);
}

function sourceLineEnd(text: string): number {
  const match = /\r|\n/.exec(text);
  return match ? match.index : text.length;
}

/** End of a line's content: before trailing spaces and before a hard-break backslash. */
function contentEnd(line: string, moreLines: boolean): number {
  let end = line.length;
  while (end > 0 && (line[end - 1] === ' ' || line[end - 1] === '\t')) end -= 1;
  if (end < line.length || !moreLines) return end;
  let backslashes = 0;
  while (end - backslashes > 0 && line[end - 1 - backslashes] === '\\') backslashes += 1;
  return backslashes % 2 === 1 ? end - 1 : end;
}
