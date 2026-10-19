import { Node } from '@tiptap/core';

/**
 * A top-level Markdown block the editor cannot represent exactly (SPEC §4.9: headings 4–6, raw
 * HTML, math, footnotes, reference links, custom containers, …). `source` holds its Markdown with
 * `\n` line ends; an unchanged block is written back from the original file bytes, never from
 * `source`. It may only appear directly in the document (see `MarkdownDocument`).
 */
export const VerbatimBlock = Node.create({
  name: 'verbatimBlock',
  atom: true,
  selectable: true,
  defining: true,

  addAttributes() {
    return {
      source: { default: '' },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'pre[data-verbatim]',
        getAttrs: (element) => ({ source: element.textContent ?? '' }),
      },
    ];
  },

  renderHTML({ node }) {
    return ['pre', { 'data-verbatim': '' }, String(node.attrs['source'] ?? '')];
  },
});
