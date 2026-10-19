/**
 * GFM table rows in a note, for writers that must not add a bare `|` inside a row (it would
 * start a new cell). Front matter is parsed as front matter so a YAML block never reads as a table.
 */
import type { Nodes } from 'mdast';
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';

const processor = unified().use(remarkParse).use(remarkFrontmatter).use(remarkGfm).freeze();

/** True when `offset` (UTF-16, into `content`) lies inside a GFM table. */
export function isInsideTable(content: string, offset: number): boolean {
  const stack: Nodes[] = [processor.parse(content)];
  while (stack.length > 0) {
    const node = stack.pop() as Nodes;
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start !== undefined && end !== undefined && (offset < start || offset > end)) continue;
    if (node.type === 'table') return true;
    if ('children' in node) stack.push(...(node.children as Nodes[]));
  }
  return false;
}
