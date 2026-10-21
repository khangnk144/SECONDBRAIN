/**
 * What she selected, as Markdown: the converter's own serializer applied to the selected slice, so
 * a feature that sends a selection somewhere (AI actions) sends what the file would hold for it.
 * Reading never changes the document.
 */
import { Fragment, type Node as ProseMirrorNode } from '@tiptap/pm/model';
import { NodeSelection, type EditorState } from '@tiptap/pm/state';
import { serializeBlock } from './markdown/markdown-serializer';
import { normalizeForMarkdown } from './markdown/save-normalize';

/** True when the selection holds something worth sending (not only blanks). */
export function hasMeaningfulSelection(state: EditorState): boolean {
  const { selection } = state;
  if (selection.empty) return false;
  if (selection instanceof NodeSelection) return true;
  return state.doc.textBetween(selection.from, selection.to, '\n', ' ').trim() !== '';
}

/**
 * The selection as Markdown. A selection inside one paragraph or heading gives its words (no
 * heading marks), one inside a code block its text, a selected verbatim block its source; a
 * selection across blocks gives those blocks cut to the selection, in canonical Markdown.
 */
export function selectionMarkdown(state: EditorState): string {
  const { selection, doc } = state;
  if (selection.empty) return '';
  if (selection instanceof NodeSelection && selection.node.type.name === 'verbatimBlock') {
    return String(selection.node.attrs['source'] ?? '');
  }
  const { from, to } = selection;
  const $from = doc.resolve(from);
  const depth = $from.sharedDepth(to);
  const shared = $from.node(depth);
  const start = $from.start(depth);
  const content = shared.content.cut(from - start, to - start);
  try {
    if (shared.isTextblock) {
      if (shared.type.spec.code) return doc.textBetween(from, to, '\n');
      const paragraph = state.schema.nodes['paragraph']!.create(null, content);
      return serializeBlock(normalizeForMarkdown(paragraph)).trim();
    }
    // Wrap the cut content back into its ancestors, up to the top-level block(s).
    let fragment = content;
    for (let d = depth; d > 0; d -= 1) fragment = Fragment.from($from.node(d).copy(fragment));
    return serializeBlocks(fragment);
  } catch {
    // A cut the serializer cannot hold (a ragged table slice): its plain text is still useful.
    return doc.textBetween(from, to, '\n\n', ' ').trim();
  }
}

function serializeBlocks(fragment: Fragment): string {
  const parts: string[] = [];
  fragment.forEach((node: ProseMirrorNode) => {
    const text = serializeBlock(normalizeForMarkdown(node)).trim();
    if (text !== '') parts.push(text);
  });
  return parts.join('\n\n');
}

/** The selected text as plain text (what a word diff compares against). */
export function selectionPlainText(state: EditorState): string {
  const { from, to } = state.selection;
  return state.doc.textBetween(from, to, '\n\n', ' ');
}
