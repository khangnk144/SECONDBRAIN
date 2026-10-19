/**
 * Records the source layout of lists (items, markers, heads, child blocks) and block quotes next
 * to their editor nodes, so a later save can re-emit unchanged parts from their original lines,
 * patch a ticked checkbox in place, and serialise only what changed.
 */
import type { Blockquote, List, Nodes, RootContent } from 'mdast';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { ItemSource, ListSource, QuoteSource, SourceBlock } from './markdown-snapshot';

export interface SourceText {
  /** `\n`-only text the mdast offsets point into. */
  text: string;
  /** The same text with its original line endings. */
  original: string;
  toOriginal(offset: number): number;
}

export function originalSlice(source: SourceText, start: number, end: number): string {
  return source.original.slice(source.toOriginal(start), source.toOriginal(end));
}

/**
 * See `SourceBlock.prefix`. Tabs stay where they are: every other character becomes one space,
 * so a tab still reaches the same tab stop and the prefix ends at the same column.
 */
export function prefixAt(text: string, offset: number): string {
  const before = text.slice(text.lastIndexOf('\n', offset - 1) + 1, offset);
  return before.replace(/[^>\t]/g, ' ');
}

export function startOf(node: Nodes): number {
  return node.position?.start.offset ?? 0;
}

export function endOf(node: Nodes): number {
  return node.position?.end.offset ?? 0;
}

/** The list or quote structure of a converted block, or null for other blocks. */
export function containerSources(
  node: RootContent,
  editorNode: ProseMirrorNode,
  source: SourceText,
): Pick<SourceBlock, 'list' | 'quote'> {
  if (node.type === 'list') return { list: buildListSource(node, editorNode, source), quote: null };
  if (node.type === 'blockquote') {
    return { list: null, quote: buildQuoteSource(node, editorNode, source) };
  }
  return { list: null, quote: null };
}

/** Child blocks starting at `headEnd` (the first child may start later than its mdast node). */
function childSources(
  children: readonly RootContent[],
  parent: ProseMirrorNode,
  headEnd: number,
  source: SourceText,
): SourceBlock[] {
  const blocks: SourceBlock[] = [];
  let previousEnd = headEnd;
  children.forEach((child, index) => {
    const childNode = parent.child(index);
    const start = index === 0 ? headEnd : startOf(child);
    blocks.push({
      node: childNode,
      gap: index === 0 ? '' : originalSlice(source, previousEnd, start),
      source: originalSlice(source, start, endOf(child)),
      prefix: prefixAt(source.text, start),
      ...containerSources(child, childNode, source),
    });
    previousEnd = endOf(child);
  });
  return blocks;
}

function buildQuoteSource(
  quote: Blockquote,
  node: ProseMirrorNode,
  source: SourceText,
): QuoteSource {
  const first = quote.children[0];
  const last = quote.children[quote.children.length - 1];
  const headEnd = first ? startOf(first) : endOf(quote);
  return {
    head: originalSlice(source, startOf(quote), headEnd),
    children: childSources(quote.children, node, headEnd, source),
    tail: last ? originalSlice(source, endOf(last), endOf(quote)) : '',
  };
}

function buildListSource(list: List, node: ProseMirrorNode, source: SourceText): ListSource {
  const items: ItemSource[] = [];
  let previousEnd = -1;
  list.children.forEach((item, index) => {
    const itemNode = node.child(index);
    const start = startOf(item);
    const end = endOf(item);
    const first = item.children[0];
    const last = item.children[item.children.length - 1];
    const headEnd = itemHeadEnd(source.text, start, first ? startOf(first) : end, item.checked);
    items.push({
      node: itemNode,
      gap: index === 0 ? '' : originalSlice(source, previousEnd, start),
      head: originalSlice(source, start, headEnd),
      children: childSources(item.children, itemNode, headEnd, source),
      tail: last ? originalSlice(source, endOf(last), end) : '',
      prefix: prefixAt(source.text, start),
      number: list.ordered ? Number.parseInt(source.text.slice(start, headEnd), 10) : null,
    });
    previousEnd = end;
  });
  const firstHead = list.children[0]
    ? source.text.slice(startOf(list.children[0]), startOf(list.children[0]) + 12)
    : '';
  const numbers = items.map((item) => item.number ?? 0);
  return {
    ordered: Boolean(list.ordered),
    marker: list.ordered ? (/^\d+([.)])/.exec(firstHead)?.[1] ?? '.') : firstHead.charAt(0) || '-',
    incrementing: numbers.every((value, i) => value === (numbers[0] ?? 0) + i),
    items,
    tail: previousEnd < 0 ? '' : originalSlice(source, previousEnd, endOf(list)),
  };
}

// The parser starts a task's paragraph at the checkbox when the text begins with code or a link.
const TASK_HEAD = /(?:[-*+]|\d{1,9}[.)])[ \t]+\[[ xX]\][ \t]*/y;

/** End of an item's head: after the marker and, for a task, after its checkbox. */
function itemHeadEnd(
  text: string,
  start: number,
  childStart: number,
  checked: boolean | null | undefined,
): number {
  if (typeof checked !== 'boolean') return childStart;
  TASK_HEAD.lastIndex = start;
  const match = TASK_HEAD.exec(text);
  return match ? Math.max(childStart, start + match[0].length) : childStart;
}
