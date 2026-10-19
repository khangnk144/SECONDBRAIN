/**
 * Named character references (`&amp;`, `&eacute;`, …) decoded exactly as the Markdown parser does,
 * by letting the parser decode the reference on its own. Results are cached; this only runs for
 * text that holds a wikilink next to a reference, which is rare.
 */
import type { Paragraph, Root, Text } from 'mdast';
import remarkParse from 'remark-parse';
import { unified } from 'unified';

const processor = unified().use(remarkParse).freeze();
const cache = new Map<string, string | null>();

/** The decoded text of `&name;`, or null when `name` is not a valid reference. */
export function decodeNamedReference(name: string): string | null {
  const cached = cache.get(name);
  if (cached !== undefined) return cached;
  const raw = `&${name};`;
  const root = processor.parse(`x${raw}`) as Root;
  const paragraph = root.children[0] as Paragraph | undefined;
  const text = paragraph?.children[0] as Text | undefined;
  const value = paragraph?.children.length === 1 && text?.type === 'text' ? text.value : null;
  const decoded = value !== null && value !== `x${raw}` ? value.slice(1) : null;
  cache.set(name, decoded);
  return decoded;
}
