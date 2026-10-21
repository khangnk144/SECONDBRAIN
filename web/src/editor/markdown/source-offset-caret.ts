/**
 * Where the caret goes for an offset in the file (a template's `{{cursor}}`, F14.2). Inside a
 * supported block: the text position that matches it. On a blank line between blocks (where
 * every bundled template puts `{{cursor}}`): a new empty paragraph at that place. An empty
 * paragraph has no Markdown form, so it writes nothing until something is typed into it.
 * Elsewhere (front matter, a verbatim block): the start of the nearest editable block.
 */
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { MarkdownSnapshot } from './markdown-snapshot';

export type CaretTarget =
  /** A text position inside a block. */
  | { kind: 'text'; pos: number }
  /** Insert an empty paragraph at this position between top-level blocks; caret inside it. */
  | { kind: 'new-paragraph'; pos: number }
  /** The start of top-level block `index` (a whole atom block is selected). */
  | { kind: 'block'; index: number };

interface Unit {
  /**
   * One UTF-16 code unit of text, or null for an inline atom (a wikilink, an image). Every unit
   * takes one document position.
   */
  char: string | null;
  pos: number;
}

/**
 * Every UTF-16 code unit (and inline atom) of a block in document order, with its position. The
 * source is walked by UTF-16 unit too (offsets are UTF-16), so an emoji's two halves match one
 * by one and the characters after it still line up.
 */
function unitsOf(node: ProseMirrorNode, start: number): Unit[] {
  const units: Unit[] = [];
  node.descendants((child, offset) => {
    const pos = start + 1 + offset;
    if (child.isText) {
      const text = child.text ?? '';
      for (let i = 0; i < text.length; i += 1)
        units.push({ char: text[i] as string, pos: pos + i });
    } else if (child.type.name === 'hardBreak') units.push({ char: '\n', pos });
    else if (child.isInline) units.push({ char: null, pos });
    return true;
  });
  return units;
}

/**
 * Text position for `raw` (the block's source up to the offset), matching its UTF-16 units in
 * order against the block's text; Markdown syntax in between is skipped. Approximate by design: it
 * only places a caret.
 */
function textPosition(node: ProseMirrorNode, start: number, raw: string): number {
  const units = unitsOf(node, start);
  let k = 0;
  let afterLast = units[0]?.pos ?? start + 1;
  let skipped = '';
  for (let i = 0; i < raw.length && k < units.length; i += 1) {
    const unit = units[k] as Unit;
    const char = raw[i] as string;
    if (unit.char === null && (char === '[' || char === '!')) {
      // An inline atom: `[[…]]`/`![[…]]` ends at the next `]]`, an image `![…](…)` at `)`.
      const wikilink = raw.startsWith('[[', i) || raw.startsWith('![[', i);
      const close = raw.slice(i).search(wikilink ? /\]\]/ : /\)/);
      i = close === -1 ? raw.length : i + close + (wikilink ? 1 : 0);
    } else if (unit.char !== char) {
      skipped += char;
      continue;
    }
    afterLast = unit.pos + 1;
    skipped = '';
    k += 1;
  }
  // Past the end of a line, the caret belongs to the next one.
  return /\n/.test(skipped) && k < units.length ? (units[k] as Unit).pos : afterLast;
}

function editable(node: ProseMirrorNode): boolean {
  return node.type.name !== 'verbatimBlock' && !node.isAtom;
}

function nearestEditable(doc: ProseMirrorNode, index: number): number {
  for (let distance = 0; distance < doc.childCount; distance += 1) {
    for (const candidate of [index + distance, index - distance]) {
      if (candidate >= 0 && candidate < doc.childCount && editable(doc.child(candidate))) {
        return candidate;
      }
    }
  }
  return Math.min(index, doc.childCount - 1);
}

export function caretForSourceOffset(
  doc: ProseMirrorNode,
  snapshot: MarkdownSnapshot,
  offset: number,
): CaretTarget {
  const { blocks } = snapshot;
  // Only while the document still holds exactly the snapshot's blocks (right after a load).
  const exact =
    blocks.length > 0 &&
    blocks.length === doc.childCount &&
    blocks.every((block, index) => block.node === doc.child(index));
  if (!exact) {
    const only = doc.childCount === 1 ? doc.child(0) : null;
    if (only?.type.name === 'paragraph' && only.childCount === 0) return { kind: 'text', pos: 1 };
    return { kind: 'block', index: nearestEditable(doc, 0) };
  }
  const positions: number[] = [];
  const blockEnd = (index: number): CaretTarget => {
    const block = blocks[index]!;
    if (!editable(block.node)) return { kind: 'block', index: nearestEditable(doc, index) };
    return { kind: 'text', pos: textPosition(block.node, positions[index]!, block.source) };
  };
  /** An offset `into` characters into the text between blocks (before block `index`). */
  const inGap = (index: number, gap: string, into: number, pos: number): CaretTarget => {
    // On a line of its own (a blank line): a new paragraph there; else still the previous line.
    if (/\n/.test(gap.slice(0, into))) return { kind: 'new-paragraph', pos };
    return index > 0 ? blockEnd(index - 1) : { kind: 'block', index: nearestEditable(doc, 0) };
  };
  let at = (snapshot.bom ? 1 : 0) + snapshot.frontmatter.length;
  let pos = 0;
  if (offset < at) return { kind: 'block', index: nearestEditable(doc, 0) };
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index]!;
    positions.push(pos);
    const start = at + block.gap.length;
    if (offset < start) return inGap(index, block.gap, offset - at, pos);
    const end = start + block.source.length;
    if (offset <= end) {
      if (!editable(block.node)) return { kind: 'block', index: nearestEditable(doc, index) };
      const raw = block.source.slice(0, offset - start);
      return { kind: 'text', pos: textPosition(block.node, pos, raw) };
    }
    at = end;
    pos += block.node.nodeSize;
  }
  return inGap(blocks.length, snapshot.trailing, offset - at, pos);
}
