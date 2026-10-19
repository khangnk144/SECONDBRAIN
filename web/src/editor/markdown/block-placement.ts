/**
 * Places freshly serialised Markdown inside existing source: continuation lines get the line
 * prefix of the place the block starts at (indentation, quote markers), and line ends follow
 * the file.
 */
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { List } from 'mdast';
import type { Eol } from './line-endings';
import type { ListSource } from './markdown-snapshot';
import { serializeBlock, serializeMdast, type MarkerOptions } from './markdown-serializer';

/** A blank line under `prefix`: empty, or just the quote markers inside a block quote. */
export function blankLine(prefix: string): string {
  return prefix.trimEnd();
}

export function placeLines(lfText: string, prefix: string, eol: Eol): string {
  return lfText
    .split('\n')
    .map((line, index) => (index === 0 ? line : line === '' ? blankLine(prefix) : prefix + line))
    .join(eol);
}

/** Canonical Markdown of `node` placed at `prefix`; null when the prefix is unknown. */
export function serializeAt(
  node: ProseMirrorNode,
  prefix: string | null,
  eol: Eol,
  markers: MarkerOptions = {},
): string | null {
  return prefix === null ? null : placeLines(serializeBlock(node, markers), prefix, eol);
}

export function serializeListAt(
  list: List,
  prefix: string | null,
  eol: Eol,
  markers: MarkerOptions,
): string | null {
  return prefix === null ? null : placeLines(serializeMdast(list, markers), prefix, eol);
}

/** Marker options that keep a list's own bullet or delimiter. */
export function listMarkers(list: ListSource | null): MarkerOptions {
  if (!list) return {};
  if (list.ordered) return { bulletOrdered: list.marker === ')' ? ')' : '.' };
  const bullet = list.marker;
  return bullet === '*' || bullet === '+' || bullet === '-' ? { bullet } : {};
}
