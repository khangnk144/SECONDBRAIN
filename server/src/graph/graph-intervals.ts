/**
 * Half-open time intervals `[from, to)` in epoch ms for the graph history (SPEC F24.1). `to` may
 * be `Infinity` (still there now) and `from` `-Infinity` (there before the log began). Lists
 * produced here are sorted by `from`, disjoint and never empty-length.
 */

export interface Interval {
  from: number;
  to: number;
}

/** Sorted, merged copy (touching intervals join: [1,2) + [2,3) = [1,3)). */
export function unionIntervals(intervals: readonly Interval[]): Interval[] {
  const sorted = intervals.filter((i) => i.to > i.from).sort((a, b) => a.from - b.from);
  const out: Interval[] = [];
  for (const { from, to } of sorted) {
    const last = out[out.length - 1];
    if (last && from <= last.to) last.to = Math.max(last.to, to);
    else out.push({ from, to });
  }
  return out;
}

/** Intersection of two merged lists. */
export function intersectIntervals(a: readonly Interval[], b: readonly Interval[]): Interval[] {
  const out: Interval[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const x = a[i] as Interval;
    const y = b[j] as Interval;
    const from = Math.max(x.from, y.from);
    const to = Math.min(x.to, y.to);
    if (to > from) out.push({ from, to });
    if (x.to < y.to) i += 1;
    else j += 1;
  }
  return out;
}

/** Intersection of one interval with a merged list. */
export function clipInterval(interval: Interval, list: readonly Interval[]): Interval[] {
  return intersectIntervals([interval], list);
}
