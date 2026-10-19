/**
 * Character references (`&amp;`, `&#123;`, `&#x1F;`) and backslash escapes for the fast inline
 * scanner. Numeric references follow the reference parser's replacement rules. Only a handful
 * of named references are known here; any other `&name;` makes the note fall back to the full
 * parser, which has the complete HTML5 table.
 */
import { FullParseRequired } from './fast-block-types.js';

// Named references common in notes and web clippings (HTML5 values: the Latin-1 block plus
// typographic punctuation); any other name sends the note to the full parser.
// prettier-ignore
const NAMED_CODES: Readonly<Record<string, number>> = {
  quot: 34, amp: 38, apos: 39, lt: 60, gt: 62, nbsp: 160, iexcl: 161, cent: 162, pound: 163,
  curren: 164, yen: 165, brvbar: 166, sect: 167, uml: 168, copy: 169, ordf: 170, laquo: 171,
  not: 172, shy: 173, reg: 174, macr: 175, deg: 176, plusmn: 177, sup2: 178, sup3: 179,
  acute: 180, micro: 181, para: 182, middot: 183, cedil: 184, sup1: 185, ordm: 186, raquo: 187,
  frac14: 188, frac12: 189, frac34: 190, iquest: 191, Agrave: 192, Aacute: 193, Acirc: 194,
  Atilde: 195, Auml: 196, Aring: 197, AElig: 198, Ccedil: 199, Egrave: 200, Eacute: 201,
  Ecirc: 202, Euml: 203, Igrave: 204, Iacute: 205, Icirc: 206, Iuml: 207, ETH: 208, Ntilde: 209,
  Ograve: 210, Oacute: 211, Ocirc: 212, Otilde: 213, Ouml: 214, times: 215, Oslash: 216,
  Ugrave: 217, Uacute: 218, Ucirc: 219, Uuml: 220, Yacute: 221, THORN: 222, szlig: 223,
  agrave: 224, aacute: 225, acirc: 226, atilde: 227, auml: 228, aring: 229, aelig: 230,
  ccedil: 231, egrave: 232, eacute: 233, ecirc: 234, euml: 235, igrave: 236, iacute: 237,
  icirc: 238, iuml: 239, eth: 240, ntilde: 241, ograve: 242, oacute: 243, ocirc: 244,
  otilde: 245, ouml: 246, divide: 247, oslash: 248, ugrave: 249, uacute: 250, ucirc: 251,
  uuml: 252, yacute: 253, thorn: 254, yuml: 255, ensp: 8194, emsp: 8195, thinsp: 8201,
  zwnj: 8204, zwj: 8205, lrm: 8206, rlm: 8207, ndash: 8211, mdash: 8212, lsquo: 8216,
  rsquo: 8217, sbquo: 8218, ldquo: 8220, rdquo: 8221, bdquo: 8222, dagger: 8224, Dagger: 8225,
  bull: 8226, hellip: 8230, permil: 8240, prime: 8242, Prime: 8243, lsaquo: 8249, rsaquo: 8250,
  euro: 8364, trade: 8482, larr: 8592, uarr: 8593, rarr: 8594, darr: 8595, harr: 8596,
  minus: 8722, infin: 8734, ne: 8800, le: 8804, ge: 8805,
};

/** Sticky: a reference starting at `lastIndex`. */
export const CHARACTER_REFERENCE =
  /&(?:#([0-9]{1,7})|#[xX]([0-9A-Fa-f]{1,6})|([A-Za-z][A-Za-z0-9]{0,31}));/y;

/** Decoded text of a `CHARACTER_REFERENCE` match. */
export function decodeReference(match: RegExpExecArray): string {
  const [, decimal, hex, name] = match;
  if (name !== undefined) {
    const value = NAMED_CODES[name];
    if (value === undefined) throw new FullParseRequired('named character reference');
    return String.fromCharCode(value);
  }
  const code =
    decimal !== undefined ? Number.parseInt(decimal, 10) : Number.parseInt(hex as string, 16);
  return isReplaced(code) ? '�' : String.fromCodePoint(code);
}

function isReplaced(code: number): boolean {
  return (
    code < 9 ||
    code === 11 ||
    (code > 13 && code < 32) ||
    (code > 126 && code < 160) ||
    (code > 55295 && code < 57344) ||
    (code > 64975 && code < 65008) ||
    (code & 65535) === 65535 ||
    (code & 65535) === 65534 ||
    code > 1114111
  );
}

export function isAsciiPunctuation(code: number): boolean {
  return (
    (code >= 33 && code <= 47) ||
    (code >= 58 && code <= 64) ||
    (code >= 91 && code <= 96) ||
    (code >= 123 && code <= 126)
  );
}

/** Decodes backslash escapes and character references (link destinations). */
export function decodeEscapesAndReferences(value: string): string {
  if (!value.includes('\\') && !value.includes('&')) return value;
  let out = '';
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code === 92 && isAsciiPunctuation(value.charCodeAt(i + 1))) {
      out += value[i + 1];
      i += 1;
    } else if (code === 38) {
      CHARACTER_REFERENCE.lastIndex = i;
      const match = CHARACTER_REFERENCE.exec(value);
      if (match) {
        out += decodeReference(match);
        i += match[0].length - 1;
      } else out += '&';
    } else out += value[i];
  }
  return out;
}
