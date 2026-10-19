/**
 * Small helpers shared by the fast block scanner modules.
 */
import type { BlockScanner } from './fast-block-scanner.js';
import type { Block, BlockKind } from './fast-block-types.js';
import { leadingDefinitions } from './fast-definitions.js';
import { isSpaceOrTab } from './fast-line-cursor.js';

/**
 * Removes the link reference definitions at the start of `paragraph` (recording their labels)
 * and returns whether any paragraph text is left. The first remaining line loses its indentation,
 * which belongs to no text, like the start of any paragraph.
 */
export function extractDefinitions(scanner: BlockScanner, paragraph: Block): boolean {
  const lines = paragraph.lines;
  if (lines.length === 0) return false;
  const content = scanner.content;
  if (content.charCodeAt(lines[0] as number) !== 91) return true;
  const text = joinLines(content, lines);
  const { labels, consumed } = leadingDefinitions(text);
  if (labels.length === 0) return true;
  for (const label of labels) scanner.definitions.add(label);
  let lineCount = 0;
  for (let i = text.indexOf('\n'); i !== -1 && i < consumed; i = text.indexOf('\n', i + 1)) {
    lineCount += 1;
  }
  if (consumed >= text.length) lineCount = lines.length / 2;
  paragraph.lines = lines.slice(lineCount * 2);
  paragraph.firstInItem = false;
  if (paragraph.lines.length === 0) return false;
  let start = paragraph.lines[0] as number;
  while (start < (paragraph.lines[1] as number) && isSpaceOrTab(content.charCodeAt(start)))
    start += 1;
  paragraph.lines[0] = start;
  paragraph.start = start;
  return true;
}

export function joinLines(content: string, lines: readonly number[]): string {
  let text = '';
  for (let i = 0; i < lines.length; i += 2) {
    if (i > 0) text += '\n';
    text += content.slice(lines[i], lines[i + 1]);
  }
  return text;
}

export function isContainer(kind: BlockKind): boolean {
  return (
    kind === 'document' ||
    kind === 'blockquote' ||
    kind === 'list' ||
    kind === 'item' ||
    kind === 'footnote'
  );
}

/** First characters that can start a block other than a paragraph: # ` ~ * + _ = < > - [ 0-9 */
export function maybeSpecial(code: number): boolean {
  return (
    code === 35 ||
    code === 91 ||
    code === 96 ||
    code === 126 ||
    code === 42 ||
    code === 43 ||
    code === 95 ||
    code === 61 ||
    code === 60 ||
    code === 62 ||
    code === 45 ||
    (code >= 48 && code <= 57)
  );
}

/** Absolute `[start, end, …]` of every line from `from` (line endings excluded). */
export function collectLineBounds(content: string, from: number, out: number[]): void {
  let start = from;
  for (let i = from; i < content.length; i += 1) {
    const code = content.charCodeAt(i);
    if (code !== 10 && code !== 13) continue;
    out.push(start, i);
    if (code === 13 && content.charCodeAt(i + 1) === 10) i += 1;
    start = i + 1;
  }
  if (start < content.length) out.push(start, content.length);
}

/**
 * A task checkbox must be the very first character of the item's content. For an item whose
 * marker line was empty the reference parser also requires that line to have no trailing
 * whitespace and the current line's indentation to contain no tab.
 */
export function checkboxAllowed(scanner: BlockScanner, item: Block): boolean {
  const cursor = scanner.cursor;
  if (scanner.textStart !== cursor.offset) return false;
  if (item.blankStart === false) return true;
  if (item.blankStart === 'trailing-space') return false;
  return !scanner.content.slice(cursor.start, cursor.offset).includes('\t');
}
