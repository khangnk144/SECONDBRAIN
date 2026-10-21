/**
 * Task date tokens (SPEC §4.6, compatible with the Obsidian Tasks plugin): `📅 YYYY-MM-DD` due,
 * `✅ YYYY-MM-DD` completed, each emoji optionally followed by U+FE0F. Tokens with an impossible
 * date (`2026-02-30`) are reported so the UI can warn, and never used as dates.
 */
import { isValidCalendarDate } from './calendar-date.js';
import type { ParsedTask } from './markdown-types.js';
import type { TextSpan } from './note-structure-types.js';
import { lineOfOffset, lineTextAt } from './source-lines.js';

export interface TaskTokens {
  /** Task text without the date tokens, trimmed. */
  text: string;
  due: string | null;
  completed: string | null;
  invalidDates: string[];
}

/** One date token, with offsets into the text it was found in. */
export interface DateToken {
  kind: 'due' | 'done';
  date: string;
  valid: boolean;
  /** Start of the token including the spaces/tabs before its emoji. */
  start: number;
  emojiStart: number;
  dateStart: number;
  /** End of the date. */
  end: number;
}

const DATE_TOKEN = /(\u{1F4C5}|✅)️?[ \t]*(\d{4}-\d{2}-\d{2})(?!\d)/gu;
const DUE_EMOJI = '\u{1F4C5}';

const isBlank = (char: string | undefined) => char === ' ' || char === '\t';

/**
 * Date tokens of `text`, looked for in `masked` (the same text with the `taskTokenMask` spans
 * blanked out), so a `📅` in inline code, an HTML comment or a link is not a date. The spaces before a token belong to
 * it, but only real ones: the blanked-out end of `` `code` `` or `</u>` right before the emoji
 * stays part of the text.
 */
export function scanDateTokens(text: string, masked = text): DateToken[] {
  const tokens: DateToken[] = [];
  for (const match of masked.matchAll(DATE_TOKEN)) {
    const [whole, emoji, date] = match as unknown as [string, string, string];
    const emojiStart = match.index;
    let start = emojiStart;
    while (start > 0 && isBlank(text[start - 1])) start -= 1;
    const end = emojiStart + whole.length;
    tokens.push({
      kind: emoji === DUE_EMOJI ? 'due' : 'done',
      date,
      valid: isValidCalendarDate(date),
      start,
      emojiStart,
      dateStart: end - date.length,
      end,
    });
  }
  return tokens;
}

/** Parses the part of a task line after its checkbox. The first valid token of a kind wins. */
export function parseTaskTokens(afterCheckbox: string, masked = afterCheckbox): TaskTokens {
  let due: string | null = null;
  let completed: string | null = null;
  const invalidDates: string[] = [];
  let text = '';
  let last = 0;
  for (const token of scanDateTokens(afterCheckbox, masked)) {
    if (!token.valid) invalidDates.push(token.date);
    else if (token.kind === 'due') due ??= token.date;
    else completed ??= token.date;
    text += afterCheckbox.slice(last, token.start);
    last = token.end;
  }
  text += afterCheckbox.slice(last);
  return { text: text.trim(), due, completed, invalidDates };
}

/** The task whose checkbox `[` is at `checkbox`, read from its whole source line. */
export function taskAtCheckbox(
  content: string,
  lineStarts: readonly number[],
  /** Where tokens are not read (`taskTokenMask`). */
  excluded: readonly TextSpan[],
  checkbox: number,
  done: boolean,
): ParsedTask {
  const line = lineOfOffset(lineStarts, checkbox);
  const lineText = lineTextAt(content, lineStarts, line);
  const lineStart = lineStarts[line - 1] as number;
  const from = checkbox + 3;
  const afterCheckbox = lineText.slice(from - lineStart);
  return {
    line,
    lineText,
    done,
    ...parseTaskTokens(afterCheckbox, maskExcluded(afterCheckbox, from, excluded)),
  };
}

/** `text` (starting at file offset `from`) with every excluded span replaced by spaces. */
export function maskExcluded(text: string, from: number, excluded: readonly TextSpan[]): string {
  let lo = 0;
  let hi = excluded.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((excluded[mid] as TextSpan).end <= from) lo = mid + 1;
    else hi = mid;
  }
  let masked = text;
  const to = from + text.length;
  for (let i = lo; i < excluded.length && (excluded[i] as TextSpan).start < to; i += 1) {
    const span = excluded[i] as TextSpan;
    const start = Math.max(span.start, from) - from;
    const end = Math.min(span.end, to) - from;
    masked = masked.slice(0, start) + ' '.repeat(end - start) + masked.slice(end);
  }
  return masked;
}
