import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { isEmptyParagraph } from '../../editor/markdown/prosemirror-to-mdast';

/**
 * The two documents hold the same top-level blocks (the same objects, in order) once empty
 * paragraphs are left out. Saving skips top-level empty paragraphs, so such documents write the
 * same text.
 */
export function sameWithoutEmptyParagraphs(a: ProseMirrorNode, b: ProseMirrorNode): boolean {
  const kept = (doc: ProseMirrorNode) => {
    const nodes: ProseMirrorNode[] = [];
    doc.forEach((node) => {
      if (!isEmptyParagraph(node)) nodes.push(node);
    });
    return nodes;
  };
  const left = kept(a);
  const right = kept(b);
  return left.length === right.length && left.every((node, index) => node === right[index]);
}
