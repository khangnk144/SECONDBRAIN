/**
 * Just enough YAML scalar syntax to read and rewrite wikilinks inside front matter without a
 * full YAML parse per link: where quoted scalars start and end on a line, where a comment
 * starts, and how text is escaped inside `'…'` and `"…"`.
 */

export type YamlQuote = 'single' | 'double' | 'plain';

export interface YamlLineScan {
  /** Quote state at the end of the scanned text. */
  quote: YamlQuote;
  /** Index of the `#` that starts a comment outside quotes (text length when none). */
  commentStart: number;
  /** End (exclusive) of the quoted scalar the text starts with, or -1. */
  quotedEnd: number;
}

/** A quote opens a scalar only where a YAML token can start (`it's` is plain text). */
function opensScalar(text: string, at: number): boolean {
  if (at === 0) return true;
  const before = text[at - 1];
  return before === ' ' || before === '\t' || before === '[' || before === '{' || before === ',';
}

export function yamlLineScan(text: string): YamlLineScan {
  let quote: YamlQuote = 'plain';
  let quotedEnd = -1;
  let openedAtStart = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote === 'single') {
      if (ch !== "'") continue;
      if (text[i + 1] === "'") {
        i += 1; // `''` is an escaped quote
        continue;
      }
    } else if (quote === 'double') {
      if (ch === '\\') {
        i += 1;
        continue;
      }
      if (ch !== '"') continue;
    } else {
      if ((ch === '"' || ch === "'") && opensScalar(text, i)) {
        quote = ch === '"' ? 'double' : 'single';
        openedAtStart = i === 0;
      } else if (ch === '#' && (i === 0 || text[i - 1] === ' ' || text[i - 1] === '\t')) {
        return { quote, commentStart: i, quotedEnd };
      }
      continue;
    }
    // Closing quote of the current scalar.
    quote = 'plain';
    if (openedAtStart && quotedEnd < 0) quotedEnd = i + 1;
  }
  return { quote, commentStart: text.length, quotedEnd };
}

/** Decodes the escapes YAML applies inside a quoted scalar (`\|` is kept for wikilinks). */
export function decodeYamlQuoted(text: string, quote: YamlQuote): string {
  if (quote === 'single') return text.replaceAll("''", "'");
  if (quote === 'double') return text.replace(/\\(["\\/])/g, '$1');
  return text;
}

export function encodeYamlQuoted(text: string, quote: YamlQuote): string {
  if (quote === 'single') return text.replaceAll("'", "''");
  if (quote === 'double') return text.replace(/["\\]/g, '\\$&');
  return text;
}

/**
 * Whether text written inside an unquoted YAML value could change how the value parses
 * (flow indicators, `: `, ` #`, quotes and other indicator characters). Conservative.
 */
export function needsYamlQuoting(text: string): boolean {
  return /[:#,[\]{}"'&*!|>%@`]|^\s|\s$/.test(text);
}
