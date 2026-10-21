/**
 * The paragraph a task item's checkbox opens, and what it renders to. The block structure comes
 * from the fast block scanner (it knows quotes, lists, lazy lines, HTML and code blocks), so a
 * patch knows whether the paragraph goes on after the checkbox's line. The inline content comes
 * from the full parser (remark, the reference semantics) run on that paragraph alone, so a patch
 * can prove that it changed nothing but its date token: no hard break lost or gained, no literal
 * `\` shown, no link, emphasis or HTML changed.
 */
import type { Nodes, Root } from 'mdast';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { BlockScanner } from './fast-block-scanner.js';

const processor = unified().use(remarkParse).use(remarkGfm).freeze();

export interface TaskParagraph {
  /** Content slices `[start, end, …]` (absolute, no line endings); the first starts at `[`. */
  lines: readonly number[];
  definitions: ReadonlySet<string>;
  footnotes: ReadonlySet<string>;
}

/** The paragraph whose GFM checkbox `[` is at `checkbox`, or null. */
export function findTaskParagraph(
  content: string,
  bodyStart: number,
  checkbox: number,
): TaskParagraph | null {
  const scanner = new BlockScanner(content, bodyStart);
  const leaf = scanner
    .scan()
    .find(
      (block) => block.kind === 'paragraph' && block.firstInItem && block.lines[0] === checkbox,
    );
  if (!leaf) return null;
  return { lines: leaf.lines, definitions: scanner.definitions, footnotes: scanner.footnotes };
}

/** Whether the paragraph goes on after the checkbox's line (a final `\` there is a hard break). */
export const continuesAfterFirstLine = (paragraph: TaskParagraph): boolean =>
  paragraph.lines.length > 2;

const DUE_EMOJI = 0x1f4c5;
const DONE_EMOJI = 0x2705;

/**
 * Stand-ins for marked token emojis: a symbol of the same Unicode class and UTF-16 length as
 * the emoji (so the parse is the same) that does not occur in `text` (so it can be found after).
 */
function pickMarkers(text: string): { bmp: string; astral: string } {
  const pick = (from: number): string => {
    for (let code = from; ; code += 1) {
      const char = String.fromCodePoint(code);
      if (/\p{So}/u.test(char) && !text.includes(char)) return char;
    }
  };
  return { bmp: pick(0x2b00), astral: pick(0x1f700) };
}

/**
 * The paragraph alone as Markdown: `x` keeps the first line from starting a block of its own,
 * four spaces do the same for the other lines (their leading blanks are not content and an
 * indented line cannot interrupt a paragraph), and the note's definitions follow so `[label]`
 * and `[^n]` resolve as they do in the note. null when a mark is not on a token emoji.
 */
function standaloneSource(
  content: string,
  paragraph: TaskParagraph,
  marks: readonly number[],
  markers: { bmp: string; astral: string },
): string | null {
  const [checkbox, firstEnd, ...rest] = paragraph.lines as number[];
  const from = (checkbox as number) + 3;
  let first = content.slice(from, firstEnd);
  for (const mark of [...marks].sort((a, b) => b - a)) {
    const at = mark - from;
    const code = at < 0 ? undefined : first.codePointAt(at);
    if (code !== DUE_EMOJI && code !== DONE_EMOJI) return null;
    const marker = code === DUE_EMOJI ? markers.astral : markers.bmp;
    first = first.slice(0, at) + marker + first.slice(at + marker.length);
  }
  let source = `x${first}`;
  for (let i = 0; i < rest.length; i += 2) {
    source += `\n    ${content.slice(rest[i], rest[i + 1]).replace(/^[ \t]+/, '')}`;
  }
  for (const label of paragraph.definitions) source += `\n\n[${label}]: #`;
  for (const label of paragraph.footnotes) source += `\n\n[^${label}]: x`;
  return source;
}

const isText = (node: unknown): node is { type: 'text'; value: string } =>
  (node as { type?: unknown }).type === 'text';

/**
 * Canonical inline content of the task paragraph (checkbox left out), or null when a mark is not
 * on a token emoji of the checkbox's line. Each date token whose emoji starts at an offset in
 * `marks` is dropped with the blanks before it, so a tick that only adds ` ✅ <date>` renders
 * exactly as before.
 */
export function renderTaskParagraph(
  content: string,
  paragraph: TaskParagraph,
  marks: readonly number[],
): string | null {
  const lines = paragraph.lines;
  const markers = pickMarkers(content.slice(lines[0], lines[lines.length - 1]));
  const source = standaloneSource(content, paragraph, marks, markers);
  if (source === null) return null;
  const token = new RegExp(
    `[ \\t]*(?:${markers.bmp}|${markers.astral})\\uFE0F?[ \\t]*\\d{4}-\\d{2}-\\d{2}`,
    'gu',
  );
  const canonical = (node: Nodes): unknown => {
    if (node.type === 'text') {
      return { type: 'text', value: node.value.replace(token, '') };
    }
    const fields: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) {
      if (key !== 'position' && key !== 'children') fields[key] = value;
    }
    if ('children' in node) {
      // A text node that held only the dropped token is gone, as on the side without the token.
      fields.children = node.children
        .map(canonical)
        .filter((child) => !(isText(child) && child.value === ''));
    }
    return fields;
  };
  const blocks = (processor.parse(source) as Root).children.filter(
    (node) => node.type !== 'definition' && node.type !== 'footnoteDefinition',
  );
  return JSON.stringify(blocks.map(canonical));
}
