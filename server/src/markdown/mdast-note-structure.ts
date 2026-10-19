/**
 * Note structure from a full CommonMark + GFM parse (remark). This is the reference semantics:
 * the fast line scanner must produce the same structure, and falls back to this function for
 * the one thing it does not model (named character references outside its table).
 * The front matter is cut off beforehand, so only the body is parsed.
 */
import type { Nodes, Root, RootContent } from 'mdast';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import type { NoteStructure, TextSpan } from './note-structure-types.js';
import { mergeSpans } from './note-structure-types.js';
import { PlainTextBuilder } from './plain-text-builder.js';

const processor = unified().use(remarkParse).use(remarkGfm).freeze();

// From a list item's start to the `[` of its checkbox (the check is the first content).
const CHECKBOX_FROM_ITEM = /[ \t]*(?:[-*+]|\d{1,9}[.)])[\s>]*\[/y;

export function mdastNoteStructure(content: string, bodyStart: number): NoteStructure {
  const tree = processor.parse(content.slice(bodyStart)) as Root;
  const structure: NoteStructure = { excluded: [], links: [], tasks: [], headings: [], blocks: [] };
  const span = (node: Nodes): TextSpan => ({
    start: bodyStart + (node.position?.start.offset ?? 0),
    end: bodyStart + (node.position?.end.offset ?? 0),
  });

  const visit = (node: Nodes): void => {
    switch (node.type) {
      case 'code':
      case 'inlineCode':
      case 'html':
        structure.excluded.push(span(node));
        return;
      case 'link':
      case 'image':
        structure.links.push({ ...span(node), url: node.url });
        break;
      case 'heading':
        structure.headings.push({
          depth: node.depth,
          start: span(node).start,
          text: inlineText(node),
        });
        break;
      case 'listItem':
        if (typeof node.checked === 'boolean') {
          CHECKBOX_FROM_ITEM.lastIndex = span(node).start;
          const match = CHECKBOX_FROM_ITEM.exec(content);
          if (match) {
            structure.tasks.push({
              checkbox: match.index + match[0].length - 1,
              checked: node.checked,
            });
          }
        }
        break;
      default:
        break;
    }
    if ('children' in node) for (const child of node.children) visit(child);
  };

  visit(tree);
  for (const child of tree.children) collectBlocks(child, structure.blocks);
  structure.excluded = mergeSpans(structure.excluded);
  return structure;
}

/** Text content of inline nodes: code kept, HTML dropped, images contribute their alt text. */
function inlineText(node: Nodes): string {
  const builder = new PlainTextBuilder();
  appendInline(node, builder);
  return builder.take();
}

function appendInline(node: Nodes, builder: PlainTextBuilder): void {
  switch (node.type) {
    case 'text':
      builder.text(node.value);
      return;
    case 'inlineCode':
      builder.code(node.value);
      return;
    case 'break':
      builder.text('\n');
      return;
    case 'html':
    case 'footnoteReference':
      return;
    case 'image':
    case 'imageReference':
      builder.text(node.alt ?? '');
      return;
    default:
      if ('children' in node) for (const child of node.children) appendInline(child, builder);
  }
}

function collectBlocks(node: RootContent, out: string[]): void {
  switch (node.type) {
    case 'paragraph':
    case 'heading':
      out.push(inlineText(node));
      return;
    case 'code':
      out.push(node.value);
      return;
    case 'html':
      out.push(htmlText(node.value));
      return;
    case 'table':
      for (const row of node.children) {
        out.push(row.children.map((cell) => inlineText(cell)).join(' '));
      }
      return;
    case 'thematicBreak':
    case 'definition':
      return;
    default:
      if ('children' in node) for (const child of node.children) collectBlocks(child, out);
  }
}

/** Readable text of a raw HTML block: comments and tags removed. */
export function htmlText(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .trim();
}
