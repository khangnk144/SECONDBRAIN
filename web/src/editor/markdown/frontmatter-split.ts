/**
 * Front matter detection with the server's fence rules (server/src/markdown/frontmatter.ts):
 * only a block at the very start of the text (after an optional BOM) counts — a `---` line, the
 * YAML, then a `---` or `...` line. `\r\n`, `\n` and a lone `\r` all end a line. The YAML itself
 * is not parsed here: the editor carries the block verbatim.
 */

export interface FrontmatterSplit {
  /** The whole block including both fence lines and the closing line's line ending. */
  raw: string | null;
  /** Offset where the Markdown body starts (after the BOM and the front matter block). */
  bodyStart: number;
}

const OPEN_FENCE = /---[ \t]*(?:\r\n|\n|\r)/y;
const CLOSE_FENCE = /^(?:---|\.\.\.)[ \t]*$/;

export function splitFrontmatter(content: string): FrontmatterSplit {
  const bom = content.charCodeAt(0) === 0xfeff ? 1 : 0;
  OPEN_FENCE.lastIndex = bom;
  const open = OPEN_FENCE.exec(content);
  if (!open) return { raw: null, bodyStart: bom };
  let lineStart = bom + open[0].length;
  while (lineStart <= content.length) {
    const { text, next } = readLine(content, lineStart);
    if (CLOSE_FENCE.test(text)) return { raw: content.slice(bom, next), bodyStart: next };
    if (next === lineStart) break;
    lineStart = next;
  }
  return { raw: null, bodyStart: bom };
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
