/**
 * CommonMark + GFM parse (remark, the same pipeline as the server's reference parser) of `\n`-only
 * text into mdast with absolute offsets. Large texts are parsed in chunks (see markdown-chunks).
 * Link-reference and footnote definitions are global, so when a text has any, each chunk is
 * parsed behind a prefix holding all top-level definitions (or, when a definition is nested in a
 * container, the text is parsed in one piece).
 */
import type { Nodes, Root, RootContent } from 'mdast';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { chunkCandidates, endsCleanly } from './markdown-chunks';

const processor = unified().use(remarkParse).use(remarkGfm).freeze();
const CHUNK_TARGET = 4096;
const PREFIX_END = '<!---->\n\n';

export interface ParseOptions {
  /** Definitions prefix from an earlier full parse (skips collecting definitions again). */
  definitionsPrefix?: string;
  /** Approximate chunk size in characters (tests use small values to cut often). */
  chunkTarget?: number;
}

export interface ParsedMarkdown {
  root: Root;
  /** Top-level definitions (raw text) to put in front of any later partial parse. */
  definitionsPrefix: string;
}

export function parseMarkdown(text: string, options: ParseOptions = {}): ParsedMarkdown {
  const target = options.chunkTarget ?? CHUNK_TARGET;
  if (options.definitionsPrefix !== undefined) {
    const prefix = options.definitionsPrefix;
    return { root: parseChunked(text, prefix, target), definitionsPrefix: prefix };
  }
  const root = parseChunked(text, '', target);
  const definitions = collectDefinitions(root);
  if (definitions.nested) return { root: parseWhole(text), definitionsPrefix: '' };
  if (definitions.topLevel.length === 0) return { root, definitionsPrefix: '' };
  const prefix = buildDefinitionsPrefix(definitions.topLevel.map((node) => sliceOf(text, node)));
  return { root: parseChunked(text, prefix, target), definitionsPrefix: prefix };
}

/**
 * Definitions to parse in front of a partial text, ended by an HTML comment so that an indented
 * first line of the text cannot continue a footnote definition.
 */
export function buildDefinitionsPrefix(definitions: readonly string[]): string {
  return definitions.length === 0 ? '' : `${definitions.join('\n\n')}\n\n${PREFIX_END}`;
}

/** One parse of the whole text, without chunks (the reference the chunked parse must match). */
export function parseWhole(text: string): Root {
  return processor.parse(text) as Root;
}

function parseChunked(text: string, prefix: string, target: number): Root {
  const children: RootContent[] = [];
  const cuts = chunkCandidates(text);
  const prefixCount = prefix === '' ? 0 : parseWhole(prefix).children.length;
  let cutIndex = 0;
  let start = 0;
  while (start < text.length) {
    while (cutIndex < cuts.length && (cuts[cutIndex] as number) < start + target) {
      cutIndex += 1;
    }
    let end = cuts[cutIndex] ?? text.length;
    let parsed = parseChunk(text.slice(start, end), prefix, prefixCount);
    while (end < text.length && !endsCleanly(parsed, text.slice(start, end))) {
      cutIndex += 1;
      end = cuts[cutIndex] ?? text.length;
      parsed = parseChunk(text.slice(start, end), prefix, prefixCount);
    }
    for (const child of parsed.children) {
      shiftOffsets(child, start);
      children.push(child);
    }
    start = end;
  }
  return { type: 'root', children, position: span(0, text.length) };
}

/** Parses `prefix + chunk`; returns the chunk's nodes with chunk-relative offsets. */
function parseChunk(chunk: string, prefix: string, prefixCount: number): Root {
  if (prefix === '') return parseWhole(chunk);
  const root = parseWhole(prefix + chunk);
  const children = root.children.slice(prefixCount);
  for (const child of children) shiftOffsets(child, -prefix.length);
  return { type: 'root', children, position: span(0, chunk.length) };
}

function shiftOffsets(node: Nodes, delta: number): void {
  if (delta === 0) return;
  const position = node.position;
  if (position) {
    position.start = { ...position.start, offset: (position.start.offset ?? 0) + delta };
    position.end = { ...position.end, offset: (position.end.offset ?? 0) + delta };
  }
  if ('children' in node) for (const child of node.children) shiftOffsets(child, delta);
}

function collectDefinitions(root: Root): { topLevel: RootContent[]; nested: boolean } {
  const topLevel = root.children.filter(isDefinition);
  let nested = false;
  const visit = (node: Nodes, depth: number): void => {
    if (depth > 0 && isDefinition(node)) nested = true;
    if (!nested && 'children' in node) for (const child of node.children) visit(child, depth + 1);
  };
  for (const child of root.children) if (!isDefinition(child)) visit(child, 0);
  return { topLevel, nested };
}

function isDefinition(node: Nodes): node is RootContent {
  return node.type === 'definition' || node.type === 'footnoteDefinition';
}

function sliceOf(text: string, node: Nodes): string {
  return text.slice(node.position?.start.offset ?? 0, node.position?.end.offset ?? 0);
}

function span(start: number, end: number): NonNullable<Root['position']> {
  return {
    start: { line: 1, column: 1, offset: start },
    end: { line: 1, column: 1, offset: end },
  };
}
