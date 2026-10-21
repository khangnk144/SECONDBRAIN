/**
 * ProseMirror inline content (flat text with marks) → nested mdast phrasing. Marks that stay
 * open across the next nodes are kept as the outer containers; on a tie the canonical nesting is
 * link, underline, strike, bold, italic (outside in), so `<u>` sits outside emphasis and its tags
 * never touch a `*` run from the inside. Things Markdown cannot express are
 * dropped here and by `normalizeForMarkdown` alike: a code mark on an image or a hard break, a
 * code or link mark on a wikilink, and hard breaks at the end of a paragraph, heading or cell.
 */
import type { Emphasis, Link, PhrasingContent, Strong, Delete } from 'mdast';
import type { Mark, Node as ProseMirrorNode } from '@tiptap/pm/model';
import { tidyInlineWhitespace } from './inline-whitespace';

/** A wikilink, emitted raw by the serializer. */
export interface MdastWikilink {
  type: 'wikilink';
  target: string;
  heading: string | null;
  alias: string | null;
  embed: boolean;
}

/** Raw Markdown emitted as is. */
export interface MdastLiteral {
  type: 'literal';
  value: string;
}

/** Underlined phrasing, written `<u>…</u>` by the serializer. */
export interface MdastUnderline {
  type: 'underline';
  children: Phrasing[];
}

type Phrasing = PhrasingContent | MdastWikilink | MdastLiteral | MdastUnderline;
type Container = { children: Phrasing[] };
const ORDER = ['link', 'underline', 'strike', 'bold', 'italic'];

/** The marks a Markdown serialisation keeps for this inline node. */
export function keptMarks(node: ProseMirrorNode): readonly Mark[] {
  const allowed =
    node.type.name === 'wikilink'
      ? ['underline', 'strike', 'bold', 'italic']
      : node.isText
        ? [...ORDER, 'code']
        : ORDER;
  return node.marks.filter((mark) => allowed.includes(mark.type.name));
}

/**
 * Inline children as Markdown can hold them: no trailing hard breaks (Markdown has no hard break
 * at a line end) and no whitespace it would have to encode (see inline-whitespace.ts).
 */
export function inlineChildren(parent: ProseMirrorNode): ProseMirrorNode[] {
  let children: ProseMirrorNode[] = [];
  parent.forEach((child) => children.push(child));
  children = tidyInlineWhitespace(children);
  while (children.length > 0 && children[children.length - 1]?.type.name === 'hardBreak') {
    children.pop();
    children = tidyInlineWhitespace(children);
  }
  return children;
}

export function toMdastPhrasing(parent: ProseMirrorNode): PhrasingContent[] {
  const root: Container = { children: [] };
  const stack: Array<{ mark: Mark; container: Container }> = [];
  const children = inlineChildren(parent);
  children.forEach((child, index) => {
    const marks = keptMarks(child).filter((mark) => mark.type.name !== 'code');
    let keep = 0;
    while (keep < stack.length && marks.some((mark) => mark.eq(stack[keep]!.mark))) keep += 1;
    stack.length = keep;
    const opening = marks
      .filter((mark) => !stack.some((open) => open.mark.eq(mark)))
      .sort(
        (a, b) =>
          runLength(children, index, b) - runLength(children, index, a) || rank(a) - rank(b),
      );
    for (const mark of opening) {
      const container = markContainer(mark);
      (stack[stack.length - 1]?.container ?? root).children.push(container as Phrasing);
      stack.push({ mark, container });
    }
    const target = stack[stack.length - 1]?.container ?? root;
    appendLeaf(target, child);
  });
  return root.children as PhrasingContent[];
}

function appendLeaf(target: Container, node: ProseMirrorNode): void {
  if (node.isText) {
    const isCode = keptMarks(node).some((mark) => mark.type.name === 'code');
    target.children.push(
      isCode
        ? { type: 'inlineCode', value: node.text ?? '' }
        : { type: 'text', value: node.text ?? '' },
    );
    return;
  }
  const attrs = node.attrs;
  switch (node.type.name) {
    case 'hardBreak':
      target.children.push({ type: 'break' });
      return;
    case 'image':
      target.children.push({
        type: 'image',
        url: String(attrs['src'] ?? ''),
        alt: (attrs['alt'] as string | null) ?? '',
        title: (attrs['title'] as string | null) || null,
      });
      return;
    case 'wikilink': {
      const previous = target.children[target.children.length - 1];
      // `!` right before a link would turn it into an embed: write it as a character reference.
      if (!attrs['embed'] && previous?.type === 'text' && previous.value.endsWith('!')) {
        previous.value = previous.value.slice(0, -1);
        if (previous.value === '') target.children.pop();
        target.children.push({ type: 'literal', value: '&#33;' });
      }
      target.children.push({
        type: 'wikilink',
        target: String(attrs['target'] ?? ''),
        heading: (attrs['heading'] as string | null) ?? null,
        alias: (attrs['alias'] as string | null) ?? null,
        embed: Boolean(attrs['embed']),
      });
      return;
    }
    default:
      target.children.push({ type: 'text', value: node.textContent });
  }
}

function markContainer(
  mark: Mark,
): ((Emphasis | Strong | Delete | Link) & Container) | MdastUnderline {
  switch (mark.type.name) {
    case 'underline':
      return { type: 'underline', children: [] };
    case 'bold':
      return { type: 'strong', children: [] } as Strong & Container;
    case 'strike':
      return { type: 'delete', children: [] } as Delete & Container;
    case 'link':
      return {
        type: 'link',
        url: String(mark.attrs['href'] ?? ''),
        title: (mark.attrs['title'] as string | null) || null,
        children: [],
      } as Link & Container;
    default:
      return { type: 'emphasis', children: [] } as Emphasis & Container;
  }
}

function rank(mark: Mark): number {
  return ORDER.indexOf(mark.type.name);
}

/** How many nodes from `index` on carry `mark` (marks that last longer go outside). */
function runLength(children: readonly ProseMirrorNode[], index: number, mark: Mark): number {
  let end = index;
  while (end < children.length && keptMarks(children[end]!).some((m) => m.eq(mark))) end += 1;
  return end - index;
}
