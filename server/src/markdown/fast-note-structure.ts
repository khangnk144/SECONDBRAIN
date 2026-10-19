/**
 * Note structure from the fast block scanner plus the inline pass. Produces exactly what
 * `mdastNoteStructure` produces for the constructs it models (verified by differential tests
 * against the full parser); throws `FullParseRequired` for the rest.
 */
import { joinLines } from './fast-block-helpers.js';
import { BlockScanner } from './fast-block-scanner.js';
import type { Block } from './fast-block-types.js';
import { isSpaceOrTab } from './fast-line-cursor.js';
import type { ReferenceSets } from './fast-inline-references.js';
import { scanInline } from './fast-inline-scanner.js';
import { cellBounds } from './fast-table-rows.js';
import { htmlText } from './mdast-note-structure.js';
import type { NoteStructure } from './note-structure-types.js';
import { mergeSpans } from './note-structure-types.js';
import { PlainTextBuilder } from './plain-text-builder.js';

export function fastNoteStructure(content: string, bodyStart: number): NoteStructure {
  const scanner = new BlockScanner(content, bodyStart);
  const leaves = scanner.scan();
  const refs: ReferenceSets = { definitions: scanner.definitions, footnotes: scanner.footnotes };
  const structure: NoteStructure = { excluded: [], links: [], tasks: [], headings: [], blocks: [] };
  const builder = new PlainTextBuilder();
  for (const leaf of leaves) {
    switch (leaf.kind) {
      case 'paragraph': {
        const slices = trimSlices(content, taskSlices(content, leaf, structure));
        if (slices.length > 0) scanInline(content, slices, structure, builder, refs);
        structure.blocks.push(builder.take());
        break;
      }
      case 'heading': {
        scanInline(content, trimSlices(content, leaf.lines), structure, builder, refs);
        const text = builder.take();
        structure.headings.push({ depth: leaf.depth, start: leaf.start, text });
        structure.blocks.push(text);
        break;
      }
      case 'code':
        structure.excluded.push({ start: leaf.start, end: leaf.end });
        builder.code(joinLines(content, leaf.lines));
        structure.blocks.push(builder.take());
        break;
      case 'html':
        structure.excluded.push({ start: leaf.start, end: leaf.end });
        structure.blocks.push(htmlText(joinLines(content, leaf.lines)));
        break;
      case 'table':
        tableRows(content, leaf, structure, builder, refs);
        break;
      default:
        break;
    }
  }
  structure.excluded = mergeSpans(structure.excluded);
  return structure;
}

/**
 * GFM task check: `[ ]`, `[x]` or `[X]` at the start of the first paragraph of a list item,
 * followed by whitespace and more content (or by more lines). Returns the slices of the text
 * after the check (one whitespace character after it is part of the check).
 */
function taskSlices(content: string, leaf: Block, structure: NoteStructure): number[] {
  const lines = leaf.lines;
  if (!leaf.firstInItem) return lines;
  const start = lines[0] as number;
  const end = lines[1] as number;
  const value = content.charCodeAt(start + 1);
  const isCheck =
    content.charCodeAt(start) === 91 &&
    content.charCodeAt(start + 2) === 93 &&
    start + 3 <= end &&
    (value === 32 || value === 9 || value === 120 || value === 88);
  if (!isCheck) return lines;
  const after = start + 3;
  let k = after;
  while (k < end && isSpaceOrTab(content.charCodeAt(k))) k += 1;
  const valid = after === end ? lines.length > 2 : k > after && (k < end || lines.length > 2);
  if (!valid) return lines;
  structure.tasks.push({ checkbox: start, checked: value === 120 || value === 88 });
  if (after === end) return lines.slice(2);
  return [after + 1, end, ...lines.slice(2)];
}

/**
 * Drops the trailing spaces/tabs of the block's last line. Earlier lines keep theirs: they
 * decide whether a backslash before the line ending is a hard break (`\` + EOL) or literal.
 */
function trimSlices(content: string, lines: readonly number[]): number[] {
  const out = [...lines];
  const last = out.length - 1;
  if (last < 1) return out;
  const start = out[last - 1] as number;
  let end = out[last] as number;
  while (end > start && isSpaceOrTab(content.charCodeAt(end - 1))) end -= 1;
  out[last] = end;
  return out;
}

function tableRows(
  content: string,
  leaf: Block,
  structure: NoteStructure,
  builder: PlainTextBuilder,
  refs: ReferenceSets,
): void {
  const lines = leaf.lines;
  for (let i = 0; i < lines.length; i += 2) {
    if (i === 2) continue; // delimiter row
    const cells = cellBounds(content, lines[i] as number, lines[i + 1] as number);
    const texts: string[] = [];
    for (let c = 0; c < cells.length; c += 2) {
      if (cells[c] !== cells[c + 1]) {
        scanInline(content, [cells[c] as number, cells[c + 1] as number], structure, builder, refs);
      }
      texts.push(builder.take());
    }
    structure.blocks.push(texts.join(' '));
  }
}
