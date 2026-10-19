/**
 * Front matter detection and parsing (SPEC §4.3). Only a block at the very start of the file
 * (after an optional BOM) counts: a `---` line, the YAML, then a `---` or `...` line. The YAML is
 * parsed with the core schema so dates such as `2026-11-05` stay strings; invalid YAML is
 * reported, never repaired.
 */
import { parse as parseYaml } from 'yaml';
import type { ParsedFrontmatter } from './markdown-types.js';

export interface FrontmatterSplit {
  frontmatter: ParsedFrontmatter;
  /** Offset of the first YAML character (meaningful only when present). */
  yamlStart: number;
  /** Offset where the Markdown body starts (after the closing fence line, or after the BOM). */
  bodyStart: number;
}

const OPEN_FENCE = /---[ \t]*(?:\r\n|\n|\r)/y;
const CLOSE_FENCE = /^(?:---|\.\.\.)[ \t]*$/;

export function splitFrontmatter(content: string): FrontmatterSplit {
  const bom = content.charCodeAt(0) === 0xfeff ? 1 : 0;
  OPEN_FENCE.lastIndex = bom;
  const open = OPEN_FENCE.exec(content);
  if (!open) return absent(bom);
  const yamlStart = bom + open[0].length;
  let lineStart = yamlStart;
  let line = 2;
  while (lineStart <= content.length) {
    const { text, next } = readLine(content, lineStart);
    if (CLOSE_FENCE.test(text)) {
      const raw = content.slice(yamlStart, trimLineEnding(content, yamlStart, lineStart));
      return {
        frontmatter: { present: true, raw, ...parseYamlMapping(raw), startLine: 1, endLine: line },
        yamlStart,
        bodyStart: next,
      };
    }
    if (next === lineStart) break;
    lineStart = next;
    line += 1;
  }
  return absent(bom);
}

function absent(bodyStart: number): FrontmatterSplit {
  return {
    frontmatter: { present: false, raw: null, data: null, error: null, startLine: 0, endLine: 0 },
    yamlStart: bodyStart,
    bodyStart,
  };
}

/** One line starting at `start`: its text and where the next line starts (same at EOF). */
function readLine(content: string, start: number): { text: string; next: number } {
  let end = start;
  while (end < content.length) {
    const code = content.charCodeAt(end);
    if (code === 10 || code === 13) break;
    end += 1;
  }
  let next = end;
  if (content.charCodeAt(next) === 13) next += 1;
  if (content.charCodeAt(next) === 10) next += 1;
  return { text: content.slice(start, end), next };
}

/** End of the YAML text: the closing fence's line start minus the preceding line ending. */
function trimLineEnding(content: string, yamlStart: number, fenceLineStart: number): number {
  let end = fenceLineStart;
  if (end > yamlStart && content.charCodeAt(end - 1) === 10) end -= 1;
  if (end > yamlStart && content.charCodeAt(end - 1) === 13) end -= 1;
  return end;
}

function parseYamlMapping(raw: string): Pick<ParsedFrontmatter, 'data' | 'error'> {
  let value: unknown;
  try {
    // `logLevel: 'error'` still throws on invalid YAML but keeps warnings (e.g. template
    // placeholders such as `{{date}}` read as flow maps) out of the process output.
    value = parseYaml(raw, { schema: 'core', prettyErrors: false, logLevel: 'error' });
  } catch (error) {
    return { data: null, error: error instanceof Error ? error.message : String(error) };
  }
  // An empty block (or only comments) is a valid "no properties" front matter.
  if (value === null || value === undefined) return { data: {}, error: null };
  if (typeof value !== 'object' || Array.isArray(value)) {
    return { data: null, error: 'Front matter is not a key/value mapping' };
  }
  return { data: value as Record<string, unknown>, error: null };
}
