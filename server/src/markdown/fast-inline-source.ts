/**
 * The text of one leaf as the inline pass sees it: its line slices joined by `\n`, with a map
 * from positions in that text back to absolute offsets in the file.
 */
export class InlineSource {
  readonly text: string;
  private readonly segments: number[] = [];

  constructor(
    content: string,
    private readonly slices: readonly number[],
  ) {
    let text = '';
    for (let k = 0; k < slices.length; k += 2) {
      if (k > 0) text += '\n';
      this.segments.push(text.length);
      text += content.slice(slices[k], slices[k + 1]);
    }
    this.text = text;
  }

  /** Absolute file offset of position `i` (a joining `\n` maps to the end of its line). */
  toAbs(i: number): number {
    // Binary search: a paragraph can have tens of thousands of lines.
    let lo = 0;
    let hi = this.segments.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((this.segments[mid] as number) <= i) lo = mid;
      else hi = mid - 1;
    }
    const seg = lo;
    const start = this.slices[seg * 2] as number;
    const length = (this.slices[seg * 2 + 1] as number) - start;
    return start + Math.min(i - (this.segments[seg] as number), length);
  }
}

/** Code span content: line endings become spaces; one wrapping space is stripped. */
export function codeSpanText(raw: string): string {
  const value = raw.replace(/\n/g, ' ');
  if (value.startsWith(' ') && value.endsWith(' ') && value.trim() !== '')
    return value.slice(1, -1);
  return value;
}

/** `indexOf` remembering its last answer per needle; valid because queries only move forward. */
export class ForwardFinder {
  private readonly found = new Map<string, { from: number; at: number }>();

  constructor(private readonly text: string) {}

  readonly find = (needle: string, from: number): number => {
    const known = this.found.get(needle);
    if (known && from >= known.from && (known.at === -1 || known.at >= from)) return known.at;
    const at = this.text.indexOf(needle, from);
    this.found.set(needle, { from, at });
    return at;
  };
}

/**
 * Finds the backtick run closing a code span. Once a run length has no closer after some
 * point it has none after any later point, so many unmatched runs cost one search each length.
 */
export class CodeSpanClosers {
  private readonly noCloserFrom = new Map<number, number>();

  constructor(private readonly text: string) {}

  /** Start of the next run of exactly `run` backticks after the opener at `at`, or -1. */
  closer(at: number, run: number): number {
    const text = this.text;
    const noCloser = this.noCloserFrom.get(run);
    let close = noCloser !== undefined && noCloser <= at ? -1 : text.indexOf('`', at + run);
    while (close !== -1) {
      let length = 1;
      while (text.charCodeAt(close + length) === 96) length += 1;
      if (length === run) return close;
      close = text.indexOf('`', close + length);
    }
    this.noCloserFrom.set(run, Math.min(noCloser ?? at, at));
    return -1;
  }
}
