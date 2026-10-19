import { validation } from './vault-errors.js';
import type { TextRangePatch } from './vault-types.js';

const isHigh = (code: number) => code >= 0xd800 && code <= 0xdbff;
const isLow = (code: number) => code >= 0xdc00 && code <= 0xdfff;

/** True when offset `i` falls between the two halves of a surrogate pair (e.g. inside an emoji). */
function splitsSurrogatePair(content: string, i: number): boolean {
  return (
    i > 0 && i < content.length && isHigh(content.charCodeAt(i - 1)) && isLow(content.charCodeAt(i))
  );
}

function checkRange(content: string, patch: TextRangePatch, index: number): void {
  const { start, end, text } = patch;
  const valid =
    Number.isInteger(start) &&
    Number.isInteger(end) &&
    start >= 0 &&
    start <= end &&
    end <= content.length &&
    typeof text === 'string';
  if (!valid) throw validation('Patch range is out of bounds', { index, start, end });
  if (splitsSurrogatePair(content, start) || splitsSurrogatePair(content, end)) {
    throw validation('Patch range splits a character', { index, start, end });
  }
}

/**
 * Applies text replacements on the raw file content (SPEC §4.9 line-level operations). Offsets are
 * UTF-16 indexes into the content the client read. Overlapping ranges, and two patches starting at
 * the same offset (whose order would be ambiguous), are refused rather than guessed.
 */
export function applyTextPatches(content: string, patches: readonly TextRangePatch[]): string {
  if (!Array.isArray(patches) || patches.length === 0) throw validation('No patches given');
  patches.forEach((patch, index) => checkRange(content, patch, index));
  const sorted = [...patches].sort((a, b) => a.start - b.start || a.end - b.end);
  for (let i = 1; i < sorted.length; i += 1) {
    const previous = sorted[i - 1]!;
    const current = sorted[i]!;
    if (current.start < previous.end || current.start === previous.start) {
      throw validation('Patches overlap', { start: current.start, end: current.end });
    }
  }
  let result = '';
  let cursor = 0;
  for (const patch of sorted) {
    result += content.slice(cursor, patch.start) + patch.text;
    cursor = patch.end;
  }
  return result + content.slice(cursor);
}
