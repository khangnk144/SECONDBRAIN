/**
 * The save check: the text written around a change is parsed again and must give back exactly
 * the expected blocks — same boundaries, same bytes for blocks written from their source, and
 * nodes equal to what the editor holds. Returns the parsed blocks (for the next snapshot) or null.
 */
import type { Node as ProseMirrorNode, Schema } from '@tiptap/pm/model';
import { parseBody } from './body-blocks';
import type { SourceBlock } from './markdown-snapshot';

export interface ExpectedBlock {
  /** The node the block must parse to. */
  node: ProseMirrorNode;
  gap: string;
  text: string;
}

export function verifyWindow(
  head: string,
  expected: readonly ExpectedBlock[],
  tail: string,
  schema: Schema,
  definitionsPrefix: string,
): SourceBlock[] | null {
  let window = '';
  expected.forEach((block, index) => {
    window += (index === 0 ? head : block.gap) + block.text;
  });
  window += tail;
  const parsed = parseBody(window, schema, definitionsPrefix);
  if (parsed.blocks.length !== expected.length || parsed.trailing !== tail) return null;
  for (let i = 0; i < expected.length; i += 1) {
    const want = expected[i] as ExpectedBlock;
    const got = parsed.blocks[i] as SourceBlock;
    if (got.source !== want.text || got.gap !== (i === 0 ? head : want.gap)) return null;
    if (!got.node.eq(want.node)) return null;
  }
  return parsed.blocks;
}
