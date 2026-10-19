// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { editorSchema } from '../schema/editor-schema';
import { corpus } from './__tests__/corpus-files';
import { parseBody } from './body-blocks';
import { loadMarkdown, saveMarkdownWithSnapshot } from './markdown-document';
import { serializeBlock } from './markdown-serializer';
import { isEmptyParagraph } from './prosemirror-to-mdast';
import { normalizeForMarkdown } from './save-normalize';

function supportedBlocks(doc: ProseMirrorNode): ProseMirrorNode[] {
  const blocks: ProseMirrorNode[] = [];
  doc.forEach((node) => {
    if (node.type.name !== 'verbatimBlock' && !isEmptyParagraph(node)) blocks.push(node);
  });
  return blocks;
}

describe('canonical serialisation re-parses to the same node (P3)', () => {
  it.each(corpus)('$name: every supported block', ({ content }) => {
    for (const node of supportedBlocks(loadMarkdown(content).doc)) {
      const text = serializeBlock(node);
      const parsed = parseBody(text, editorSchema);
      expect(parsed.blocks, text).toHaveLength(1);
      expect(parsed.blocks[0]!.node.eq(normalizeForMarkdown(node)), text).toBe(true);
    }
  });

  it.each(corpus)('$name: the whole document written canonically', ({ content }) => {
    const { doc, snapshot } = loadMarkdown(content);
    const canonical = saveMarkdownWithSnapshot(doc, {
      ...snapshot,
      bom: false,
      frontmatter: '',
      blocks: [],
      trailing: '',
      definitionsPrefix: '',
    });
    expect(canonical.exact, canonical.text).toBe(true);
    const reloaded = loadMarkdown(canonical.text).doc;
    expect(reloaded.eq(normalizeForMarkdown(doc)), canonical.text).toBe(true);
    // A second canonical pass changes nothing.
    const again = saveMarkdownWithSnapshot(reloaded, {
      ...snapshot,
      bom: false,
      frontmatter: '',
      blocks: [],
      trailing: '',
      definitionsPrefix: '',
    });
    expect(again.text).toBe(canonical.text);
  });
});
