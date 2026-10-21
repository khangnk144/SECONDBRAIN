/**
 * The done token `✅ YYYY-MM-DD` on a task's first line (SPEC §4.6, F9) and what a tick or an
 * untick does to it. These are the rules of the server's one-line patch for Today, Tasks and
 * Calendar (`server/src/markdown/task-line-patch.ts`, `task-tokens.ts`, `task-token-mask.ts`),
 * so the editor and the views write the same bytes:
 * - a token is `✅`, an optional U+FE0F, blanks, then a date (an impossible one too), outside
 *   inline code, HTML, wikilinks, links and images;
 * - a tick sets the first token in place to `✅ <today>`; with no token it appends ` ✅ <today>`
 *   at the end of the first line;
 * - an untick removes every token together with the blanks before it.
 *
 * A paragraph's content is handled as one string with one character per document position: soft
 * and hard breaks are `\n`, an inline atom (wikilink, image) is U+FFFC.
 */
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

/** Both date tokens, scanned like the server does (so the same matches are found). */
const DATE_TOKEN = /(\u{1F4C5}|✅)️?[ \t]*(\d{4}-\d{2}-\d{2})(?!\d)/gu;
const DONE_EMOJI = '✅';
const ATOM = '￼';
/** Marks whose text holds no task token (the server masks code spans and link text). */
const MASKED_MARKS = new Set(['code', 'link']);

export interface TextSplice {
  start: number;
  end: number;
  text: string;
}

/** A done token: from its emoji to the end of its date. */
export interface DoneToken {
  emojiStart: number;
  end: number;
}

export interface TaskText {
  text: string;
  /** `text` with inline code and link text blanked out (where tokens are looked for). */
  masked: string;
}

export const isBlank = (char: string | undefined): boolean => char === ' ' || char === '\t';

/** A paragraph's content as text (see the file comment). */
export function taskText(paragraph: ProseMirrorNode): TaskText {
  let text = '';
  let masked = '';
  paragraph.forEach((child) => {
    if (child.isText) {
      const value = child.text ?? '';
      text += value;
      const hidden = child.marks.some((mark) => MASKED_MARKS.has(mark.type.name));
      masked += hidden ? value.replace(/[^\n]/g, ' ') : value;
    } else {
      const char = child.type.name === 'hardBreak' ? '\n' : ATOM;
      text += char;
      masked += char;
    }
  });
  return { text, masked };
}

/** Where the first line of a paragraph's text ends. */
export function firstLineEnd(text: string): number {
  const end = text.indexOf('\n');
  return end === -1 ? text.length : end;
}

/** The done tokens of `masked`, in order. */
export function scanDoneTokens(masked: string): DoneToken[] {
  const tokens: DoneToken[] = [];
  for (const match of masked.matchAll(DATE_TOKEN)) {
    if (match[1] !== DONE_EMOJI) continue;
    tokens.push({ emojiStart: match.index, end: match.index + match[0].length });
  }
  return tokens;
}

/**
 * The done tokens on the first line of a paragraph. A match running over blanked-out text (a
 * `✅` then a code span, then a date) is no token here: editing it would delete that text.
 */
export function firstLineDoneTokens({ text, masked }: TaskText): DoneToken[] {
  return scanDoneTokens(masked.slice(0, firstLineEnd(text))).filter(
    ({ emojiStart, end }) => text.slice(emojiStart, end) === masked.slice(emojiStart, end),
  );
}

/** A tick: the first token set to today in place, else a new token at the end of the first line. */
export function tickSplices(task: TaskText, today: string): TextSplice[] {
  const first = firstLineDoneTokens(task)[0];
  if (first) return [{ start: first.emojiStart, end: first.end, text: `${DONE_EMOJI} ${today}` }];
  const end = firstLineEnd(task.text);
  return [{ start: end, end, text: `${end === 0 ? '' : ' '}${DONE_EMOJI} ${today}` }];
}

/**
 * An untick: every token of the first line removed. When that would leave the task without any
 * text (Markdown has no empty task item, the line would become a plain bullet), the tokens stay;
 * the server refuses that untick for the same reason.
 */
export function untickSplices(task: TaskText): TextSplice[] {
  const splices = textRemovals(task.text, firstLineDoneTokens(task));
  return applySplices(task.text, splices).trim() === '' ? [] : splices;
}

/**
 * Removes `tokens` from a paragraph's text as `removalRanges` does, and the first line's break
 * too when nothing is left of that line (the paragraph then starts on the next one).
 */
export function textRemovals(text: string, tokens: readonly DoneToken[]): TextSplice[] {
  const lineEnd = firstLineEnd(text);
  const ranges = removalRanges(
    text,
    tokens.map((token) => removalSpan(text, token)),
  );
  const removed = ranges.reduce((sum, range) => sum + range.end - range.start, 0);
  const last = ranges[ranges.length - 1];
  if (last && removed === lineEnd && lineEnd < text.length) last.end += 1;
  return ranges;
}

/** What the server removes for a token: from the blanks before its emoji to the end of its date. */
export function removalSpan(line: string, { emojiStart, end }: DoneToken): TextSplice {
  let start = emojiStart;
  while (start > 0 && isBlank(line[start - 1])) start -= 1;
  return { start, end, text: '' };
}

/**
 * The removal spans of a line, joined. A span at the very start of the paragraph reaches the
 * blank after the checkbox, which lies outside the paragraph and which the server removes; the
 * blanks after the span go instead (with the usual single blank, the same bytes). A paragraph
 * cannot start with a blank in the editor, so all of them go.
 */
export function removalRanges(line: string, spans: readonly TextSplice[]): TextSplice[] {
  const ranges = mergeRanges(spans);
  const first = ranges[0];
  if (first && first.start === 0) {
    while (isBlank(line[first.end])) first.end += 1;
  }
  return ranges;
}

/** Sorted splices with overlapping or touching removals joined. */
export function mergeRanges(splices: readonly TextSplice[]): TextSplice[] {
  const merged: TextSplice[] = [];
  for (const splice of [...splices].sort((a, b) => a.start - b.start)) {
    const last = merged[merged.length - 1];
    if (last && splice.start <= last.end && !last.text && !splice.text) {
      last.end = Math.max(last.end, splice.end);
    } else merged.push({ ...splice });
  }
  return merged;
}

export function applySplices(text: string, splices: readonly TextSplice[]): string {
  let out = '';
  let cursor = 0;
  for (const splice of [...splices].sort((a, b) => a.start - b.start)) {
    out += text.slice(cursor, splice.start) + splice.text;
    cursor = splice.end;
  }
  return out + text.slice(cursor);
}
