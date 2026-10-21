/**
 * The text changes a task-line edit makes, as splices of the line (pure): `[ ]`/`[x]`, and date
 * tokens written at the end of the item's first line (before trailing blanks, and before a final
 * `\` when the paragraph goes on, where it is a hard break), rewritten in place or removed.
 * Each splice records the token emoji it rewrites, removes or writes, so the patch can check
 * that nothing else changed in how the paragraph renders.
 */
import type { DateToken } from './task-tokens.js';

/** A local replacement inside the line (offsets relative to the line start). */
export interface Splice {
  start: number;
  end: number;
  text: string;
  /** Offset of the emoji of the token this splice rewrites or removes. */
  old?: number;
  /** Index in `text` of the emoji of the token it writes. */
  emojiAt?: number;
}

/** What the splices need to know about the task line. */
export interface TaskLineFacts {
  text: string;
  /** Offset of the checkbox `[` inside the line. */
  box: number;
  checked: boolean;
  /** Date tokens with offsets inside the line (none inside code, HTML or links). */
  tokens: DateToken[];
  /** The task's paragraph goes on after this line. */
  continues: boolean;
}

const DUE_EMOJI = '\u{1F4C5}';

const isBlank = (char: string | undefined) => char === ' ' || char === '\t';

/** Where the editor puts a new token: end of the line's content (see the file comment). */
function insertionPoint(task: TaskLineFacts): number {
  const { text: line } = task;
  const minimum = task.box + 3;
  let end = line.length;
  while (end > minimum && isBlank(line[end - 1])) end -= 1;
  if (end < line.length || !task.continues) return end;
  let backslashes = 0;
  while (end - backslashes > minimum && line[end - 1 - backslashes] === '\\') backslashes += 1;
  return backslashes % 2 === 1 ? end - 1 : end;
}

/** Whether the backslashes right before `at` end in an unescaped one. */
function oddBackslashesBefore(line: string, at: number, minimum: number): boolean {
  let count = 0;
  while (at - count > minimum && line[at - 1 - count] === '\\') count += 1;
  return count % 2 === 1;
}

/**
 * Removes a token with the blanks before it (what a tick adds, ` ✅ <date>`), so a tick then an
 * untick gives the original bytes and no blanks are left that could turn a soft line break
 * into a hard one. Only when the paragraph goes on and an unescaped backslash would end the
 * line does one blank stay, keeping that backslash literal instead of making it a hard break.
 */
function removal(task: TaskLineFacts, token: DateToken): Splice {
  const line = task.text;
  const endsLine = /^[ \t]*$/.test(line.slice(token.end));
  const keepOne =
    task.continues &&
    endsLine &&
    token.start < token.emojiStart &&
    oddBackslashesBefore(line, token.start, task.box + 3);
  return {
    start: keepOne ? token.start + 1 : token.start,
    end: token.end,
    text: '',
    old: token.emojiStart,
  };
}

/** The new line, and where the emojis of the tokens written into it are. */
export function applySplices(line: string, splices: Splice[]): { text: string; marks: number[] } {
  let text = '';
  let cursor = 0;
  const marks: number[] = [];
  for (const splice of [...splices].sort((a, b) => a.start - b.start)) {
    text += line.slice(cursor, splice.start);
    if (splice.emojiAt !== undefined) marks.push(text.length + splice.emojiAt);
    text += splice.text;
    cursor = splice.end;
  }
  return { text: text + line.slice(cursor), marks };
}

export function doneSplices(task: TaskLineFacts, done: boolean, today: string): Splice[] {
  const doneTokens = task.tokens.filter((t) => t.kind === 'done');
  const box = { start: task.box + 1, end: task.box + 2 };
  if (!done) return [{ ...box, text: ' ' }, ...doneTokens.map((t) => removal(task, t))];
  // Ticking a ticked task changes nothing (its completion date stays).
  if (task.checked) return [];
  const first = doneTokens[0];
  if (first) {
    const date = { start: first.emojiStart, end: first.end, old: first.emojiStart, emojiAt: 0 };
    return [
      { ...box, text: 'x' },
      { ...date, text: `✅ ${today}` },
    ];
  }
  const at = insertionPoint(task);
  return [
    { ...box, text: 'x' },
    { start: at, end: at, text: ` ✅ ${today}`, emojiAt: 1 },
  ];
}

export function dueSplices(task: TaskLineFacts, due: string | null): Splice[] {
  const dueTokens = task.tokens.filter((t) => t.kind === 'due');
  if (due === null) return dueTokens.map((t) => removal(task, t));
  // The token the index reads (the first valid one); an invalid one only when none is valid.
  const used = dueTokens.find((t) => t.valid) ?? dueTokens[0];
  if (used) {
    const emoji = task.text.slice(used.emojiStart, used.dateStart);
    return [
      {
        start: used.emojiStart,
        end: used.end,
        text: emoji + due,
        old: used.emojiStart,
        emojiAt: 0,
      },
    ];
  }
  const before = task.tokens.find((t) => t.kind === 'done');
  const at = before ? before.start : insertionPoint(task);
  return [{ start: at, end: at, text: ` ${DUE_EMOJI} ${due}`, emojiAt: 1 }];
}
