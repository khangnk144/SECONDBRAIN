/**
 * Block starts of the fast scanner, tried in CommonMark order: block quote, ATX heading, code
 * fence, HTML block, setext underline, thematic break, list item, indented code.
 * Each returns 0 (no match), 1 (container opened, keep looking) or 2 (leaf opened).
 */
import { extractDefinitions } from './fast-block-helpers.js';
import type { BlockScanner } from './fast-block-scanner.js';
import type { Block } from './fast-block-types.js';
import { footnoteLabelEnd, normalizeLabel } from './fast-definitions.js';
import { CODE_INDENT, isSpaceOrTab } from './fast-line-cursor.js';
import { htmlBlockStart } from './html-syntax.js';

const ATX_MARKER = /^#{1,6}(?:[ \t]+|$)/;
const CODE_FENCE = /^`{3,}(?!.*`)|^~{3,}/;
const SETEXT_LINE = /^(?:=+|-+)[ \t]*$/;
const THEMATIC_BREAK = /^(?:(?:\*[ \t]*){3,}|(?:_[ \t]*){3,}|(?:-[ \t]*){3,})$/;
const BULLET = /^[*+-]/;
const ORDERED = /^(\d{1,9})([.)])/;

type Start = (scanner: BlockScanner, container: Block) => 0 | 1 | 2;

const STARTS: readonly Start[] = [
  blockQuote,
  footnoteDefinition,
  atxHeading,
  fencedCode,
  htmlBlock,
  setextHeading,
  thematicBreak,
  listItem,
  indentedCode,
];

export function tryBlockStarts(scanner: BlockScanner, container: Block): 0 | 1 | 2 {
  for (const start of STARTS) {
    const result = start(scanner, container);
    if (result !== 0) return result;
  }
  return 0;
}

function blockQuote(scanner: BlockScanner): 0 | 1 {
  const cursor = scanner.cursor;
  if (cursor.indented || cursor.peek(cursor.nextNonspace) !== 62) return 0;
  cursor.advanceNextNonspace();
  cursor.advanceOffset(1);
  if (isSpaceOrTab(cursor.peek(cursor.offset))) cursor.advanceOffset(1, true);
  scanner.closeUnmatched();
  scanner.addChild('blockquote', cursor.nextNonspace);
  return 1;
}

/** GFM footnote definition `[^label]:`, a container whose content lines are indented by 4. */
function footnoteDefinition(scanner: BlockScanner): 0 | 1 {
  const cursor = scanner.cursor;
  if (cursor.indented || cursor.peek(cursor.nextNonspace) !== 91) return 0;
  const rest = cursor.rest(cursor.nextNonspace);
  const close = footnoteLabelEnd(rest, 0);
  if (close < 0 || rest.charCodeAt(close) !== 58) return 0;
  scanner.footnotes.add(normalizeLabel(rest.slice(2, close - 1)));
  const start = cursor.nextNonspace;
  cursor.advanceNextNonspace();
  cursor.advanceOffset(close + 1);
  while (isSpaceOrTab(cursor.peek(cursor.offset))) cursor.advanceOffset(1, true);
  scanner.closeUnmatched();
  scanner.addChild('footnote', start);
  return 1;
}

function atxHeading(scanner: BlockScanner): 0 | 2 {
  const cursor = scanner.cursor;
  if (cursor.indented) return 0;
  const match = ATX_MARKER.exec(cursor.rest(cursor.nextNonspace));
  if (!match) return 0;
  cursor.advanceNextNonspace();
  cursor.advanceOffset(match[0].length);
  scanner.closeUnmatched();
  const heading = scanner.addChild('heading', cursor.nextNonspace);
  heading.depth = match[0].trim().length;
  // Content without the optional closing sequence (` ##`) and surrounding whitespace.
  const rest = cursor.rest();
  let text = rest.replace(/^[ \t]*#+[ \t]*$/, '').replace(/[ \t]+#+[ \t]*$/, '');
  const lead = text.length - text.trimStart().length;
  text = text.trim();
  heading.lines.push(cursor.offset + lead, cursor.offset + lead + text.length);
  heading.end = cursor.end;
  cursor.advanceOffset(cursor.end - cursor.offset);
  return 2;
}

function fencedCode(scanner: BlockScanner): 0 | 2 {
  const cursor = scanner.cursor;
  if (cursor.indented) return 0;
  const match = CODE_FENCE.exec(cursor.rest(cursor.nextNonspace));
  if (!match) return 0;
  scanner.closeUnmatched();
  const code = scanner.addChild('code', cursor.nextNonspace);
  code.fenced = true;
  code.fenceLength = match[0].length;
  code.fenceChar = match[0].charCodeAt(0);
  code.fenceOffset = cursor.indent;
  code.end = cursor.end;
  cursor.advanceNextNonspace();
  cursor.advanceOffset(cursor.end - cursor.offset);
  return 2;
}

function htmlBlock(scanner: BlockScanner, container: Block): 0 | 2 {
  const cursor = scanner.cursor;
  if (cursor.indented || cursor.peek(cursor.nextNonspace) !== 60) return 0;
  // Type 7 may not interrupt a paragraph; on a lazy line the scanner handles it (see addText).
  const lazyParagraph = !scanner.allClosed && !cursor.blank && scanner.tip.kind === 'paragraph';
  const type = htmlBlockStart(
    cursor.rest(cursor.nextNonspace),
    container.kind !== 'paragraph' && !lazyParagraph,
  );
  if (type === 0) return 0;
  scanner.closeUnmatched();
  scanner.addChild('html', cursor.offset).htmlType = type;
  return 2;
}

function setextHeading(scanner: BlockScanner, container: Block): 0 | 2 {
  const cursor = scanner.cursor;
  if (cursor.indented || container.kind !== 'paragraph') return 0;
  const match = SETEXT_LINE.exec(cursor.rest(cursor.nextNonspace));
  if (!match) return 0;
  scanner.closeUnmatched();
  // A paragraph made only of reference definitions has no text to turn into a heading.
  if (!extractDefinitions(scanner, container)) return 0;
  container.kind = 'heading';
  container.depth = match[0].startsWith('=') ? 1 : 2;
  container.end = cursor.end;
  cursor.advanceOffset(cursor.end - cursor.offset);
  return 2;
}

function thematicBreak(scanner: BlockScanner): 0 | 2 {
  const cursor = scanner.cursor;
  if (cursor.indented || !THEMATIC_BREAK.test(cursor.rest(cursor.nextNonspace))) return 0;
  scanner.closeUnmatched();
  scanner.addChild('thematic', cursor.nextNonspace).end = cursor.end;
  cursor.advanceOffset(cursor.end - cursor.offset);
  return 2;
}

function listItem(scanner: BlockScanner, container: Block): 0 | 1 {
  const cursor = scanner.cursor;
  if ((cursor.indented && container.kind !== 'list') || cursor.indent >= CODE_INDENT) return 0;
  const rest = cursor.rest(cursor.nextNonspace);
  const interrupting = scanner.interrupt;
  let ordered = false;
  let marker: RegExpExecArray | null = BULLET.exec(rest);
  if (!marker) {
    marker = ORDERED.exec(rest);
    // Only a literal `1` may interrupt (the reference parser rejects `01.` there too).
    if (!marker || (interrupting && marker[1] !== '1')) return 0;
    ordered = true;
  }
  const markerLength = marker[0].length;
  const after = cursor.peek(cursor.nextNonspace + markerLength);
  if (!(after === -1 || isSpaceOrTab(after))) return 0;
  if (interrupting && !/[^ \t\f\v]/.test(rest.slice(markerLength))) return 0;
  const markerOffset = cursor.indent;
  const markerChar = ordered ? (marker[2] as string).charCodeAt(0) : rest.charCodeAt(0);
  const itemStart = cursor.nextNonspace;
  cursor.advanceNextNonspace();
  cursor.advanceOffset(markerLength, true);
  const spacesStartColumn = cursor.column;
  const spacesStartOffset = cursor.offset;
  do {
    cursor.advanceOffset(1, true);
  } while (cursor.column - spacesStartColumn < 5 && isSpaceOrTab(cursor.peek(cursor.offset)));
  const blankItem = cursor.peek(cursor.offset) === -1;
  const spaces = cursor.column - spacesStartColumn;
  let padding = markerLength + spaces;
  if (spaces >= 5 || spaces < 1 || blankItem) {
    padding = markerLength + 1;
    cursor.column = spacesStartColumn;
    cursor.offset = spacesStartOffset;
    if (isSpaceOrTab(cursor.peek(cursor.offset))) cursor.advanceOffset(1, true);
  }
  scanner.closeUnmatched();
  const tip = scanner.tip;
  if (tip.kind !== 'list' || tip.listOrdered !== ordered || tip.listMarker !== markerChar) {
    const list = scanner.addChild('list', itemStart);
    list.listOrdered = ordered;
    list.listMarker = markerChar;
  }
  const item = scanner.addChild('item', itemStart);
  item.markerOffset = markerOffset;
  item.padding = padding;
  if (blankItem) item.blankStart = spacesStartOffset < cursor.end ? 'trailing-space' : 'clean';
  return 1;
}

function indentedCode(scanner: BlockScanner): 0 | 2 {
  const cursor = scanner.cursor;
  if (!cursor.indented || scanner.tip.kind === 'paragraph' || cursor.blank) return 0;
  cursor.advanceOffset(CODE_INDENT, true);
  const exited = scanner.containersExited;
  scanner.closeUnmatched();
  scanner.addChild('code', cursor.offset).closeAtLineEnd = exited;
  return 2;
}
