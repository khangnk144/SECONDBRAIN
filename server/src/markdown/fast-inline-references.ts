/**
 * Reference links (`[text][label]`, `[label][]`, `[label]`) and GFM footnote calls (`[^n]`) for
 * the inline pass, matched against the document's definitions with the reference parser's
 * rules. They produce no Markdown link for the index, but they consume brackets: a reference
 * deactivates outer `[` like a link does, and a footnote call is never a bracket at all.
 */
import { footnoteLabelEnd, labelEnd, normalizeLabel } from './fast-definitions.js';

export interface ReferenceSets {
  /** Normalized labels of `[label]: …` definitions. */
  definitions: ReadonlySet<string>;
  /** Normalized labels of `[^label]: …` footnote definitions. */
  footnotes: ReadonlySet<string>;
}

export const NO_REFERENCES: ReferenceSets = { definitions: new Set(), footnotes: new Set() };

/** End of a defined footnote call `[^label]` whose `[` is at `at`, or -1. */
export function footnoteCallEnd(src: string, at: number, refs: ReferenceSets): number {
  if (refs.footnotes.size === 0) return -1;
  const end = footnoteLabelEnd(src, at);
  if (end < 0) return -1;
  return refs.footnotes.has(normalizeLabel(src.slice(at + 2, end - 1))) ? end : -1;
}

/**
 * Where a reference closed by the `]` at `close` ends, or -1. `labelStart` is the first
 * character after the opening `[` (or `![`). As in the reference parser: a failed `(…)` tail or
 * nothing after `]` falls back to the shortcut form; after `[` only a defined full reference or
 * `[]` with a defined text label counts.
 */
export function referenceEnd(
  src: string,
  labelStart: number,
  close: number,
  refs: ReferenceSets,
): number {
  if (refs.definitions.size === 0) return -1;
  const defined = refs.definitions.has(normalizeLabel(src.slice(labelStart, close)));
  if (src.charCodeAt(close + 1) === 91) {
    const full = labelEnd(src, close + 1);
    if (full >= 0 && refs.definitions.has(normalizeLabel(src.slice(close + 2, full - 1))))
      return full;
    return defined && src.charCodeAt(close + 2) === 93 ? close + 3 : -1;
  }
  return defined ? close + 1 : -1;
}
