/**
 * GFM tables for the fast scanner: a header row followed by a delimiter row with the same
 * number of cells (the delimiter row needs a `|` or `:`), as in the reference GFM parser. Cells
 * are split at unescaped pipes BEFORE inline parsing, so a pipe inside backticks still splits.
 */
import type { BlockScanner } from './fast-block-scanner.js';
import type { Block } from './fast-block-types.js';
import { CODE_INDENT, isSpaceOrTab, LineCursor } from './fast-line-cursor.js';

const DELIMITER_CELL = /^:?-+:?$/;

/** Opens a table at the current line under `parent` when the next line is its delimiter row. */
export function openTableIfStarts(scanner: BlockScanner, parent: Block): boolean {
  const columns = tableStartsHere(scanner, parent);
  if (columns === 0) return false;
  while (scanner.tip !== parent) scanner.finalize(scanner.open.pop() as Block);
  scanner.allClosed = true;
  scanner.cursor.advanceNextNonspace();
  const table = scanner.addChild('table', scanner.cursor.offset);
  table.tableColumns = columns;
  table.awaitingDelimiter = true;
  scanner.addLine(table);
  return true;
}

/** Column count when the current line starts a table under `parent`, else 0. */
function tableStartsHere(scanner: BlockScanner, parent: Block): number {
  const cursor = scanner.cursor;
  if (cursor.blank || cursor.indent >= CODE_INDENT) return 0;
  const next = (scanner.lineIndex + 1) * 2;
  if (next >= scanner.lineBounds.length) return 0;
  // Cheap rejection first: a delimiter row needs a `-` and a `|` or `:`.
  const nextLine = scanner.content.slice(scanner.lineBounds[next], scanner.lineBounds[next + 1]);
  if (!nextLine.includes('-') || (!nextLine.includes('|') && !nextLine.includes(':'))) return 0;
  const header = cellBounds(scanner.content, cursor.nextNonspace, cursor.end);
  if (header.length === 0) return 0;
  const probe = new LineCursor();
  probe.reset(
    scanner.content,
    scanner.lineBounds[next] as number,
    scanner.lineBounds[next + 1] as number,
  );
  const parentDepth = scanner.open.indexOf(parent);
  for (let depth = 1; depth <= parentDepth; depth += 1) {
    probe.findNextNonspace();
    if (!continuesContainer(probe, scanner.open[depth] as Block)) return 0;
  }
  probe.findNextNonspace();
  if (probe.blank || probe.indent >= CODE_INDENT) return 0;
  if (startsContainer(probe)) return 0;
  const columns = header.length / 2;
  return delimiterColumns(scanner.content, probe.nextNonspace, probe.end) === columns ? columns : 0;
}

/**
 * Containers are matched before tables: a would-be delimiter row that opens a block quote or a
 * list item (under paragraph-interrupt rules: non-empty, ordered only as `1.`/`1)`) is one.
 */
function startsContainer(probe: LineCursor): boolean {
  const rest = probe.rest(probe.nextNonspace);
  if (rest.startsWith('>')) return true;
  const marker = /^(?:[-+*]|1[.)])(?=[ \t])/.exec(rest);
  if (!marker || !/[^ \t]/.test(rest.slice(marker[0].length))) return false;
  return !/^(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,})$/.test(rest);
}

/** Container continuation without side effects on the scanner (lookahead only). */
function continuesContainer(probe: LineCursor, block: Block): boolean {
  switch (block.kind) {
    case 'blockquote':
      if (probe.indented || probe.peek(probe.nextNonspace) !== 62) return false;
      probe.advanceNextNonspace();
      probe.advanceOffset(1);
      if (isSpaceOrTab(probe.peek(probe.offset))) probe.advanceOffset(1, true);
      return true;
    case 'item':
      if (probe.blank || probe.indent < block.markerOffset + block.padding) return false;
      probe.advanceOffset(block.markerOffset + block.padding, true);
      return true;
    default:
      return true;
  }
}

function delimiterColumns(content: string, start: number, end: number): number {
  const cells = cellBounds(content, start, end);
  let sawPipeOrColon = false;
  for (let i = start; i < end; i += 1) {
    const code = content.charCodeAt(i);
    if (code === 124 || code === 58) sawPipeOrColon = true;
  }
  if (!sawPipeOrColon) return 0;
  for (let i = 0; i < cells.length; i += 2) {
    if (!DELIMITER_CELL.test(content.slice(cells[i], cells[i + 1]))) return 0;
  }
  return cells.length / 2;
}

/**
 * Trimmed cell bounds `[start, end, …]` of a row; an optional leading and trailing pipe do not
 * create cells. A row that is only a pipe has no cells.
 */
export function cellBounds(content: string, start: number, end: number): number[] {
  let from = start;
  let to = end;
  while (from < to && isSpaceOrTab(content.charCodeAt(from))) from += 1;
  while (to > from && isSpaceOrTab(content.charCodeAt(to - 1))) to -= 1;
  if (from === to) return [];
  if (content.charCodeAt(from) === 124) {
    if (to - from === 1) return [];
    from += 1;
  }
  const cells: number[] = [];
  let cellStart = from;
  let lastDivider = -1;
  for (let i = from; i < to; i += 1) {
    const code = content.charCodeAt(i);
    if (code === 92) {
      const next = content.charCodeAt(i + 1);
      if (i + 1 < to && (next === 92 || next === 124)) i += 1;
    } else if (code === 124) {
      pushTrimmed(content, cellStart, i, cells);
      cellStart = i + 1;
      lastDivider = i;
    }
  }
  if (lastDivider !== to - 1) pushTrimmed(content, cellStart, to, cells);
  return cells;
}

function pushTrimmed(content: string, start: number, end: number, out: number[]): void {
  let from = start;
  let to = end;
  while (from < to && isSpaceOrTab(content.charCodeAt(from))) from += 1;
  while (to > from && isSpaceOrTab(content.charCodeAt(to - 1))) to -= 1;
  out.push(from, to);
}
