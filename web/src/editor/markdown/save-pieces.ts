/**
 * The pieces of a save: one per top-level editor node, each with the bytes to write before it
 * (gap) and for it (text). Unchanged blocks keep their original bytes; changed blocks get text at
 * a chosen preservation level: 0 = keep unchanged list items and quote children, patch ticks and
 * recurse; 1 = keep unchanged items and children only; 2 = serialise the whole block canonically.
 */
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { BlockMatch } from './block-matching';
import { listMarkers, placeLines } from './block-placement';
import { withEol, type Eol } from './line-endings';
import type { MarkdownSnapshot, SourceBlock } from './markdown-snapshot';
import { serializeBlock, type MarkerOptions } from './markdown-serializer';
import { serializePreservedList, serializePreservedQuote } from './container-preservation';

export type Level = 0 | 1 | 2;

export interface Piece {
  node: ProseMirrorNode;
  match: BlockMatch;
  /** The original block this piece is written from or replaces. */
  original: SourceBlock | null;
  gap: string;
  text: string;
}

const LIST_NAMES = new Set(['bulletList', 'orderedList', 'taskList']);

export function planPieces(
  nodes: readonly ProseMirrorNode[],
  matches: readonly BlockMatch[],
  snapshot: MarkdownSnapshot,
): Piece[] {
  const originals = snapshot.blocks;
  const blank = snapshot.eol + snapshot.eol;
  return nodes.map((node, index) => {
    const match = matches[index] as BlockMatch;
    const originalIndex = match.kind === 'changed' ? match.replaces : match.original;
    const original = originalIndex === null ? null : (originals[originalIndex] ?? null);
    let gap = blank;
    if (index === 0) gap = originals[0]?.gap ?? '';
    else if (original && originalIndex !== 0 && match.kind !== 'moved') gap = original.gap;
    // A changed block takes the place of the old one, indentation included; a tab there would
    // make the column ambiguous, so such indentation is dropped.
    // Verbatim and moved blocks keep their own line layout, so they start at column 0.
    const ownLayout = node.type.name === 'verbatimBlock' || match.kind === 'moved';
    if (match.kind !== 'same' && (ownLayout || /\t[ \t]*$/.test(gap))) {
      gap = gap.replace(/[ \t]+$/, '');
    }
    return {
      node,
      match,
      original,
      gap,
      text: match.kind === 'changed' ? '' : (original?.source ?? ''),
    };
  });
}

/** The indentation the gap ends with (the line prefix of the block after it). */
function gapIndent(gap: string): string {
  return /[ ]*$/.exec(gap)?.[0] ?? '';
}

/** The same gap with at least one blank line in it (a CRLF is one line end, never two). */
export function withBlankLine(gap: string, eol: Eol): string {
  return /(?:\r\n|\n|\r(?!\n))[ \t]*(?:\r\n|\n|\r)/.test(gap) ? gap : eol + eol;
}

export interface TextContext {
  eol: Eol;
  previous?: Piece;
  next?: Piece;
  /** The piece is the first block of a file without front matter. */
  fileStart: boolean;
}

/** Text for a changed piece at a preservation level. */
export function changedText(piece: Piece, level: Level, context: TextContext): string {
  const { node, original } = piece;
  const { eol } = context;
  const indent = gapIndent(piece.gap);
  if (node.type.name === 'verbatimBlock') return withEol(String(node.attrs['source'] ?? ''), eol);
  // `---` on the first line of a file without front matter would open a front matter block.
  if (node.type.name === 'horizontalRule' && context.fileStart && piece.gap === '') return '***';
  const isList = LIST_NAMES.has(node.type.name);
  if (level < 2 && original && (original.list || original.quote)) {
    const options = { eol, fineGrained: level === 0 };
    const preserved = original.list
      ? serializePreservedList(node, original, options)
      : serializePreservedQuote(node, original, options);
    if (preserved !== null) return preserved;
  }
  const markers =
    isList && original?.list && original.node.type === node.type
      ? listMarkers(original.list)
      : isList
        ? freshListMarkers(node, context.previous, context.next)
        : {};
  return placeLines(serializeBlock(node, markers), indent, eol);
}

/**
 * A new list must not continue a neighbouring list written with the same marker — whether that
 * neighbour is an editor list or a verbatim block whose source is a list.
 */
function freshListMarkers(
  node: ProseMirrorNode,
  previous: Piece | undefined,
  next: Piece | undefined,
): MarkerOptions {
  const ordered = node.type.name === 'orderedList';
  const taken = new Set<string>();
  for (const piece of [previous, next]) {
    const marker = piece ? markerOf(piece) : null;
    if (marker && /[.)]/.test(marker) === ordered) taken.add(marker);
  }
  const choices = ordered ? ['.', ')'] : ['-', '*', '+'];
  const marker = choices.find((choice) => !taken.has(choice)) ?? (choices[0] as string);
  return ordered ? { bulletOrdered: marker as '.' | ')' } : { bullet: marker as '-' | '*' | '+' };
}

/** The list marker a piece's text starts with, if it is a list. */
function markerOf(piece: Piece): string | null {
  if (piece.match.kind !== 'changed' && piece.original?.list) return piece.original.list.marker;
  const match = /^[ ]{0,3}(?:([-*+])|\d{1,9}([.)]))(?:[ \t\r\n]|$)/.exec(piece.text);
  return match ? (match[1] ?? match[2] ?? null) : null;
}
