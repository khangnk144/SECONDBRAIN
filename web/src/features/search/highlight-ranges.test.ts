import { describe, expect, it } from 'vitest';
import { splitHighlights } from './highlight-ranges';

const marked = (text: string, ranges: [number, number][]) =>
  splitHighlights(text, ranges)
    .map((part) => (part.marked ? `[${part.text}]` : part.text))
    .join('');

describe('highlight ranges', () => {
  it('marks each range once, in text order', () => {
    expect(
      marked('Ôn Giải tích 1 và Đại số', [
        [18, 24],
        [3, 14],
      ]),
    ).toBe('Ôn [Giải tích 1] và [Đại số]');
  });

  it('merges overlapping ranges and clamps them to the text', () => {
    expect(
      marked('abcdef', [
        [1, 3],
        [2, 4],
        [5, 99],
        [-3, 0],
        [4, 4],
      ]),
    ).toBe('a[bcd]e[f]');
  });

  it('returns the plain text when there is nothing to mark', () => {
    expect(splitHighlights('plain', [])).toEqual([{ text: 'plain', marked: false }]);
  });
});
