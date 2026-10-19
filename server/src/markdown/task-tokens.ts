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

const DATE_TOKEN = /[ \t]*(\u{1F4C5}|✅)\uFE0F?[ \t]*(\d{4}-\d{2}-\d{2})(?!\d)/gu;
const DUE_EMOJI = '\u{1F4C5}';

/**
 * Parses the part of a task line after its checkbox. The first valid token of a kind wins.
 * Tokens are looked for in `masked` (same text with code and HTML blanked out), so a `📅` in
 * inline code or an HTML comment is not a date; they are removed from `afterCheckbox`.
 */
export function parseTaskTokens(afterCheckbox: string, masked = afterCheckbox): TaskTokens {
  let due: string | null = null;
  let completed: string | null = null;
  const invalidDates: string[] = [];
  let text = '';
  let last = 0;
  for (const match of masked.matchAll(DATE_TOKEN)) {
    const [whole, emoji, date] = match as unknown as [string, string, string];
    if (!isValidCalendarDate(date)) invalidDates.push(date);
    else if (emoji === DUE_EMOJI) due ??= date;
    else completed ??= date;
    text += afterCheckbox.slice(last, match.index);
    last = match.index + whole.length;
  }
  text += afterCheckbox.slice(last);
  return { text: text.trim(), due, completed, invalidDates };
}

/** The task whose checkbox `[` is at `checkbox`, read from its whole source line. */
export function taskAtCheckbox(
  content: string,
  lineStarts: readonly number[],
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
    ...parseTaskTokens(afterCheckbox, mask(afterCheckbox, from, excluded)),
  };
}

/** `text` (starting at file offset `from`) with every excluded span replaced by spaces. */
function mask(text: string, from: number, excluded: readonly TextSpan[]): string {
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
