/**
 * Where a Markdown text may be cut into independently parsed chunks. micromark's container
 * handling is quadratic in the size of one parse, so large notes are parsed piece by piece.
 * A cut is only proposed before a line that cannot continue anything above it: the previous
 * line is blank and the line starts at column 0 with something other than a list marker (a new
 * list item could continue the list above). Fenced code and HTML blocks can span blank lines, so
 * the parser additionally checks after each chunk that its last block was properly closed
 * (`endsCleanly`) and otherwise extends the chunk to the next cut.
 */
import type { Html, Nodes, Root } from 'mdast';

const LIST_ITEM_START = /(?:[-+*]|\d{1,9}[.)])(?:[ \t\n]|$)/y;

/** Offsets of line starts where a chunk may begin (ascending, never 0). */
export function chunkCandidates(text: string): number[] {
  const cuts: number[] = [];
  let lineStart = 0;
  let previousBlank = false;
  while (lineStart < text.length) {
    let lineEnd = text.indexOf('\n', lineStart);
    if (lineEnd === -1) lineEnd = text.length;
    const first = text.charCodeAt(lineStart);
    const blank = isBlank(text, lineStart, lineEnd);
    if (previousBlank && !blank && first !== 32 && first !== 9 && lineStart > 0) {
      LIST_ITEM_START.lastIndex = lineStart;
      if (!LIST_ITEM_START.test(text)) cuts.push(lineStart);
    }
    previousBlank = blank;
    lineStart = lineEnd + 1;
  }
  return cuts;
}

function isBlank(text: string, from: number, to: number): boolean {
  for (let i = from; i < to; i += 1) {
    const code = text.charCodeAt(i);
    if (code !== 32 && code !== 9) return false;
  }
  return true;
}

/**
 * Whether the chunk's last block ended by itself (not by the end of the chunk): no fenced code or
 * HTML block that waits for its closing marker, at the end of the chunk or nested at the end of
 * its last container.
 */
export function endsCleanly(root: Root, chunk: string): boolean {
  let node: Nodes | undefined = root.children[root.children.length - 1];
  while (node) {
    if (node.type === 'code' && !fencedCodeClosed(node, chunk)) return false;
    if (node.type === 'html' && !htmlBlockClosed(node)) return false;
    node = 'children' in node ? node.children[node.children.length - 1] : undefined;
  }
  return true;
}

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;

function fencedCodeClosed(node: Nodes, chunk: string): boolean {
  const source = chunk.slice(node.position?.start.offset ?? 0, node.position?.end.offset ?? 0);
  const open = FENCE_OPEN.exec(source);
  if (!open) return true; // indented code ends at a non-indented line
  const fence = open[1] as string;
  const lastLineStart = source.lastIndexOf('\n') + 1;
  if (lastLineStart === 0) return false;
  const lastLine = source.slice(lastLineStart).trimEnd();
  const close = /^ {0,3}(`+|~+)$/.exec(lastLine);
  return close !== null && close[1]![0] === fence[0] && close[1]!.length >= fence.length;
}

/** HTML blocks of the kinds that end at a marker (not at a blank line) must contain it. */
function htmlBlockClosed(node: Html): boolean {
  const value = node.value.trimStart();
  const lower = value.toLowerCase();
  if (/^<(?:script|pre|style|textarea)(?:[\s>]|$)/.test(lower)) {
    return /<\/(?:script|pre|style|textarea)>/.test(lower);
  }
  if (lower.startsWith('<!--')) return lower.indexOf('-->', 2) !== -1;
  if (lower.startsWith('<?')) return lower.indexOf('?>', 2) !== -1;
  if (lower.startsWith('<![cdata[')) return lower.indexOf(']]>', 9) !== -1;
  if (/^<![a-z]/.test(lower)) return lower.indexOf('>', 2) !== -1;
  return true;
}
