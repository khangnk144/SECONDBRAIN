/**
 * Supported mdast blocks → ProseMirror nodes. The mapping is exact: every field that affects
 * rendering has a home in the editor schema (`loose` for list spacing, cell `align` for GFM
 * alignment), and anything else (headings 4–6, HTML, code info beyond the language, mixed task
 * lists, ragged tables, …) throws `UnsupportedConstruct` so the caller keeps the block verbatim.
 */
import type { BlockContent, DefinitionContent, List, ListItem, RootContent, Table } from 'mdast';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { convertInline, nodeType, type InlineContext } from './mdast-inline-to-prosemirror';
import { UnsupportedConstruct } from './unsupported-constructs';

type FlowNode = RootContent | BlockContent | DefinitionContent;

export function convertBlock(node: FlowNode, context: InlineContext): ProseMirrorNode {
  const type = (name: string) => nodeType(context.schema, name);
  switch (node.type) {
    case 'paragraph':
      return type('paragraph').create(null, convertInline(node.children, context));
    case 'heading':
      if (node.depth > 3) throw new UnsupportedConstruct(`heading ${node.depth}`);
      return type('heading').create({ level: node.depth }, convertInline(node.children, context));
    case 'thematicBreak':
      return type('horizontalRule').create();
    case 'blockquote':
      return type('blockquote').create(null, convertFlow(node.children, context));
    case 'code':
      if (node.meta) throw new UnsupportedConstruct('code info string');
      return type('codeBlock').create(
        { language: node.lang ?? null },
        node.value === '' ? null : context.schema.text(node.value),
      );
    case 'list':
      return convertList(node, context);
    case 'table':
      return convertTable(node, context);
    default:
      throw new UnsupportedConstruct(node.type);
  }
}

/** Children of a container; an empty container holds one empty paragraph in the editor. */
function convertFlow(children: readonly FlowNode[], context: InlineContext): ProseMirrorNode[] {
  if (children.length === 0) return [nodeType(context.schema, 'paragraph').create()];
  return children.map((child) => convertBlock(child, context));
}

function convertList(node: List, context: InlineContext): ProseMirrorNode {
  const checks = node.children.map((item) => item.checked);
  const allTasks = checks.every((checked) => typeof checked === 'boolean');
  const noTasks = checks.every((checked) => checked === null || checked === undefined);
  if (!allTasks && !noTasks) throw new UnsupportedConstruct('mixed task list');
  if (allTasks && node.ordered) throw new UnsupportedConstruct('ordered task list');
  const loose = Boolean(node.spread) || node.children.some((item) => Boolean(item.spread));
  const itemType = allTasks ? 'taskItem' : 'listItem';
  const items = node.children.map((item) => convertItem(item, itemType, context));
  if (node.ordered) {
    return nodeType(context.schema, 'orderedList').create({ start: node.start ?? 1, loose }, items);
  }
  return nodeType(context.schema, allTasks ? 'taskList' : 'bulletList').create({ loose }, items);
}

function convertItem(item: ListItem, typeName: string, context: InlineContext): ProseMirrorNode {
  const first = item.children[0];
  if (first && first.type !== 'paragraph') throw new UnsupportedConstruct('item without paragraph');
  const attrs = typeName === 'taskItem' ? { checked: Boolean(item.checked) } : null;
  return nodeType(context.schema, typeName).create(attrs, convertFlow(item.children, context));
}

function convertTable(node: Table, context: InlineContext): ProseMirrorNode {
  const width = node.children[0]?.children.length ?? 0;
  if (width === 0 || node.children.some((row) => row.children.length !== width)) {
    throw new UnsupportedConstruct('ragged table');
  }
  const rows = node.children.map((row, rowIndex) =>
    nodeType(context.schema, 'tableRow').create(
      null,
      row.children.map((cell, column) =>
        nodeType(context.schema, rowIndex === 0 ? 'tableHeader' : 'tableCell').create(
          { align: node.align?.[column] ?? null },
          nodeType(context.schema, 'paragraph').create(null, convertInline(cell.children, context)),
        ),
      ),
    ),
  );
  return nodeType(context.schema, 'table').create(null, rows);
}
