export type HighlightRange = readonly [number, number];

export interface TextPart {
  text: string;
  marked: boolean;
}

/**
 * Cuts `text` into plain and marked parts from `[start, end)` UTF-16 ranges (search terms, the
 * link inside a backlink line). Ranges are clamped to the text, sorted and merged, so ranges that
 * overlap or arrive out of order from the server never duplicate or drop characters.
 */
export function splitHighlights(text: string, ranges: readonly HighlightRange[]): TextPart[] {
  const clean = ranges
    .map(([start, end]) => [Math.max(0, start), Math.min(text.length, end)] as const)
    .filter(([start, end]) => end > start)
    .sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const [start, end] of clean) {
    const last = merged[merged.length - 1];
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  const parts: TextPart[] = [];
  let at = 0;
  for (const [start, end] of merged) {
    if (start > at) parts.push({ text: text.slice(at, start), marked: false });
    parts.push({ text: text.slice(start, end), marked: true });
    at = end;
  }
  if (at < text.length) parts.push({ text: text.slice(at), marked: false });
  return parts;
}
