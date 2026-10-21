/**
 * Puts the link the server returned for an uploaded file into the document, changing only the
 * block it lands in (SPEC §4.9 P2): on an empty line the link is the whole paragraph; dropped
 * between blocks (or at the start/end of a line, for later files of the same drop) it becomes a
 * new paragraph; inside text it goes inline with a separating space where one is missing.
 */
import type { Node as ProseMirrorNode, ResolvedPos } from '@tiptap/pm/model';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import { scanWikilinks } from '../markdown/wikilink-syntax';

export interface LinkInsertion {
  tr: Transaction;
  /** Position right after the inserted link (where a following file of the same drop goes). */
  after: number;
}

/** The `wikilink` node for `link` (`![[x.png]]`, `[[x.pdf]]`), or plain text when it is not one. */
export function linkNodeFor(state: EditorState, link: string): ProseMirrorNode {
  const [hit] = scanWikilinks(link, 0, link.length);
  const type = state.schema.nodes['wikilink'];
  if (!type || !hit || hit.start !== 0 || hit.end !== link.length) return state.schema.text(link);
  return type.create({
    target: hit.target,
    heading: hit.heading,
    alias: hit.alias,
    embed: hit.embed,
  });
}

/** Whether a drop or paste at `pos` should give the link a line of its own. */
export function wantsOwnLine(state: EditorState, pos: number): boolean {
  const $pos = state.doc.resolve(pos);
  return !$pos.parent.inlineContent || $pos.parent.content.size === 0;
}

export function buildLinkInsertion(
  state: EditorState,
  pos: number,
  link: string,
  ownLine: boolean,
): LinkInsertion | null {
  const node = linkNodeFor(state, link);
  const $pos = state.doc.resolve(Math.max(0, Math.min(pos, state.doc.content.size)));
  const parent = $pos.parent;
  const index = $pos.index();
  if (parent.inlineContent && parent.canReplaceWith(index, index, node.type)) {
    if (ownLine && parent.content.size === 0) {
      return insertAt(state, $pos.pos, [node], $pos.pos + node.nodeSize);
    }
    if (ownLine && $pos.depth === 1 && $pos.pos === $pos.end()) {
      return paragraphAt(state, $pos.after(), node);
    }
    if (ownLine && $pos.depth === 1 && $pos.pos === $pos.start()) {
      return paragraphAt(state, $pos.before(), node);
    }
    return inline(state, $pos, node);
  }
  // Between blocks, or inside a block that holds no links (a code block): a paragraph of its own.
  return paragraphAt(state, blockInsertPos(state, $pos), node);
}

function inline(state: EditorState, $pos: ResolvedPos, node: ProseMirrorNode): LinkInsertion {
  const space = state.schema.text(' ');
  const before = needsSpace($pos.nodeBefore, /\s$/);
  const after = needsSpace($pos.nodeAfter, /^\s/);
  const nodes = [...(before ? [space] : []), node, ...(after ? [space] : [])];
  return insertAt(state, $pos.pos, nodes, $pos.pos + (before ? 1 : 0) + node.nodeSize);
}

/** Text (or another inline node) touching the link without a space in between. */
function needsSpace(neighbour: ProseMirrorNode | null | undefined, blank: RegExp): boolean {
  if (!neighbour) return false;
  if (neighbour.isText) return !blank.test(neighbour.text ?? '');
  return neighbour.type.name !== 'hardBreak';
}

function insertAt(
  state: EditorState,
  pos: number,
  nodes: ProseMirrorNode[],
  after: number,
): LinkInsertion {
  return { tr: state.tr.insert(pos, nodes), after };
}

function paragraphAt(state: EditorState, pos: number, node: ProseMirrorNode): LinkInsertion | null {
  const paragraph = state.schema.nodes['paragraph']?.createAndFill(null, node);
  if (!paragraph) return null;
  const $at = state.doc.resolve(pos);
  if (!$at.parent.canReplaceWith($at.index(), $at.index(), paragraph.type)) return null;
  const tr = state.tr.insert(pos, paragraph);
  return { tr, after: pos + 1 + node.nodeSize };
}

/** `pos` when a paragraph fits there, else right after the top-level block around it. */
function blockInsertPos(state: EditorState, $pos: ResolvedPos): number {
  const paragraph = state.schema.nodes['paragraph'];
  const index = $pos.index();
  if (
    paragraph &&
    !$pos.parent.inlineContent &&
    $pos.parent.canReplaceWith(index, index, paragraph)
  ) {
    return $pos.pos;
  }
  return $pos.depth >= 1 ? $pos.after(1) : $pos.pos;
}
