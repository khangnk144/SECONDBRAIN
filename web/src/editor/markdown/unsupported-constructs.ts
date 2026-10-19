/**
 * Constructs the editor keeps as verbatim blocks (SPEC §4.9) that the mdast tree alone does not
 * reveal: math written with dollar signs, Obsidian callouts (`> [!note]`, whose `[` the
 * serializer would escape) and NUL characters (which the parser replaces). Everything the mdast
 * mapping cannot represent is rejected by the converter itself with `UnsupportedConstruct`.
 */
import type { Nodes } from 'mdast';

export class UnsupportedConstruct extends Error {
  constructor(what: string) {
    super(`Unsupported Markdown construct: ${what}`);
    this.name = 'UnsupportedConstruct';
  }
}

/**
 * The block's raw text with code, inline code, HTML, images and link destinations blanked out
 * (line breaks kept): what is left is text a reader sees.
 */
export function maskedBlockSource(text: string, node: Nodes): string {
  const start = node.position?.start.offset ?? 0;
  let masked = text.slice(start, node.position?.end.offset ?? 0);
  const blankRange = (from: number, to: number): void => {
    const a = from - start;
    const b = to - start;
    masked = masked.slice(0, a) + masked.slice(a, b).replace(/[^\n]/g, ' ') + masked.slice(b);
  };
  const blank = (inner: Nodes): void => {
    const from = inner.position?.start.offset ?? start;
    const to = inner.position?.end.offset ?? start;
    if (['code', 'inlineCode', 'html', 'image'].includes(inner.type)) return blankRange(from, to);
    if (inner.type === 'link') {
      // `[text](destination)`: only the text is visible; autolinks are all destination.
      const last = inner.children[inner.children.length - 1];
      const textEnd = text.charCodeAt(from) === 91 ? (last?.position?.end.offset ?? from) : from;
      blankRange(textEnd, to);
    }
    if ('children' in inner) for (const child of inner.children) blank(child);
  };
  blank(node);
  return masked;
}

// `$…$`: the opening `$` is followed and the closing `$` preceded by a non-space; never across
// a blank line. `$$` anywhere is display math.
const INLINE_MATH = /(?<!\\)\$(?=[^\s$])(?:[^$\n]|\n(?![ \t>]*\n))*?[^\s\\]\$/;

export function containsMath(masked: string): boolean {
  return masked.includes('$$') || INLINE_MATH.test(masked);
}

/** A block quote anywhere in the block whose text starts with `[!type]` (an Obsidian callout). */
export function containsCallout(text: string, node: Nodes): boolean {
  if (node.type === 'blockquote') {
    const first = node.children[0];
    if (first && text.startsWith('[!', first.position?.start.offset ?? -1)) return true;
  }
  return 'children' in node && node.children.some((child) => containsCallout(text, child));
}

export function containsNul(raw: string): boolean {
  return raw.includes('\0');
}
