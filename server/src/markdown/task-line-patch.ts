/**
 * Task edits made from a view (Today, Tasks, Calendar) as a patch of exactly one line (SPEC §4.6,
 * §4.9, F9, F11): tick/untick, set or remove the due date. The line is found by its number and
 * must still read as the view showed it, so a view never patches a line it did not show. A tick
 * writes what the editor writes: `[ ]`→`[x]` plus ` ✅ <today>` at the end of the item's first
 * line, before trailing blanks, and before a final `\` when that is a hard break. The patched
 * note must render the task's paragraph exactly as before apart from the token, or nothing is
 * written.
 */
import { VaultError, type TextRangePatch } from '../vault/vault-types.js';
import { splitFrontmatter } from './frontmatter.js';
import { noteStructure } from './note-structure.js';
import { parseNote } from './parse-note.js';
import { buildLineStarts, lineOfOffset, lineTextAt } from './source-lines.js';
import { applySplices, doneSplices, dueSplices, type TaskLineFacts } from './task-line-splices.js';
import {
  continuesAfterFirstLine,
  findTaskParagraph,
  renderTaskParagraph,
  type TaskParagraph,
} from './task-paragraph.js';
import { noteTaskTokenMask } from './task-token-mask.js';
import { maskExcluded, scanDateTokens, type DateToken } from './task-tokens.js';

export type TaskLineEdit = { done: boolean } | { due: string | null };

export interface TaskLineTarget {
  /** 1-based file line (front matter counted), as the index reports it. */
  line: number;
  /** The whole line as the view showed it (without its line ending). */
  expectedText: string;
}

export interface TaskLinePatch {
  /** null when the line already reads as asked (nothing to write). */
  patch: TextRangePatch | null;
  /** The line after the edit. */
  lineText: string;
}

function refuse(reason: string, message: string): VaultError {
  return new VaultError('VALIDATION', message, { reason });
}

const refuseVerify = () =>
  refuse('patch-verify', 'The task could not be changed without changing more.');

interface TaskLine extends TaskLineFacts {
  lineStart: number;
  bodyStart: number;
  paragraph: TaskParagraph;
}

function readTaskLine(content: string, target: TaskLineTarget): TaskLine {
  const starts = buildLineStarts(content);
  const text = target.line <= starts.length ? lineTextAt(content, starts, target.line) : null;
  if (text !== target.expectedText) {
    throw new VaultError('CONFLICT', 'The task line changed since it was read', {
      reason: 'line-changed',
      line: target.line,
      currentText: text,
    });
  }
  const { bodyStart } = splitFrontmatter(content);
  const structure = noteStructure(content, bodyStart);
  const task = structure.tasks.find((t) => lineOfOffset(starts, t.checkbox) === target.line);
  if (!task) throw refuse('not-a-task', 'That line is not a task.');
  const paragraph = findTaskParagraph(content, bodyStart, task.checkbox);
  if (!paragraph) throw refuseVerify();
  const lineStart = starts[target.line - 1] as number;
  const box = task.checkbox - lineStart;
  const after = text.slice(box + 3);
  const shift = (t: DateToken): DateToken => ({
    ...t,
    start: t.start + box + 3,
    emojiStart: t.emojiStart + box + 3,
    dateStart: t.dateStart + box + 3,
    end: t.end + box + 3,
  });
  const mask = noteTaskTokenMask(content, bodyStart, structure);
  const masked = maskExcluded(after, task.checkbox + 3, mask);
  return {
    text,
    lineStart,
    bodyStart,
    box,
    checked: task.checked,
    tokens: scanDateTokens(after, masked).map(shift),
    paragraph,
    continues: continuesAfterFirstLine(paragraph),
  };
}

/**
 * The one-line patch for `edit` on the task at `target` (pure; throws VaultError CONFLICT with
 * `reason: 'line-changed'` or VALIDATION `not-a-task` / `patch-verify`). `today` is the local
 * calendar date written into a new ✅ token; `due` must already be a valid calendar date.
 */
export function planTaskLinePatch(
  content: string,
  target: TaskLineTarget,
  edit: TaskLineEdit,
  today: string,
): TaskLinePatch {
  const task = readTaskLine(content, target);
  const splices = 'done' in edit ? doneSplices(task, edit.done, today) : dueSplices(task, edit.due);
  const { text: lineText, marks } = applySplices(task.text, splices);
  if (lineText === task.text) return { patch: null, lineText };
  const patch = { start: task.lineStart, end: task.lineStart + task.text.length, text: lineText };
  const patched = content.slice(0, patch.start) + patch.text + content.slice(patch.end);
  verifyTask(patched, target.line, edit, today);
  const removed = splices.flatMap((s) => (s.old === undefined ? [] : [task.lineStart + s.old]));
  const written = marks.map((mark) => task.lineStart + mark);
  verifyRendering(content, patched, task, removed, written);
  return { patch, lineText };
}

/** The patched note must still have a task on that line that reads exactly as intended. */
function verifyTask(patched: string, line: number, edit: TaskLineEdit, today: string): void {
  const task = parseNote(patched).tasks.find((t) => t.line === line);
  const ok =
    task !== undefined &&
    ('done' in edit
      ? task.done === edit.done && task.completed === (edit.done ? today : null)
      : task.due === edit.due);
  if (!ok) throw refuseVerify();
}

/**
 * The task's paragraph must render the same before and after, apart from the tokens the patch
 * rewrote or removed (emojis at `removed` before) and wrote (emojis at `written` after).
 */
function verifyRendering(
  content: string,
  patched: string,
  task: TaskLine,
  removed: number[],
  written: number[],
): void {
  const checkbox = task.lineStart + task.box;
  const after = findTaskParagraph(patched, task.bodyStart, checkbox);
  const before = renderTaskParagraph(content, task.paragraph, removed);
  if (!after || before === null || before !== renderTaskParagraph(patched, after, written)) {
    throw refuseVerify();
  }
}
