/**
 * A regular expression that finds folded query terms at word starts in ORIGINAL text, whatever
 * its case, diacritics or normalization form (NFD files from macOS). Folding a whole note just to
 * find the first match costs milliseconds per note; one regex scan costs microseconds, so snippets
 * for 50 results stay well inside the search budget. Exact highlights inside the short snippet
 * window are then computed with `foldWithMap`.
 */
import { foldForMatch } from '../markdown/normalize-text.js';

/** Latin blocks holding every precomposed Vietnamese letter and the common European ones. */
const LATIN_RANGES: [number, number][] = [
  [0x00c0, 0x024f],
  [0x1e00, 0x1eff],
];

/** folded letter → every precomposed character that folds to it (`a` → `áàảãạăâ…ÁÀ…`). */
const VARIANTS: ReadonlyMap<string, string> = (() => {
  const map = new Map<string, string>();
  for (const [from, to] of LATIN_RANGES) {
    for (let code = from; code <= to; code += 1) {
      const ch = String.fromCodePoint(code);
      const folded = foldForMatch(ch);
      if (folded.length === 1 && folded !== ch) map.set(folded, (map.get(folded) ?? '') + ch);
    }
  }
  return map;
})();

const escapeInClass = (ch: string) => (/[\\\][^-]/.test(ch) ? `\\${ch}` : ch);

function charClass(ch: string): string {
  const members = new Set([ch, ch.toUpperCase(), ...(VARIANTS.get(ch) ?? '')]);
  return `[${[...members].map(escapeInClass).join('')}]`;
}

/** Null when there is nothing to look for. Terms must already be folded (`foldedTerms`). */
export function buildTermPattern(foldedTerms: readonly string[]): RegExp | null {
  const terms = foldedTerms.filter((t) => t.length > 0);
  if (terms.length === 0) return null;
  const alternatives = terms.map((term) =>
    [...term].map((ch) => `${charClass(ch)}\\p{M}*`).join(''),
  );
  return new RegExp(`(?<![\\p{L}\\p{N}\\p{M}])(?:${alternatives.join('|')})`, 'gu');
}

/** UTF-16 index of the first match in `text`, or -1. */
export function firstMatchIndex(pattern: RegExp | null, text: string): number {
  if (!pattern) return -1;
  pattern.lastIndex = 0;
  const m = pattern.exec(text);
  return m ? m.index : -1;
}
