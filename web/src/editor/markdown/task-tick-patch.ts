/**
 * Ticking a task is a text patch, not a re-serialisation: `[ ]`↔`[x]` in the item's own line,
 * and a ` ✅ YYYY-MM-DD` token added at or removed from the end of its first line. Each patch
 * returns null when the change is anything else; the save then verifies the patched text.
 */
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { SourceBlock } from './markdown-snapshot';

const CHECKBOX = /\[[ xX]\]/;
const DONE_TOKEN = /^ ✅\uFE0F? \d{4}-\d{2}-\d{2}$/u;

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

/** The first paragraph of a task with only a done token added or removed at its first line end. */
export function patchDoneToken(original: SourceBlock, current: ProseMirrorNode): string | null {
  const before = lineText(original.node);
  const after = lineText(current);
  const source = original.source;
  const lineEnd = firstLineEnd(source);
  const insertAt = contentEnd(source.slice(0, lineEnd), lineEnd < source.length);
  if (after.length > before.length) {
    const at = firstLineEnd(before);
    const token = after.slice(at, at + after.length - before.length);
    if (!DONE_TOKEN.test(token) || after !== before.slice(0, at) + token + before.slice(at)) {
      return null;
    }
    return source.slice(0, insertAt) + token + source.slice(insertAt);
  }
  if (before.length > after.length) {
    const at = firstLineEnd(after);
    const token = before.slice(at, at + before.length - after.length);
    if (!DONE_TOKEN.test(token) || before !== after.slice(0, at) + token + after.slice(at)) {
      return null;
    }
    if (source.slice(insertAt - token.length, insertAt) !== token) return null;
    return source.slice(0, insertAt - token.length) + source.slice(insertAt);
  }
  return null;
}

/** Paragraph text with hard breaks as line ends (atoms count as one placeholder character). */
function lineText(node: ProseMirrorNode): string {
  return node.textBetween(0, node.content.size, undefined, (leaf) =>
    leaf.type.name === 'hardBreak' ? '\n' : '\uFFFC',
  );
}

function firstLineEnd(text: string): number {
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
