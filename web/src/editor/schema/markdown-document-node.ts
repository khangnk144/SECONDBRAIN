import { Node } from '@tiptap/core';

/**
 * The document node. Verbatim blocks are allowed only here (not inside lists, quotes or cells),
 * so wrapping or moving commands can never nest an unsupported block inside a supported one.
 */
export const MarkdownDocument = Node.create({
  name: 'doc',
  topNode: true,
  content: '(block | verbatimBlock)+',
});
