/**
 * Raw HTML recognition as defined by CommonMark 0.31 (the version the reference parser
 * implements): the seven HTML block start/end conditions and inline raw HTML / autolinks.
 * Raw HTML is excluded from link and tag scanning (SPEC §4.4: links in HTML are not links).
 */

const TAG_NAME = '[A-Za-z][A-Za-z0-9-]*';
const WS = '[ \\t\\r\\n]';
const ATTRIBUTE_NAME = '[A-Za-z_:][A-Za-z0-9_.:-]*';
const ATTRIBUTE_VALUE = `(?:[^"'=<>\`\\x00-\\x20]+|'[^']*'|"[^"]*")`;
const ATTRIBUTE = `(?:${WS}+${ATTRIBUTE_NAME}(?:${WS}*=${WS}*${ATTRIBUTE_VALUE})?)`;
const OPEN_TAG = `<${TAG_NAME}${ATTRIBUTE}*${WS}*/?>`;
const CLOSE_TAG = `</${TAG_NAME}${WS}*>`;

const BLOCK_NAMES =
  'address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|' +
  'dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|' +
  'header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|' +
  'param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul';

/** Start conditions of HTML block types 1–7, tested on the line from its first non-space. */
const BLOCK_OPEN: readonly RegExp[] = [
  /^<(?:pre|script|style|textarea)(?:[ \t>]|$)/i,
  /^<!--/,
  /^<\?/,
  /^<![A-Za-z]/,
  /^<!\[CDATA\[/,
  new RegExp(`^</?(?:${BLOCK_NAMES})(?:[ \\t]|/?>|$)`, 'i'),
  new RegExp(`^(?:${OPEN_TAG}|${CLOSE_TAG})[ \\t]*$`),
];

/** End conditions of types 1–4 (5 is `cdataEnds`; 6 and 7 end at a blank line). */
const BLOCK_CLOSE: readonly RegExp[] = [/<\/(?:pre|script|style|textarea)>/i, /-->/, /\?>/, />/];

/** HTML block type (1–7) starting at `line`, or 0. Type 7 may not interrupt a paragraph. */
export function htmlBlockStart(line: string, canInterruptParagraph: boolean): number {
  for (let type = 1; type <= 6; type += 1) {
    if ((BLOCK_OPEN[type - 1] as RegExp).test(line)) return type;
  }
  // Type 7 is any other complete tag alone on its line (`<pre>` itself is already type 1).
  if (!canInterruptParagraph) return 0;
  return (BLOCK_OPEN[6] as RegExp).test(line) ? 7 : 0;
}

export function htmlBlockEnds(type: number, line: string): boolean {
  if (type === 5) return cdataEnds(line);
  return type <= 4 && (BLOCK_CLOSE[type - 1] as RegExp).test(line);
}

/**
 * `]]>` as the reference parser's state machine sees it: a `]` after `]]` restarts the match,
 * so `]]]>` does not end the block (but `]]]]>` does).
 */
function cdataEnds(line: string): boolean {
  let state = 0;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (state === 2 && ch === '>') return true;
    if (state === 1 && ch === ']') state = 2;
    else state = ch === ']' ? 1 : 0;
  }
  return false;
}

const INLINE_TAG = new RegExp(`${OPEN_TAG}|${CLOSE_TAG}`, 'y');
// CommonMark defines autolinks by excluding ASCII control characters, space, `<` and `>`.
// eslint-disable-next-line no-control-regex
const URI_AUTOLINK = /<[A-Za-z][A-Za-z0-9+.-]{1,31}:[^<>\x00-\x20\x7f]*>/y;
const EMAIL_AUTOLINK =
  /<[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*>/y;

/** End index of an autolink (`<scheme:…>`, `<a@b.c>`) starting at `at`, or -1. */
export function autolinkEnd(text: string, at: number): number {
  for (const re of [URI_AUTOLINK, EMAIL_AUTOLINK]) {
    re.lastIndex = at;
    if (re.test(text)) return re.lastIndex;
  }
  return -1;
}

/** `indexOf` on the scanned text; the inline scanner passes a memoized one. */
export type FindFrom = (needle: string, from: number) => number;

/**
 * End index of inline raw HTML starting at `at`, or -1: an open or closing tag, a comment
 * (`<!-->`, `<!--->` or `<!-- … -->`), a processing instruction, a declaration or CDATA.
 * Terminators are found with `find`, so many unterminated `<!--` cost one search in total.
 */
export function inlineHtmlEnd(
  text: string,
  at: number,
  find: FindFrom = (needle, from) => text.indexOf(needle, from),
): number {
  if (text.startsWith('<!--', at)) {
    if (text.startsWith('<!-->', at)) return at + 5;
    if (text.startsWith('<!--->', at)) return at + 6;
    return endAfter(find('-->', at + 4), 3);
  }
  if (text.startsWith('<?', at)) return endAfter(find('?>', at + 2), 2);
  if (text.startsWith('<![CDATA[', at)) return endAfter(find(']]>', at + 9), 3);
  if (text.startsWith('<!', at) && /[A-Za-z]/.test(text[at + 2] ?? '')) {
    return endAfter(find('>', at + 3), 1);
  }
  INLINE_TAG.lastIndex = at;
  return INLINE_TAG.test(text) ? INLINE_TAG.lastIndex : -1;
}

function endAfter(index: number, length: number): number {
  return index < 0 ? -1 : index + length;
}
