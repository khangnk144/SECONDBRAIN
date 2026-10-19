/**
 * Splits a parsed body into top-level blocks: each with its original bytes, the bytes before it,
 * and its editor node — a supported node when the mapping is exact, otherwise a verbatim block.
 * Custom containers (`:::` … `:::`) and display math (`$$` … `$$`) that span several Markdown
 * blocks become one verbatim block.
 */
import type { Nodes, Root, RootContent } from 'mdast';
import type { Node as ProseMirrorNode, Schema } from '@tiptap/pm/model';
import { convertBlock } from './mdast-to-prosemirror';
import type { InlineContext } from './mdast-inline-to-prosemirror';
import type { SourceBlock } from './markdown-snapshot';
import {
  containerSources,
  endOf,
  originalSlice,
  prefixAt,
  startOf,
  type SourceText,
} from './container-source';
import {
  containsMath,
  containsNul,
  containsCallout,
  maskedBlockSource,
  UnsupportedConstruct,
} from './unsupported-constructs';
import { scanWikilinks, type WikilinkHit } from './wikilink-syntax';

export interface TopLevelBlocks {
  blocks: SourceBlock[];
  trailing: string;
}

interface Group {
  start: number;
  end: number;
  /** The single mdast block of the group, or null when the group must stay verbatim. */
  node: RootContent | null;
}

export function buildTopLevelBlocks(
  root: Root,
  source: SourceText,
  schema: Schema,
): TopLevelBlocks {
  const blocks: SourceBlock[] = [];
  let previousEnd = 0;
  for (const group of groupBlocks(root.children, source.text)) {
    // Gaps hold only whitespace; anything else (never seen in practice) joins the block verbatim.
    const gapText = source.text.slice(previousEnd, group.start);
    const stray = gapText.search(/\S/);
    const start = stray === -1 ? group.start : previousEnd + stray;
    const node = stray === -1 ? group.node : null;
    const editorNode = node ? convertTopLevel(node, source, schema) : null;
    // A verbatim block never ends with blank lines (some blocks absorb them): they belong to
    // the gap after it, so its `source` is the same wherever the block is written.
    const end = editorNode
      ? group.end
      : start + source.text.slice(start, group.end).replace(/[ \t\n]+$/, '').length;
    blocks.push({
      node: editorNode ?? verbatim(schema, source.text.slice(start, end)),
      gap: originalSlice(source, previousEnd, start),
      source: originalSlice(source, start, end),
      prefix: prefixAt(source.text, start),
      ...(editorNode && node
        ? containerSources(node, editorNode, source)
        : { list: null, quote: null }),
    });
    previousEnd = end;
  }
  return { blocks, trailing: originalSlice(source, previousEnd, source.text.length) };
}

export function verbatim(schema: Schema, lfSource: string): ProseMirrorNode {
  return schema.nodes['verbatimBlock']!.create({ source: lfSource });
}

function convertTopLevel(
  node: RootContent,
  source: SourceText,
  schema: Schema,
): ProseMirrorNode | null {
  const raw = source.text.slice(startOf(node), endOf(node));
  if (containsNul(raw)) return null;
  const masked = maskedBlockSource(source.text, node);
  if (containsMath(masked)) return null;
  if (containsCallout(source.text, node)) return null;
  const context: InlineContext = {
    schema,
    text: source.text,
    hits: blockWikilinks(source.text, node),
    claimed: new Set(),
  };
  try {
    const converted = convertBlock(node, context);
    converted.check();
    return context.claimed.size === context.hits.length ? converted : null;
  } catch (error) {
    if (error instanceof UnsupportedConstruct || error instanceof RangeError) return null;
    throw error;
  }
}

/** Wikilinks the server's raw scan finds in the block: outside code, inline code and HTML. */
function blockWikilinks(text: string, node: Nodes): WikilinkHit[] {
  const excluded: Array<[number, number]> = [];
  const collect = (inner: Nodes): void => {
    if (inner.type === 'code' || inner.type === 'inlineCode' || inner.type === 'html') {
      excluded.push([startOf(inner), endOf(inner)]);
      return;
    }
    if ('children' in inner) for (const child of inner.children) collect(child);
  };
  collect(node);
  const hits: WikilinkHit[] = [];
  let from = startOf(node);
  for (const [start, end] of excluded) {
    if (start > from) hits.push(...scanWikilinks(text, from, start));
    from = Math.max(from, end);
  }
  hits.push(...scanWikilinks(text, from, endOf(node)));
  return hits;
}

const CONTAINER_OPEN = /^ {0,3}:{3,}/;
const CONTAINER_CLOSE = /^ {0,3}:{3,}[ \t]*$/;
const MATH_OPEN = /^ {0,3}\$\$/;

function groupBlocks(children: readonly RootContent[], text: string): Group[] {
  const groups: Group[] = [];
  const raw = (index: number): string => {
    const child = children[index] as RootContent;
    return text.slice(startOf(child), endOf(child));
  };
  for (let i = 0; i < children.length; i += 1) {
    const first = raw(i);
    let last = i;
    let forced = false;
    if (CONTAINER_OPEN.test(first)) {
      forced = true;
      const closes = (j: number): boolean =>
        CONTAINER_CLOSE.test(lastLine(raw(j))) && (j > i || first.includes('\n'));
      for (let j = i; j < children.length; j += 1)
        if (closes(j)) {
          last = j;
          break;
        }
    } else if (MATH_OPEN.test(first) && !first.slice(first.indexOf('$$') + 2).includes('$$')) {
      forced = true;
      for (let j = i + 1; j < children.length; j += 1)
        if (raw(j).includes('$$')) {
          last = j;
          break;
        }
    }
    const start = startOf(children[i] as RootContent);
    const end = endOf(children[last] as RootContent);
    groups.push({ start, end, node: forced ? null : (children[i] as RootContent) });
    i = last;
  }
  return groups;
}

function lastLine(value: string): string {
  return value.slice(value.lastIndexOf('\n') + 1);
}
