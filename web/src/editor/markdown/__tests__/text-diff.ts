/** Diff helpers for locality assertions. */
import { structuredPatch } from 'diff';

/** The changed range `[start, end)` of `before` and its replacement in `after`. */
export function changedRange(
  before: string,
  after: string,
): { start: number; end: number; inserted: string } {
  let start = 0;
  const shortest = Math.min(before.length, after.length);
  while (start < shortest && before.charCodeAt(start) === after.charCodeAt(start)) start += 1;
  let suffix = 0;
  while (
    suffix < shortest - start &&
    before.charCodeAt(before.length - 1 - suffix) === after.charCodeAt(after.length - 1 - suffix)
  ) {
    suffix += 1;
  }
  return {
    start,
    end: before.length - suffix,
    inserted: after.slice(start, after.length - suffix),
  };
}

/** Lines with their line endings (the last one may have none). */
export function splitLines(text: string): string[] {
  return text.match(/[^\r\n]*(?:\r\n|\r|\n)|[^\r\n]+$/g) ?? [];
}

/** Indexes of lines that differ when both texts have the same number of lines; null otherwise. */
export function changedLines(before: string, after: string): number[] | null {
  const a = splitLines(before);
  const b = splitLines(after);
  if (a.length !== b.length) return null;
  return a.flatMap((line, index) => (line === b[index] ? [] : [index]));
}

/** A readable unified diff for failure messages. */
export function unifiedDiff(before: string, after: string): string {
  const patch = structuredPatch('before', 'after', before, after, '', '', { context: 1 });
  return patch.hunks
    .map((hunk) => [`@@ -${hunk.oldStart} +${hunk.newStart} @@`, ...hunk.lines].join('\n'))
    .join('\n');
}
