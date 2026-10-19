/**
 * Writing one region of a save (changed pieces, or the unchanged piece after a deletion seam) so
 * that it reads back exactly. Each attempt writes the region and parses it again between one
 * unchanged neighbour on each side, followed by what comes after the right neighbour. Attempts go
 * from most to least preserving: keep unchanged list items and quote children, then items only,
 * then canonical text; each with the planned gaps, then with a blank line in each gap, and last
 * without the gap indentation that can make a block continue the one before it. Lists that would
 * merge with a neighbour get another marker (see list-separation).
 */
import { separateAdjacentLists } from './list-separation';
import type { MarkdownSnapshot, SourceBlock } from './markdown-snapshot';
import { normalizeForMarkdown } from './save-normalize';
import {
  changedText,
  withBlankLine,
  type Level,
  type Piece,
  type TextContext,
} from './save-pieces';
import { verifyWindow, type ExpectedBlock } from './save-verification';

/** Preservation level, blank line in every gap, gap indentation dropped. */
type Attempt = readonly [Level, boolean, boolean];

const ATTEMPTS: readonly Attempt[] = [
  [0, false, false],
  [0, true, false],
  [1, false, false],
  [1, true, false],
  [2, false, false],
  [2, true, false],
  [2, false, true],
  [2, true, true],
];
/** A region of unchanged pieces (a deletion seam) can only change its gaps. */
const SEAM_ATTEMPTS: readonly Attempt[] = [
  [0, false, false],
  [0, true, false],
  [0, false, true],
  [0, true, true],
];
/** What a region that never reads back exactly is written as (unchecked). */
const FALLBACK: Attempt = [2, true, false];
const SEAM_FALLBACK: Attempt = [0, true, false];

/** Writes pieces `from…to` so that they verify; returns their parsed blocks, or null. */
export function resolveRegion(
  pieces: Piece[],
  from: number,
  to: number,
  snapshot: MarkdownSnapshot,
): SourceBlock[] | null {
  const plannedGaps = pieces.slice(from, to + 2).map((piece) => piece.gap);
  const rewritable = pieces.slice(from, to + 1).some((piece) => piece.match.kind !== 'same');
  const indented = plannedGaps.slice(0, to - from + 1).some((gap) => /[ \t]$/.test(gap));
  for (const attempt of rewritable ? ATTEMPTS : SEAM_ATTEMPTS) {
    if (attempt[2] && !indented) continue;
    writeAttempt(pieces, from, to, snapshot, plannedGaps, attempt);
    separateAdjacentLists(pieces, from, to);
    const blocks = verifyRegion(pieces, from, to, snapshot);
    if (blocks) return blocks;
  }
  // Nothing reads back exactly: canonical text, unchanged blocks as they were.
  writeAttempt(pieces, from, to, snapshot, plannedGaps, rewritable ? FALLBACK : SEAM_FALLBACK);
  return null;
}

function writeAttempt(
  pieces: Piece[],
  from: number,
  to: number,
  snapshot: MarkdownSnapshot,
  plannedGaps: readonly string[],
  [level, blankGaps, unindent]: Attempt,
): void {
  for (let i = from; i <= Math.min(to + 1, pieces.length - 1); i += 1) {
    const piece = pieces[i] as Piece;
    const planned = plannedGaps[i - from] as string;
    const gap = blankGaps && i > 0 ? withBlankLine(planned, snapshot.eol) : planned;
    piece.gap = unindent && i <= to ? gap.replace(/[ \t]+$/, '') : gap;
    const context = textContext(pieces, i, snapshot);
    if (piece.match.kind === 'same' && i <= to) piece.text = piece.original!.source;
    // A moved block is written from its source, except in the canonical attempts.
    if (piece.match.kind === 'moved') {
      piece.text = level === 2 ? changedText(piece, level, context) : piece.original!.source;
    }
    if (i <= to && piece.match.kind === 'changed') piece.text = changedText(piece, level, context);
  }
}

/**
 * Parses pieces `from…to` again between one unchanged neighbour on each side, followed by the
 * text after the right neighbour; returns the region's parsed blocks, or null when they differ.
 */
export function verifyRegion(
  pieces: Piece[],
  from: number,
  to: number,
  snapshot: MarkdownSnapshot,
): SourceBlock[] | null {
  const left = pieces[from - 1];
  const right = pieces[to + 1];
  const window = [
    ...(left ? [left] : []),
    ...pieces.slice(from, to + 1),
    ...(right ? [right] : []),
  ];
  const head = left ? indentOf(left.gap) : (pieces[0]?.gap ?? '');
  const expected = window.map((piece): ExpectedBlock => ({
    node: piece.match.kind === 'same' ? piece.original!.node : normalizeForMarkdown(piece.node),
    gap: piece.gap,
    text: piece.text,
  }));
  const tail = tailAfter(pieces, to, snapshot);
  const blocks = verifyWindow(head, expected, tail, snapshot.schema, snapshot.definitionsPrefix);
  return blocks && blocks.slice(left ? 1 : 0, left ? to - from + 2 : to - from + 1);
}

/** What follows a region's right neighbour: the next gap, or the text after the last block. */
export function tailAfter(pieces: Piece[], to: number, snapshot: MarkdownSnapshot): string {
  return (to + 1 < pieces.length ? pieces[to + 2]?.gap : undefined) ?? snapshot.trailing;
}

function textContext(pieces: Piece[], index: number, snapshot: MarkdownSnapshot): TextContext {
  return {
    eol: snapshot.eol,
    previous: pieces[index - 1],
    next: pieces[index + 1],
    fileStart: index === 0 && snapshot.frontmatter === '',
  };
}

/** The indentation at the end of a gap (the start column of the block after it). */
function indentOf(gap: string): string {
  return /[ \t]*$/.exec(gap)?.[0] ?? '';
}
