/**
 * Where each top-level property of the front matter lives in the raw file, as whole lines
 * (SPEC §4.9 "YAML-aware text patches"). A key's lines are its key line, every line its value
 * spans (block lists, block scalars, multi-line flow values), and the indented lines holding
 * nested values up to the next top-level key. Blank lines and comment lines after the value's
 * last line belong to nobody and are never touched; a comment at the end of a one-line value is
 * reported so a rewrite can keep it.
 */
import { isMap, isScalar, parseDocument, type Pair } from 'yaml';
import { VaultError } from '../vault/vault-types.js';
import { splitFrontmatter } from './frontmatter.js';
import { dominantLineEnding } from './source-lines.js';

export interface KeyLines {
  /** Content offsets of the key's lines, `end` after the last line's line ending. */
  start: number;
  end: number;
  /** The key exactly as written (keeps its quoting). */
  keyText: string;
  /** `   # comment` ending a one-line property (with its leading whitespace), else ''. */
  comment: string;
}

export interface FrontmatterBlock {
  /** Content offset where the closing `---` / `...` line starts (new keys go here). */
  closeStart: number;
  /** Line ending inside the block. */
  eol: string;
  /** Whitespace before the top-level keys. */
  indent: string;
  keys: Map<string, KeyLines>;
}

export function refuseFrontmatter(reason: string, message: string): VaultError {
  return new VaultError('VALIDATION', message, { reason });
}

interface Line {
  start: number;
  /** Offset after the line ending (equal to the text end on the last line). */
  next: number;
  text: string;
}

function splitLines(text: string): Line[] {
  const lines: Line[] = [];
  for (let start = 0; ;) {
    let end = start;
    while (end < text.length && text[end] !== '\n' && text[end] !== '\r') end += 1;
    const next = text.startsWith('\r\n', end) ? end + 2 : Math.min(end + 1, text.length);
    lines.push({ start, next: end === text.length ? end : next, text: text.slice(start, end) });
    if (end === text.length) return lines;
    start = next;
  }
}

function lineAt(lines: readonly Line[], offset: number): number {
  let low = 0;
  let high = lines.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (lines[mid]!.start <= offset) low = mid;
    else high = mid - 1;
  }
  return low;
}

const leadingSpace = (text: string) => /^[ \t]*/.exec(text)![0];
const rangeOf = (node: unknown) => (node as { range?: [number, number, number] } | null)?.range;

/** Last line holding the pair's own text (key, value, a comment on the value's last line). */
function lastValueLine(raw: string, lines: readonly Line[], pair: Pair, keyStart: number): number {
  let end = Math.max(rangeOf(pair.key)![1], rangeOf(pair.value)?.[1] ?? 0) - 1;
  while (end > keyStart && /\s/.test(raw[end]!)) end -= 1;
  return lineAt(lines, Math.max(end, keyStart));
}

/** The `   # comment` after a one-line pair's value (or after `key:` when the value is empty). */
function trailingComment(raw: string, line: Line, pair: Pair): string {
  // An empty value (`key:   # note`) is a null scalar placed after the comment: start at the key.
  const empty = pair.value === null || (isScalar(pair.value) && pair.value.value === null);
  const valueEnd = (empty ? undefined : rangeOf(pair.value)?.[1]) ?? rangeOf(pair.key)![1];
  const lineEnd = line.start + line.text.length;
  const rest = raw.slice(Math.min(Math.max(valueEnd, line.start), lineEnd), lineEnd);
  return /^[^#]*?([ \t]+#.*)$/.exec(rest)?.[1] ?? '';
}

/** Offset of the closing fence line: after the line ending that `raw` leaves out. */
function closeFenceStart(content: string, rawEnd: number): number {
  if (content.startsWith('\r\n', rawEnd)) return rawEnd + 2;
  return content[rawEnd] === '\n' || content[rawEnd] === '\r' ? rawEnd + 1 : rawEnd;
}

/**
 * The front matter's layout, or null when the file has none. Refuses (VALIDATION with `reason`)
 * invalid YAML, duplicate keys and anything but a block mapping at the root.
 */
export function readFrontmatterBlock(content: string): FrontmatterBlock | null {
  const { frontmatter, yamlStart } = splitFrontmatter(content);
  if (!frontmatter.present || frontmatter.raw === null) return null;
  const raw = frontmatter.raw;
  const doc = parseDocument(raw, { schema: 'core', prettyErrors: false, logLevel: 'silent' });
  if (doc.errors.some((error) => error.code === 'DUPLICATE_KEY')) {
    throw refuseFrontmatter('duplicate-key', 'A property appears twice in the front matter.');
  }
  if (doc.errors.length > 0) {
    throw refuseFrontmatter('invalid-yaml', 'The front matter is not valid YAML.');
  }
  const root = doc.contents;
  if (root !== null && (!isMap(root) || root.flow)) {
    throw refuseFrontmatter('not-mapping', 'The front matter is not a list of properties.');
  }
  const closeStart = closeFenceStart(content, yamlStart + raw.length);
  const lines = splitLines(raw);
  const pairs = (root?.items ?? []).filter((pair) => rangeOf(pair.key) !== undefined);
  const keyStartOf = (pair: Pair) => rangeOf(pair.key)![0];
  const indent = pairs.length
    ? leadingSpace(lines[lineAt(lines, keyStartOf(pairs[0]!))]!.text)
    : '';
  const keys = new Map<string, KeyLines>();
  pairs.forEach((pair, i) => {
    const keyStart = keyStartOf(pair);
    const next = pairs[i + 1];
    const nextKeyLine = next ? lineAt(lines, keyStartOf(next)) : lines.length;
    let last = lastValueLine(raw, lines, pair, keyStart);
    const keyLine = lineAt(lines, keyStart);
    const oneLine = last === keyLine;
    for (let l = last + 1; l < nextKeyLine; l += 1) {
      const text = lines[l]!.text;
      if (text.trim() === '' || text.trim().startsWith('#')) continue;
      if (leadingSpace(text).length <= indent.length) break;
      last = l;
    }
    if (!isScalar(pair.key) || typeof pair.key.value !== 'string') return;
    const [keyFrom, keyTo] = rangeOf(pair.key)!;
    keys.set(pair.key.value, {
      start: yamlStart + lines[lineAt(lines, keyStart)]!.start,
      // The last raw line's line ending sits outside `raw`, just before the closing fence.
      end: last === lines.length - 1 ? closeStart : yamlStart + lines[last]!.next,
      keyText: raw.slice(keyFrom, keyTo),
      comment: oneLine && last === keyLine ? trailingComment(raw, lines[keyLine]!, pair) : '',
    });
  });
  const eol = /\r\n|\n|\r/.exec(content.slice(yamlStart + raw.length, closeStart))?.[0];
  return { closeStart, eol: eol ?? dominantLineEnding(content), indent, keys };
}
