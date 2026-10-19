import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { Transaction } from '@tiptap/pm/state';

/** The completion token the app writes when a task is ticked (SPEC §4.6, Obsidian Tasks). */
const DONE_TOKEN_AT_END = /\s?✅ \d{4}-\d{2}-\d{2}(?=\s*$)/u;

/**
 * Ticks or unticks the task item at `pos` in one transaction: `checked` changes and ` ✅ <today>`
 * is appended to (or removed from) the end of the item's first source line (before its first soft
 * or hard line break) as plain text without marks, so the converter writes the change as a patch
 * of that one line.
 */
export function toggleTask(
  tr: Transaction,
  pos: number,
  checked: boolean,
  today: string,
): Transaction {
  const item = tr.doc.nodeAt(pos);
  if (!item || item.type.name !== 'taskItem') return tr;
  tr.setNodeMarkup(pos, undefined, { ...item.attrs, checked });
  const paragraph = item.firstChild;
  if (!paragraph || !paragraph.isTextblock) return tr;
  const contentStart = pos + 2;
  const lineEnd = contentStart + firstLineEndOffset(paragraph);
  const tail = textBefore(paragraph, lineEnd - contentStart);
  const existing = DONE_TOKEN_AT_END.exec(tail);
  if (checked) {
    if (existing) return tr;
    const token = paragraph.content.size === 0 ? `✅ ${today}` : ` ✅ ${today}`;
    tr.insert(lineEnd, tr.doc.type.schema.text(token));
  } else if (existing) {
    const from = lineEnd - tail.length + existing.index;
    tr.delete(from, from + existing[0].length);
  }
  return tr;
}

/** Offset (inside the paragraph) where its first line ends: at the first soft or hard break. */
function firstLineEndOffset(paragraph: ProseMirrorNode): number {
  let offset = 0;
  for (let i = 0; i < paragraph.childCount; i += 1) {
    const child = paragraph.child(i);
    if (child.type.name === 'hardBreak') return offset;
    const newline = child.isText ? (child.text ?? '').indexOf('\n') : -1;
    if (newline !== -1) return offset + newline;
    offset += child.nodeSize;
  }
  return offset;
}

/** The text (of consecutive text nodes, any marks) that ends at `offset`; an atom ends the run. */
function textBefore(paragraph: ProseMirrorNode, offset: number): string {
  let text = '';
  let at = 0;
  for (let i = 0; i < paragraph.childCount && at < offset; i += 1) {
    const child = paragraph.child(i);
    const end = Math.min(at + child.nodeSize, offset);
    text = child.isText ? text + (child.text ?? '').slice(0, end - at) : '';
    at += child.nodeSize;
  }
  return text;
}
