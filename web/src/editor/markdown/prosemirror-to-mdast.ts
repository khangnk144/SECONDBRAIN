/**
 * ProseMirror blocks → mdast, the input of the canonical serializer. Empty paragraphs are
 * dropped (Markdown cannot hold them) unless a container would be left without any content.
 */
import type { AlignType, BlockContent, List, ListItem, RootContent, Table, TableCell } from 'mdast';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { toMdastPhrasing } from './prosemirror-inline-to-mdast';

/** A verbatim block written back from its source. */
export interface MdastLiteralBlock {
  type: 'literalBlock';
  value: string;
}

export function toMdastBlock(node: ProseMirrorNode): RootContent {
  const attrs = node.attrs;
  switch (node.type.name) {
    case 'paragraph':
      return { type: 'paragraph', children: toMdastPhrasing(node) };
    case 'heading':
      return {
        type: 'heading',
        depth: Math.min(Math.max(Number(attrs['level']) || 1, 1), 3) as 1 | 2 | 3,
        children: toMdastPhrasing(node),
      };
    case 'horizontalRule':
      return { type: 'thematicBreak' };
    case 'blockquote':
      return { type: 'blockquote', children: toMdastFlow(node) as BlockContent[] };
    case 'codeBlock':
      return {
        type: 'code',
        lang: (attrs['language'] as string | null) || null,
        meta: null,
        value: node.textContent,
      };
    case 'bulletList':
    case 'orderedList':
    case 'taskList':
      return toMdastList(node);
    case 'table':
      return toMdastTable(node);
    case 'verbatimBlock':
      return {
        type: 'literalBlock',
        value: String(attrs['source'] ?? ''),
      } as unknown as RootContent;
    default:
      return { type: 'paragraph', children: [{ type: 'text', value: node.textContent }] };
  }
}

/** Block children of a container, without the empty paragraphs Markdown cannot hold. */
export function flowChildren(node: ProseMirrorNode): ProseMirrorNode[] {
  const children: ProseMirrorNode[] = [];
  node.forEach((child) => {
    if (!isEmptyParagraph(child)) children.push(child);
  });
  return children;
}

export function isEmptyParagraph(node: ProseMirrorNode): boolean {
  return node.type.name === 'paragraph' && node.childCount === 0;
}

function toMdastFlow(node: ProseMirrorNode): RootContent[] {
  return flowChildren(node).map(toMdastBlock);
}

export function toMdastList(node: ProseMirrorNode): List {
  const loose = Boolean(node.attrs['loose']);
  const ordered = node.type.name === 'orderedList';
  const items: ListItem[] = [];
  node.forEach((item) => items.push(toMdastListItem(item, loose)));
  return {
    type: 'list',
    ordered,
    start: ordered ? Number(node.attrs['start']) || 0 : null,
    spread: loose,
    children: items,
  };
}

export function toMdastListItem(item: ProseMirrorNode, loose: boolean): ListItem {
  return {
    type: 'listItem',
    spread: loose,
    checked: item.type.name === 'taskItem' ? Boolean(item.attrs['checked']) : null,
    children: toMdastFlow(item) as BlockContent[],
  };
}

function toMdastTable(node: ProseMirrorNode): Table {
  const align: AlignType[] = [];
  node.firstChild?.forEach((cell) => align.push((cell.attrs['align'] as AlignType) ?? null));
  const rows: Table['children'] = [];
  node.forEach((row) => {
    const cells: TableCell[] = [];
    row.forEach((cell) => {
      const paragraph = cell.firstChild;
      cells.push({ type: 'tableCell', children: paragraph ? toMdastPhrasing(paragraph) : [] });
    });
    rows.push({ type: 'tableRow', children: cells });
  });
  return { type: 'table', align, children: rows };
}
