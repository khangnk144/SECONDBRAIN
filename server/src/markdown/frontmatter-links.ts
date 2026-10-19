/**
 * Wikilinks inside the YAML block (e.g. `course: "[[Giải tích 1]]"`, SPEC §4.3, F4). They are
 * found by the same raw scan as body links and carry the property key they belong to, so the
 * relink planner can rewrite them in place and the index can tell a `course:` link from a body
 * link. Comments (`# …`) are skipped. Inside a quoted scalar the target, heading and alias are
 * reported with YAML escapes decoded (`'[[Bob''s notes]]'` names `Bob's notes`); `raw` stays the
 * exact file text.
 */
import type { ParsedLink } from './markdown-types.js';
import { lineOfOffset } from './source-lines.js';
import { parseWikilinkInner, scanWikilinks } from './wikilink-scan.js';
import { decodeYamlQuoted, type YamlQuote, yamlLineScan } from './yaml-scalar-context.js';

interface YamlLine {
  start: number;
  /** End of the text before any comment. */
  end: number;
  indent: number;
  isListItem: boolean;
  key: string | null;
  /** Offset where the key's value starts (after `key:`), for "is the link after the key". */
  keyEnd: number;
}

const KEY_PREFIX = /^[ \t]*(?:-[ \t]+)*/;
const QUOTED_KEY = /^(?:"(?:[^"\\]|\\.)*"|'(?:[^']|'')*')[ \t]*$/;
const PLAIN_KEY = /^[^\s"'#[\]{},]/;

export function scanFrontmatterLinks(
  content: string,
  yamlStart: number,
  raw: string,
  lineStarts: readonly number[],
): ParsedLink[] {
  const lines = splitYamlLines(raw, yamlStart);
  const links: ParsedLink[] = [];
  lines.forEach((line, index) => {
    scanWikilinks(content, line.start, line.end, (hit) => {
      const quote = yamlLineScan(content.slice(line.start, hit.start)).quote;
      const inner = content.slice(hit.start + (hit.kind === 'embed' ? 3 : 2), hit.end - 2);
      const parts = quote === 'plain' ? hit : parseWikilinkInner(decodeYamlQuoted(inner, quote));
      if (!parts) return;
      links.push({
        kind: hit.kind,
        raw: content.slice(hit.start, hit.end),
        target: parts.target,
        heading: parts.heading,
        alias: parts.alias,
        start: hit.start,
        end: hit.end,
        line: lineOfOffset(lineStarts, hit.start),
        frontmatterKey: keyFor(lines, index, hit.start),
      });
    });
  });
  return links;
}

/** YAML quoting around a front-matter link (needed to rewrite it without breaking YAML). */
export function frontmatterLinkQuote(content: string, link: Pick<ParsedLink, 'start'>): YamlQuote {
  const lineStart =
    Math.max(content.lastIndexOf('\n', link.start - 1), content.lastIndexOf('\r', link.start - 1)) +
    1;
  return yamlLineScan(content.slice(lineStart, link.start)).quote;
}

/** The key of the link's own line, else of the nearest enclosing key above it. */
function keyFor(lines: readonly YamlLine[], index: number, at: number): string | null {
  const own = lines[index] as YamlLine;
  if (own.key !== null && own.keyEnd <= at) return own.key;
  for (let i = index - 1; i >= 0; i -= 1) {
    const line = lines[i] as YamlLine;
    if (line.key === null) continue;
    // A sequence may sit at the same indentation as its key (`related:` / `- "[[A]]"`).
    if (line.indent < own.indent || (own.isListItem && line.indent <= own.indent)) return line.key;
  }
  return null;
}

function splitYamlLines(raw: string, base: number): YamlLine[] {
  const lines: YamlLine[] = [];
  let offset = 0;
  for (const text of raw.split(/\r\n|\n|\r/)) {
    const visible = text.slice(0, yamlLineScan(text).commentStart);
    const key = lineKey(visible);
    lines.push({
      start: base + offset,
      end: base + offset + visible.length,
      indent: /^[ \t]*/.exec(text)?.[0].length ?? 0,
      isListItem: /^[ \t]*-(?:[ \t]|$)/.test(text),
      key: key?.name ?? null,
      keyEnd: key ? base + offset + key.end : 0,
    });
    offset += text.length;
    offset += raw.startsWith('\r\n', offset) ? 2 : offset < raw.length ? 1 : 0;
  }
  return lines;
}

/**
 * `key:` at the start of a line (after indentation and `- ` markers): the first `:` followed by
 * whitespace or the line end, outside quotes. Linear time even on very long lines.
 */
function lineKey(line: string): { name: string; end: number } | null {
  const from = KEY_PREFIX.exec(line)?.[0].length ?? 0;
  const head = line.slice(from);
  const colon = keyColon(head);
  if (colon < 0) return null;
  const name = head.slice(0, colon).replace(/[ \t]+$/, '');
  if (name === '') return null;
  if (name.startsWith('"') || name.startsWith("'")) {
    return QUOTED_KEY.test(name) ? { name: name.slice(1, -1), end: from + colon + 1 } : null;
  }
  return PLAIN_KEY.test(name) ? { name, end: from + colon + 1 } : null;
}

function keyColon(head: string): number {
  if (head.startsWith('"') || head.startsWith("'")) {
    const close = yamlLineScan(head).quotedEnd;
    if (close < 0) return -1;
    const colon = head.indexOf(':', close);
    return colon >= 0 && /^[ \t]*$/.test(head.slice(close, colon)) && isKeyColon(head, colon)
      ? colon
      : -1;
  }
  for (let colon = head.indexOf(':'); colon >= 0; colon = head.indexOf(':', colon + 1)) {
    if (isKeyColon(head, colon)) return colon;
  }
  return -1;
}

function isKeyColon(head: string, colon: number): boolean {
  const next = head.charCodeAt(colon + 1);
  return Number.isNaN(next) || next === 32 || next === 9;
}
