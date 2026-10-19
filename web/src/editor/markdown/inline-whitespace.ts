/**
 * Whitespace Markdown cannot hold where the editor may have it: at the start or end of a
 * paragraph, heading or table cell, at the start of a line after a hard break, and at the inner
 * edge of a bold, italic or strike run ("**bold **"). Written as is, the serializer would have to
 * encode it (`a&#x20;`, `**bold&#x20;**&#x63;`). It is dropped at those edges and moved outside
 * the emphasis run otherwise. Spaces right before a hard break stay (`a \` keeps them). The
 * serializer and the save check both read inline content through this, so they agree.
 */
import type { Mark, Node as ProseMirrorNode } from '@tiptap/pm/model';

const EMPHASIS = new Set(['bold', 'italic', 'strike']);
const LEADING = /^[ \t]+/;
const TRAILING = /[ \t]+$/;

const isPlainText = (node: ProseMirrorNode | undefined): node is ProseMirrorNode =>
  node !== undefined && node.isText && !node.marks.some((mark) => mark.type.name === 'code');

function withText(node: ProseMirrorNode, text: string): ProseMirrorNode | null {
  return text === '' ? null : node.type.schema.text(text, node.marks);
}

/** Strips whitespace from the text nodes at one end of a run (stops at code or non-text). */
function trimEdge(nodes: ProseMirrorNode[], from: 'start' | 'end'): void {
  for (;;) {
    const index = from === 'start' ? 0 : nodes.length - 1;
    const node = nodes[index];
    if (!isPlainText(node)) return;
    const text = (node.text ?? '').replace(from === 'start' ? LEADING : TRAILING, '');
    if (text === node.text) return;
    const replacement = withText(node, text);
    if (replacement) {
      nodes[index] = replacement;
      return;
    }
    nodes.splice(index, 1);
  }
}

/**
 * Splits text at hard breaks and trims every line's start (Markdown strips a continuation line's
 * indentation) and the last line's end (and so the block's end).
 */
function trimLines(children: ProseMirrorNode[]): ProseMirrorNode[] {
  const out: ProseMirrorNode[] = [];
  let line: ProseMirrorNode[] = [];
  const closeLine = (last: boolean) => {
    trimEdge(line, 'start');
    if (last) trimEdge(line, 'end');
    out.push(...line);
    line = [];
  };
  for (const child of children) {
    if (child.type.name === 'hardBreak') {
      closeLine(false);
      out.push(child);
    } else line.push(child);
  }
  closeLine(true);
  return out;
}

const endingMarks = (node: ProseMirrorNode, neighbour: ProseMirrorNode | undefined): Mark[] =>
  node.marks.filter(
    (mark) => EMPHASIS.has(mark.type.name) && !(neighbour && mark.isInSet(neighbour.marks)),
  );

/** Moves whitespace at the inner edge of an emphasis run outside that run. */
function moveOutOfRuns(children: ProseMirrorNode[]): ProseMirrorNode[] {
  const out: ProseMirrorNode[] = [];
  children.forEach((node, index) => {
    if (!isPlainText(node)) {
      out.push(node);
      return;
    }
    const text = node.text ?? '';
    const closing = endingMarks(node, children[index + 1]);
    const opening = endingMarks(node, children[index - 1]);
    const lead = opening.length > 0 ? (LEADING.exec(text)?.[0] ?? '') : '';
    const rest = text.slice(lead.length);
    const trail = closing.length > 0 && rest !== '' ? (TRAILING.exec(rest)?.[0] ?? '') : '';
    const core = rest.slice(0, rest.length - trail.length);
    if (lead === '' && trail === '') {
      out.push(node);
      return;
    }
    const schema = node.type.schema;
    const without = (marks: Mark[]) => node.marks.filter((mark) => !marks.includes(mark));
    if (lead) out.push(schema.text(lead, without(opening)));
    if (core) out.push(schema.text(core, node.marks));
    if (trail) out.push(schema.text(trail, without(closing)));
  });
  return out;
}

export function tidyInlineWhitespace(children: ProseMirrorNode[]): ProseMirrorNode[] {
  return trimLines(moveOutOfRuns(children));
}
