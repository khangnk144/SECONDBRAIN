/**
 * The line around a range of a note, cut to a budget, for backlinks and unlinked mentions
 * (SPEC F5: "the line containing the link, ≤ 160 chars, link highlighted").
 */

/** Context budget in UTF-16 code units, ellipses included. */
export const CONTEXT_LENGTH = 160;

export interface LineContext {
  context: string;
  /** `[start, end)` of the range inside `context`. */
  highlight: [number, number];
}

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high);

/** The line(s) holding `[start, end)`, trimmed, or cut around the range with ellipses. */
export function lineContext(content: string, start: number, end: number): LineContext {
  const lineStart = content.lastIndexOf('\n', start - 1) + 1;
  const newline = content.indexOf('\n', end);
  const line = content
    .slice(lineStart, newline === -1 ? content.length : newline)
    .replace(/\r$/, '');
  const [rangeStart, rangeEnd] = [start - lineStart, end - lineStart];
  if (line.length <= CONTEXT_LENGTH) {
    const text = line.trim();
    const lead = line.length - line.trimStart().length;
    const from = clamp(rangeStart - lead, 0, text.length);
    return { context: text, highlight: [from, clamp(rangeEnd - lead, from, text.length)] };
  }
  const budget = CONTEXT_LENGTH - 2;
  const rangeLength = Math.min(rangeEnd - rangeStart, budget);
  let from = Math.max(0, rangeStart - Math.floor((budget - rangeLength) / 2));
  const to = Math.min(line.length, from + budget);
  from = Math.max(0, to - budget);
  const prefix = from > 0 ? '…' : '';
  const text = `${prefix}${line.slice(from, to)}${to < line.length ? '…' : ''}`;
  const shift = prefix.length - from;
  const visibleEnd = prefix.length + (to - from);
  const highlightStart = clamp(rangeStart + shift, prefix.length, visibleEnd);
  return {
    context: text,
    highlight: [highlightStart, clamp(rangeEnd + shift, highlightStart, visibleEnd)],
  };
}
