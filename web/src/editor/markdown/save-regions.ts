/**
 * Which pieces of a save must be checked: changed pieces (edited, new, moved) with their unchanged
 * neighbours as context, and seams broken by a deletion.
 */
import type { BlockMatch } from './block-matching';

/** Index ranges `[from, to]` of pieces touched by a change (changed pieces and broken seams). */
export function saveRegions(
  matches: readonly BlockMatch[],
  originalCount: number,
): Array<[number, number]> {
  const count = matches.length;
  const originalOf = (i: number): number | null => {
    const match = matches[i] as BlockMatch;
    return match.kind === 'same' ? match.original : null;
  };
  // A seam before piece i is intact when both sides are unchanged neighbours in the original.
  const intact = (i: number): boolean => {
    if (i === 0) return originalOf(0) === 0;
    if (i === count) return originalOf(count - 1) === originalCount - 1;
    const left = originalOf(i - 1);
    const right = originalOf(i);
    return left !== null && right !== null && right === left + 1;
  };
  // Changed pieces are checked with their unchanged neighbours as context. A seam between two
  // unchanged pieces is only broken by a deletion; its right piece (or, at the end, the last
  // piece) joins a region so the seam is checked too.
  const changed = (i: number): boolean => originalOf(i) === null;
  const involved = (i: number): boolean =>
    changed(i) ||
    (!intact(i) && (i === 0 || !changed(i - 1))) ||
    (i === count - 1 && !intact(count));
  const result: Array<[number, number]> = [];
  for (let i = 0; i < count; i += 1) {
    if (!involved(i)) continue;
    let j = i;
    while (j + 1 < count && involved(j + 1)) j += 1;
    result.push([i, j]);
    i = j;
  }
  return result;
}
