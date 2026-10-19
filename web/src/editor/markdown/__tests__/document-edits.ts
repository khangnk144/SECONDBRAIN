/** Programmatic edits of a loaded document, as the editor would make them (transactions). */
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { EditorState } from '@tiptap/pm/state';
import { toggleTask } from '../../extensions/task-toggle';
import type { MarkdownSnapshot } from '../markdown-snapshot';

export const DONE_DATE = '2026-10-19';
const WORD = /\p{L}{3,}/u;

/** File offsets `[start, end)` of each top-level block's source in the saved text. */
export function blockRanges(snapshot: MarkdownSnapshot): Array<[number, number]> {
  let offset = (snapshot.bom ? 1 : 0) + snapshot.frontmatter.length;
  return snapshot.blocks.map((block) => {
    offset += block.gap.length;
    const range: [number, number] = [offset, offset + block.source.length];
    offset += block.source.length;
    return range;
  });
}

/** Position of the first word of 3+ letters inside the node at `from`, if any. */
function wordIn(node: ProseMirrorNode, from: number): { pos: number; length: number } | null {
  let found: { pos: number; length: number } | null = null;
  node.descendants((child, pos) => {
    if (found) return false;
    if (child.isText) {
      const match = WORD.exec(child.text ?? '');
      if (match) found = { pos: from + 1 + pos + match.index, length: match[0].length };
    }
    return true;
  });
  return found;
}

/** Indexes of the supported top-level blocks that hold a word to edit. */
export function editableBlocks(doc: ProseMirrorNode): number[] {
  const indexes: number[] = [];
  doc.forEach((node, _offset, index) => {
    if (node.type.name !== 'verbatimBlock' && wordIn(node, 0)) indexes.push(index);
  });
  return indexes;
}

/** Index of the supported top-level block closest to the middle that contains a word. */
export function middleEditableBlock(doc: ProseMirrorNode): number | null {
  const candidates = editableBlocks(doc);
  if (candidates.length === 0) return null;
  const middle = (doc.childCount - 1) / 2;
  return candidates.reduce((best, index) =>
    Math.abs(index - middle) < Math.abs(best - middle) ? index : best,
  );
}

/** Replaces the first word of top-level block `index` with `replacement`. */
export function editWordInBlock(
  doc: ProseMirrorNode,
  index: number,
  replacement = 'EDITED',
): ProseMirrorNode {
  let start = 0;
  for (let i = 0; i < index; i += 1) start += doc.child(i).nodeSize;
  const word = wordIn(doc.child(index), start);
  if (!word) throw new Error(`Block ${index} has no word to edit`);
  const state = EditorState.create({ doc });
  return state.tr.insertText(replacement, word.pos, word.pos + word.length).doc;
}

export interface TaskLocation {
  pos: number;
  checked: boolean;
  /** Index of the top-level block holding the task. */
  block: number;
}

export function findTasks(doc: ProseMirrorNode): TaskLocation[] {
  const tasks: TaskLocation[] = [];
  doc.forEach((block, offset, index) => {
    block.descendants((node, pos) => {
      if (node.type.name === 'taskItem') {
        tasks.push({
          pos: offset + 1 + pos,
          checked: Boolean(node.attrs['checked']),
          block: index,
        });
      }
      return true;
    });
  });
  return tasks;
}

/** End of the first line of the task's first paragraph (before a soft or hard break). */
function firstLineEnd(doc: ProseMirrorNode, taskPos: number): number {
  const paragraph = doc.nodeAt(taskPos)?.firstChild;
  if (!paragraph) throw new Error('Task without paragraph');
  let pos = taskPos + 2;
  for (let i = 0; i < paragraph.childCount; i += 1) {
    const child = paragraph.child(i);
    if (child.type.name === 'hardBreak') return pos;
    const newline = child.isText ? (child.text ?? '').indexOf('\n') : -1;
    if (newline !== -1) return pos + newline;
    pos += child.nodeSize;
  }
  return pos;
}

/** Whether the end of the task's first line sits inside a run of marked text. */
export function firstLineEndsInsideMarks(doc: ProseMirrorNode, taskPos: number): boolean {
  const $pos = doc.resolve(firstLineEnd(doc, taskPos));
  const before = $pos.nodeBefore?.marks ?? [];
  const after = $pos.nodeAfter?.marks ?? [];
  return before.some((mark) => mark.isInSet(after));
}

/** Ticks the task at `pos` the way the editor does (the shipped `toggleTask`). */
export function tickTask(doc: ProseMirrorNode, pos: number, date = DONE_DATE): ProseMirrorNode {
  return toggleTask(EditorState.create({ doc }).tr, pos, true, date).doc;
}

/** Unticks the task at `pos` the way the editor does: its done token goes too. */
export function untickTask(doc: ProseMirrorNode, pos: number): ProseMirrorNode {
  return toggleTask(EditorState.create({ doc }).tr, pos, false, DONE_DATE).doc;
}
