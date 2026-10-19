/**
 * Block tree nodes of the fast scanner. Only what the note structure needs is kept: container
 * kinds and indentation, and for leaves the absolute offsets of their content lines.
 */

export type BlockKind =
  | 'document'
  | 'blockquote'
  | 'list'
  | 'item'
  | 'footnote'
  | 'paragraph'
  | 'heading'
  | 'thematic'
  | 'code'
  | 'html'
  | 'table';

export class Block {
  childCount = 0;
  /** Content slices of the leaf as flat `[start, end, start, end, …]` absolute offsets. */
  lines: number[] = [];
  /** Absolute end of the last line that belongs to the block. */
  end: number;
  // List items: continuation indentation.
  markerOffset = 0;
  padding = 0;
  /** Item whose marker line has no content; `true` when that line ends in whitespace. */
  blankStart: false | 'clean' | 'trailing-space' = false;
  // Lists: what makes a following item part of the same list.
  listOrdered = false;
  listMarker = 0;
  /** An empty item of this list ended at a blank line (see `BlockScanner.continueBlock`). */
  pendingItemExit = false;
  // Code blocks.
  fenced = false;
  fenceChar = 0;
  fenceLength = 0;
  fenceOffset = 0;
  /** Indented code opened on a line whose containers were exited: closed at that line's end. */
  closeAtLineEnd = false;
  htmlType = 0;
  depth = 0;
  /** A paragraph that is the first child of a list item (where a task checkbox may sit). */
  firstInItem = false;
  /** Tables: header cell count, and whether the delimiter row is still to come. */
  tableColumns = 0;
  awaitingDelimiter = false;

  constructor(
    public kind: BlockKind,
    public parent: Block | null,
    /** Absolute offset where the block starts. */
    public start: number,
  ) {
    this.end = start;
  }
}

/** Thrown when a note uses a construct the fast scanner does not model exactly. */
export class FullParseRequired extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'FullParseRequired';
  }
}

export function canContain(parent: BlockKind, child: BlockKind): boolean {
  if (parent === 'list') return child === 'item';
  if (
    parent === 'document' ||
    parent === 'blockquote' ||
    parent === 'item' ||
    parent === 'footnote'
  )
    return child !== 'item';
  return false;
}

export function acceptsLines(kind: BlockKind): boolean {
  return kind === 'paragraph' || kind === 'code' || kind === 'html' || kind === 'table';
}
