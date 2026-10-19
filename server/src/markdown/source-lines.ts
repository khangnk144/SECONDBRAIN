/**
 * Line bookkeeping on the ORIGINAL file text (BOM and CRLF included), so every offset and line
 * number the parser reports can be used directly for text patches at a revision.
 * Line endings are `\r\n`, `\n` or a lone `\r`, as in CommonMark.
 */

/** `starts[i]` is the UTF-16 offset where line `i + 1` begins. */
export function buildLineStarts(content: string): number[] {
  const starts = [0];
  for (let i = 0; i < content.length; i += 1) {
    const code = content.charCodeAt(i);
    if (code === 10) starts.push(i + 1);
    else if (code === 13) {
      if (content.charCodeAt(i + 1) === 10) i += 1;
      starts.push(i + 1);
    }
  }
  return starts;
}

/** 1-based line containing `offset`. */
export function lineOfOffset(starts: readonly number[], offset: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((starts[mid] as number) <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

/** Text of 1-based `line` without its line ending. */
export function lineTextAt(content: string, starts: readonly number[], line: number): string {
  const start = starts[line - 1] ?? content.length;
  let end = starts[line] ?? content.length;
  if (end > start && content.charCodeAt(end - 1) === 10) end -= 1;
  if (end > start && content.charCodeAt(end - 1) === 13) end -= 1;
  return content.slice(start, end);
}

/** The line ending used by most lines (`\n` when there are none or it is a tie). */
export function dominantLineEnding(content: string): '\n' | '\r\n' {
  let crlf = 0;
  let lf = 0;
  let index = content.indexOf('\n');
  while (index !== -1) {
    if (index > 0 && content.charCodeAt(index - 1) === 13) crlf += 1;
    else lf += 1;
    index = content.indexOf('\n', index + 1);
  }
  return crlf > lf ? '\r\n' : '\n';
}
