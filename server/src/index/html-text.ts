/**
 * Readable text of a clipped web page (`3 Resources/**.html`) for search. Not a sanitizer: the
 * result is only tokenized and shown as escaped snippet text, never rendered as HTML.
 */

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body.startsWith('#')) {
      const code =
        body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : Number(body.slice(1));
      return Number.isInteger(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : whole;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

export function htmlToText(html: string): string {
  const withoutInvisible = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|template)\b[\s\S]*?<\/\1\s*>/gi, ' ');
  const text = withoutInvisible
    // Block-level boundaries become line breaks so words of adjacent paragraphs do not merge.
    .replace(
      /<\/?(p|div|br|li|h[1-6]|tr|td|th|section|article|header|footer|blockquote)\b[^>]*>/gi,
      '\n',
    )
    .replace(/<[^>]*>/g, ' ');
  return decodeEntities(text)
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}

export function countWords(text: string): number {
  return text.match(/[\p{L}\p{N}][\p{L}\p{N}\p{M}'’_-]*/gu)?.length ?? 0;
}
