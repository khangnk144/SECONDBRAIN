/**
 * Maps a 1-based file line (front matter counted, as in the server's backlink and mention refs)
 * to the index of the top-level block that holds it, using the converter's snapshot.
 */
import type { MarkdownSnapshot } from '../../editor/markdown/markdown-document';

/** Line breaks in a text: `\r\n`, `\n` and a lone `\r` each count once. */
function lineBreaks(text: string): number {
  let count = 0;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code === 10) count += 1;
    else if (code === 13 && text.charCodeAt(i + 1) !== 10) count += 1;
  }
  return count;
}

/** Lines in the front matter and in blank gaps map to the block that follows them. */
export function blockIndexForLine(snapshot: MarkdownSnapshot, line: number): number {
  const blocks = snapshot.blocks;
  if (blocks.length === 0) return 0;
  // The front matter text ends with its closing line break, so this is the body's first line.
  let current = 1 + lineBreaks(snapshot.frontmatter);
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    if (!block) break;
    current += lineBreaks(block.gap);
    const last = current + lineBreaks(block.source);
    if (line <= last) return index;
    current = last;
  }
  return blocks.length - 1;
}
