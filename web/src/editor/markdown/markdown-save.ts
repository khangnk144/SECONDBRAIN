/**
 * Saving: unchanged top-level blocks are written from their original bytes; every region around a
 * change (edited, new or moved blocks, deletions) is written and then checked by parsing it again
 * together with one unchanged neighbour on each side (see save-region-resolution). When a region
 * cannot be written so that it checks, the canonical text is written unchecked (`exact: false`)
 * and the snapshot comes from a full parse.
 */
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { parseBody } from './body-blocks';
import { matchBlocks } from './block-matching';
import { splitFrontmatter } from './frontmatter-split';
import type { MarkdownSnapshot, SourceBlock } from './markdown-snapshot';
import { isEmptyParagraph } from './prosemirror-to-mdast';
import { planPieces } from './save-pieces';
import { resolveRegion, tailAfter, verifyRegion } from './save-region-resolution';
import { saveRegions } from './save-regions';
import { refreshedDefinitions } from './definitions-prefix';

export interface SaveResult {
  text: string;
  snapshot: MarkdownSnapshot;
  /**
   * True when every changed region re-parsed to exactly the editor's content. False means some
   * edited content has no exact Markdown form; it was written canonically (nothing dropped) and
   * the snapshot comes from a full parse of the written text.
   */
  exact: boolean;
}

export function saveDocument(doc: ProseMirrorNode, snapshot: MarkdownSnapshot): SaveResult {
  const nodes: ProseMirrorNode[] = [];
  doc.forEach((node) => {
    if (!isEmptyParagraph(node)) nodes.push(node);
  });
  const head = (snapshot.bom ? '\uFEFF' : '') + snapshot.frontmatter;
  if (nodes.length === 0) {
    const body = snapshot.blocks.length === 0 ? snapshot.trailing : '';
    return finish(head, body, snapshot, null, true);
  }
  const matches = matchBlocks(
    nodes,
    snapshot.blocks.map((block) => block.node),
  );
  const pieces = planPieces(nodes, matches, snapshot);
  const parsed: Array<SourceBlock | null> = pieces.map((piece) =>
    piece.match.kind === 'same' ? (piece.original as SourceBlock) : null,
  );
  let verified = true;
  const regions = saveRegions(matches, snapshot.blocks.length);
  const tails: string[] = [];
  for (const [from, to] of regions) {
    const blocks = resolveRegion(pieces, from, to, snapshot);
    tails.push(tailAfter(pieces, to, snapshot));
    if (blocks) blocks.forEach((block, k) => (parsed[from + k] = block));
    else verified = false;
  }
  // A region's check reads the gap after its right neighbour; when the next region changed that
  // gap, the region is checked again with the final text.
  regions.forEach(([from, to], r) => {
    if (verified && tailAfter(pieces, to, snapshot) !== tails[r]) {
      verified = verifyRegion(pieces, from, to, snapshot) !== null;
    }
  });
  let body = '';
  for (const piece of pieces) body += piece.gap + piece.text;
  body += snapshot.trailing;
  // A body must never start to read as front matter (e.g. a block moved to the top).
  if (snapshot.frontmatter === '' && splitFrontmatter(head + body).raw !== null) {
    return finish(head, snapshot.eol + body, snapshot, null, false);
  }
  if (!verified) return finish(head, body, snapshot, null, false);
  const blocks = parsed.map((block, index) =>
    block && block.gap !== pieces[index]?.gap ? { ...block, gap: pieces[index]!.gap } : block,
  ) as SourceBlock[];
  return finish(head, body, snapshot, blocks, true);
}

function finish(
  head: string,
  body: string,
  snapshot: MarkdownSnapshot,
  blocks: SourceBlock[] | null,
  exact: boolean,
): SaveResult {
  if (blocks) {
    const definitionsPrefix = refreshedDefinitions(snapshot, blocks);
    return { text: head + body, snapshot: { ...snapshot, blocks, definitionsPrefix }, exact };
  }
  const reparsed = parseBody(body, snapshot.schema);
  return {
    text: head + body,
    exact,
    snapshot: {
      ...snapshot,
      blocks: reparsed.blocks,
      trailing: reparsed.trailing,
      definitionsPrefix: reparsed.definitionsPrefix,
    },
  };
}
