/**
 * A note made from a template starts with `# {{title}}` filled with the default name ("Ghi chú
 * mới"). When the owner names the new note, that heading takes the new name too, as an ordinary
 * edit: it goes through the editor (undo works) and is saved like typing.
 */
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { MarkdownEditorHandle } from '../../editor/markdown-editor';

/** The first top-level heading's text range, when it reads the old title (or its base name). */
export function titleHeadingRange(
  doc: ProseMirrorNode,
  oldTitle: string,
): { from: number; to: number } | null {
  // `unique` names add " 2", " 3"…; the template was filled with the name asked for.
  const names = new Set([oldTitle, oldTitle.replace(/ \d+$/, '')]);
  let pos = 0;
  for (let index = 0; index < doc.childCount; index += 1) {
    const node = doc.child(index);
    if (node.type.name === 'heading') {
      let plain = true;
      node.forEach((child) => {
        if (!child.isText || child.marks.length > 0) plain = false;
      });
      return plain && names.has(node.textContent)
        ? { from: pos + 1, to: pos + 1 + node.content.size }
        : null;
    }
    pos += node.nodeSize;
  }
  return null;
}

/** Returns true when the heading was changed (an undoable edit the session saves like typing). */
export function retitleFirstHeading(
  handle: MarkdownEditorHandle,
  oldTitle: string,
  newTitle: string,
): boolean {
  if (oldTitle === newTitle) return false;
  const range = titleHeadingRange(handle.getDoc(), oldTitle);
  if (!range) return false;
  return handle.edit((state) => state.tr.insertText(newTitle, range.from, range.to));
}
