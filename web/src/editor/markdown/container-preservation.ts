/**
 * Saving an edited list or block quote without touching what did not change. Items and child
 * blocks equal to an original are written from their original lines; a changed item keeps its
 * own marker line and unchanged children (fine-grained mode: a ticked checkbox and a done token
 * are text patches, nested lists and quotes recurse); only what really changed is serialised,
 * with the list's own marker and the line prefix of its place. Each function returns null when
 * the structure cannot be kept this way; the caller then serialises the whole block.
 */
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { blankLine, listMarkers, serializeAt, serializeListAt } from './block-placement';
import { matchBlocks, type BlockMatch } from './block-matching';
import type { Eol } from './line-endings';
import { containerSource, type ItemSource, type SourceBlock } from './markdown-snapshot';
import { toMdastListItem } from './prosemirror-to-mdast';
import { patchCheckbox, patchDoneToken, patchItemNumber } from './task-tick-patch';

export interface PreserveOptions {
  eol: Eol;
  /** Patch and recurse into changed items instead of re-serialising them whole. */
  fineGrained: boolean;
}

interface ChildLayout {
  /** New children are separated by a blank line. */
  blank: boolean;
  /** Line prefix for new children (null: unknown, so new children cannot be placed). */
  prefix: string | null;
  /** The first child is a task's text (a done token may be patched in). */
  taskText: boolean;
}

export function serializePreservedQuote(
  node: ProseMirrorNode,
  original: SourceBlock,
  options: PreserveOptions,
): string | null {
  const quote = original.quote;
  if (!quote || quote.children.length === 0 || node.type !== original.node.type) return null;
  const layout = { blank: true, prefix: quote.children[0]!.prefix, taskText: false };
  const body = preservedChildren(node, quote.children, options, layout);
  return body === null ? null : quote.head + body + quote.tail;
}

export function serializePreservedList(
  node: ProseMirrorNode,
  original: SourceBlock,
  options: PreserveOptions,
): string | null {
  const source = original.list;
  const prefix = source?.items[0]?.prefix ?? null;
  if (!source || prefix === null || node.type !== original.node.type) return null;
  const loose = Boolean(node.attrs['loose']);
  if (loose !== Boolean(original.node.attrs['loose'])) return null;
  const items: ProseMirrorNode[] = [];
  node.forEach((item) => items.push(item));
  const matches = matchBlocks(
    items,
    source.items.map((item) => item.node),
  );
  const start = Number(node.attrs['start']) || 0;
  let out = '';
  for (let k = 0; k < items.length; k += 1) {
    const item = items[k] as ProseMirrorNode;
    const match = matches[k] as BlockMatch;
    const index = match.kind === 'changed' ? match.replaces : match.original;
    const originalItem = index === null ? null : (source.items[index] ?? null);
    const number = source.ordered ? (source.incrementing ? start + k : start) : null;
    if (k > 0) {
      out +=
        originalItem && index !== 0 && match.kind !== 'moved'
          ? originalItem.gap
          : options.eol + (loose ? blankLine(prefix) + options.eol : '') + prefix;
    }
    const firstNumber = k === 0 ? number : null;
    const text =
      itemText(item, match, originalItem, { firstNumber, loose }, options) ??
      serializeListAt(
        {
          type: 'list',
          ordered: source.ordered,
          start: number,
          spread: loose,
          children: [toMdastListItem(item, loose)],
        },
        prefix,
        options.eol,
        listMarkers(source),
      );
    if (text === null) return null;
    out += text;
  }
  return out + source.tail;
}

/** An item written from its original source, patched or recursed into; null to re-serialise. */
function itemText(
  item: ProseMirrorNode,
  match: BlockMatch,
  original: ItemSource | null,
  list: { firstNumber: number | null; loose: boolean },
  options: PreserveOptions,
): string | null {
  if (!original) return null;
  const { firstNumber } = list;
  let head: string | null = original.head;
  if (firstNumber !== null && original.number !== firstNumber)
    head = patchItemNumber(head, firstNumber);
  if (match.kind !== 'changed') {
    return head === null ? null : head + containerSource(original).slice(original.head.length);
  }
  if (!options.fineGrained || item.type !== original.node.type || original.children.length === 0) {
    return null;
  }
  if (
    head !== null &&
    item.type.name === 'taskItem' &&
    item.attrs['checked'] !== original.node.attrs['checked']
  ) {
    head = patchCheckbox(head, Boolean(item.attrs['checked']));
  }
  if (head === null || original.prefix === null) return null;
  const layout: ChildLayout = {
    blank: list.loose,
    prefix:
      original.children[1]?.prefix ?? original.prefix + ' '.repeat(markerWidth(original.head) + 1),
    taskText: item.type.name === 'taskItem',
  };
  const body = preservedChildren(item, original.children, options, layout);
  return body === null ? null : head + body + original.tail;
}

/** The children of a changed container, child by child. */
function preservedChildren(
  parent: ProseMirrorNode,
  originals: readonly SourceBlock[],
  options: PreserveOptions,
  layout: ChildLayout,
): string | null {
  const children: ProseMirrorNode[] = [];
  parent.forEach((child) => children.push(child));
  const matches = matchBlocks(
    children,
    originals.map((child) => child.node),
  );
  let out = '';
  for (let k = 0; k < children.length; k += 1) {
    const child = children[k] as ProseMirrorNode;
    const match = matches[k] as BlockMatch;
    const index = match.kind === 'changed' ? match.replaces : match.original;
    const original = index === null ? null : (originals[index] ?? null);
    if (k === 0 && index !== 0) return null;
    if (k > 0) {
      if (original && index !== 0 && match.kind !== 'moved') out += original.gap;
      else if (layout.prefix === null) return null;
      else
        out +=
          options.eol +
          (layout.blank ? blankLine(layout.prefix) + options.eol : '') +
          layout.prefix;
    }
    const text =
      childText(child, match, original, k === 0 && layout.taskText, options) ??
      serializeAt(
        child,
        original?.prefix ?? layout.prefix,
        options.eol,
        listMarkers(original?.list ?? null),
      );
    if (text === null) return null;
    out += text;
  }
  return out;
}

function childText(
  child: ProseMirrorNode,
  match: BlockMatch,
  original: SourceBlock | null,
  taskText: boolean,
  options: PreserveOptions,
): string | null {
  if (!original) return null;
  if (match.kind !== 'changed') return original.source;
  if (!options.fineGrained) return null;
  if (original.list) return serializePreservedList(child, original, options);
  if (original.quote) return serializePreservedQuote(child, original, options);
  if (taskText && child.type.name === 'paragraph') return patchDoneToken(original, child);
  return null;
}

function markerWidth(head: string): number {
  return /^(?:\d+[.)]|[-*+])/.exec(head)?.[0].length ?? 1;
}
