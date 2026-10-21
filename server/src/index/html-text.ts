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

/*
 * Every pass below scans forward only (indexOf and regexes without unbounded backtracking), so the
 * work is linear in the input: a hostile page (`<!--` or `<script>` repeated without an end) must
 * not freeze the server. Results are those of the plain regex replacements:
 * `<!--[\s\S]*?-->` and `<(script|style|noscript|template)\b[\s\S]*?<\/\1\s*>` → ' ', block tags
 * `<\/?(p|div|…)\b[^>]*>` → '\n', other tags `<[^>]*>` → ' ', then `\s*\n\s*` → '\n'.
 */

/** `<!-- … -->` → ' '. With no `-->` after a `<!--`, none can end after a later one either. */
function removeComments(html: string): string {
  let out = '';
  let from = 0;
  for (;;) {
    const open = html.indexOf('<!--', from);
    if (open === -1) break;
    const close = html.indexOf('-->', open + 4);
    if (close === -1) break;
    out += `${html.slice(from, open)} `;
    from = close + 3;
  }
  return out + html.slice(from);
}

const RAW_OPEN = /<(script|style|noscript|template)\b/gi;
const RAW_CLOSE: Record<string, RegExp> = {
  script: /<\/script\s*>/gi,
  style: /<\/style\s*>/gi,
  noscript: /<\/noscript\s*>/gi,
  template: /<\/template\s*>/gi,
};

/** Elements whose text is never shown → ' '. An element without its end tag stays (as text). */
function removeRawTextElements(html: string): string {
  const unclosed = new Set<string>();
  let out = '';
  let from = 0;
  RAW_OPEN.lastIndex = 0;
  for (let open = RAW_OPEN.exec(html); open; open = RAW_OPEN.exec(html)) {
    const name = open[1]!.toLowerCase();
    // No end tag after this one means none after a later one either: look only once.
    if (unclosed.has(name)) continue;
    const close = RAW_CLOSE[name]!;
    close.lastIndex = open.index + open[0].length;
    const end = close.exec(html);
    if (!end) {
      unclosed.add(name);
      RAW_OPEN.lastIndex = open.index + 1;
      continue;
    }
    out += `${html.slice(from, open.index)} `;
    from = end.index + end[0].length;
    RAW_OPEN.lastIndex = from;
  }
  return out + html.slice(from);
}

/**
 * Tags whose start matches `start` (or any tag) up to the first `>` → `replacement`. With no `>`
 * after a tag start, no later tag can end either: the rest is text.
 */
function replaceTags(html: string, start: RegExp, replacement: string): string {
  let out = '';
  let from = 0;
  start.lastIndex = 0;
  for (let tag = start.exec(html); tag; tag = start.exec(html)) {
    const end = html.indexOf('>', tag.index + tag[0].length);
    if (end === -1) break;
    out += html.slice(from, tag.index) + replacement;
    from = end + 1;
    start.lastIndex = from;
  }
  return out + html.slice(from);
}

const BLOCK_TAG_START =
  /<\/?(p|div|br|li|h[1-6]|tr|td|th|section|article|header|footer|blockquote)\b/gi;
const ANY_TAG_START = /</g;

export function htmlToText(html: string): string {
  const withoutInvisible = removeRawTextElements(removeComments(html));
  // Block-level boundaries become line breaks so words of adjacent paragraphs do not merge.
  const text = replaceTags(
    replaceTags(withoutInvisible, BLOCK_TAG_START, '\n'),
    ANY_TAG_START,
    ' ',
  );
  // Lines trimmed, blank ones dropped: the same as collapsing `\s*\n\s*` into one line break.
  return decodeEntities(text)
    .replace(/[ \t\f\v]+/g, ' ')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .join('\n');
}

export function countWords(text: string): number {
  return text.match(/[\p{L}\p{N}][\p{L}\p{N}\p{M}'’_-]*/gu)?.length ?? 0;
}
