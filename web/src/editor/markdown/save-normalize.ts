/**
 * The editor node as it will read back after a canonical save: what Markdown cannot hold is
 * removed the same way the serializer removes it. Saving compares the re-parsed output with this
 * node, not with the raw editor node, so harmless editor-only details (an empty paragraph, a hard
 * break at the end of a line) do not count as a failed save.
 */
import { Fragment, type Node as ProseMirrorNode } from '@tiptap/pm/model';
import { inlineChildren, keptMarks } from './prosemirror-inline-to-mdast';
import { flowChildren } from './prosemirror-to-mdast';

const CONTAINERS = new Set(['blockquote', 'listItem', 'taskItem']);
const LISTS = new Set(['bulletList', 'orderedList', 'taskList']);

export function normalizeForMarkdown(node: ProseMirrorNode): ProseMirrorNode {
  if (node.isTextblock && node.type.name !== 'codeBlock') return normalizeTextblock(node);
  if (node.isLeaf || node.type.name === 'codeBlock') return node;
  let children: ProseMirrorNode[] = [];
  node.forEach((child) => children.push(child));
  if (CONTAINERS.has(node.type.name)) {
    const kept = flowChildren(node);
    if (kept.length > 0 && kept.length !== children.length) children = kept;
  }
  children = children.map(normalizeForMarkdown);
  let attrs = node.attrs;
  if (LISTS.has(node.type.name) && !attrs['loose'] && children.some(needsBlankLine)) {
    attrs = { ...attrs, loose: true };
  }
  const same =
    attrs === node.attrs &&
    children.length === node.childCount &&
    children.every((child, index) => child === node.child(index));
  return same ? node : node.type.create(attrs, Fragment.fromArray(children), node.marks);
}

/** An item whose blocks cannot sit on consecutive lines makes its list loose. */
function needsBlankLine(item: ProseMirrorNode): boolean {
  for (let i = 1; i < item.childCount; i += 1) {
    const previous = item.child(i - 1);
    const next = item.child(i);
    if (previous.type.name !== 'paragraph') continue;
    if (next.type.name === 'paragraph') return true;
    if (next.type.name === 'orderedList' && Number(next.attrs['start']) !== 1) return true;
  }
  return false;
}

function normalizeTextblock(node: ProseMirrorNode): ProseMirrorNode {
  const children = inlineChildren(node).map((child) => {
    const marks = keptMarks(child);
    return marks.length === child.marks.length ? child : child.mark(marks);
  });
  let attrs = node.attrs;
  if (node.type.name === 'heading') {
    const level = Math.min(Math.max(Number(attrs['level']) || 1, 1), 3);
    if (level !== attrs['level']) attrs = { ...attrs, level };
  }
  const same =
    attrs === node.attrs &&
    children.length === node.childCount &&
    children.every((child, index) => child === node.child(index));
  return same ? node : node.type.create(attrs, Fragment.fromArray(children), node.marks);
}
