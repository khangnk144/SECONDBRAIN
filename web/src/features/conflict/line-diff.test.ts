// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { changeCounts, displayLines, lineDiff } from './line-diff';

describe('conflict line diff (F3.6 "So sánh")', () => {
  it('marks lines only on disk as removed and lines only in mine as added', () => {
    const rows = lineDiff('# A\nđĩa\nchung\n', '# A\ncủa tôi\nchung\n');
    expect(rows).toEqual([
      { kind: 'same', text: '# A', oldLine: 1, newLine: 1 },
      { kind: 'removed', text: 'đĩa', oldLine: 2, newLine: null },
      { kind: 'added', text: 'của tôi', oldLine: null, newLine: 2 },
      { kind: 'same', text: 'chung', oldLine: 3, newLine: 3 },
    ]);
    expect(changeCounts(rows)).toEqual({ added: 1, removed: 1 });
  });

  it('ignores CRLF vs LF and the BOM, which are not lines', () => {
    expect(displayLines('\uFEFFa\r\nb\r\n')).toEqual(['a', 'b']);
    expect(changeCounts(lineDiff('a\r\nb\r\n', 'a\nb\n'))).toEqual({ added: 0, removed: 0 });
  });

  it('folds long unchanged stretches, keeping three lines of context', () => {
    const same = Array.from({ length: 20 }, (_, i) => `dòng ${i + 1}`);
    const disk = [...same, 'cuối đĩa'].join('\n');
    const mine = [...same, 'cuối của tôi'].join('\n');
    const rows = lineDiff(disk, mine);
    expect(rows[0]).toEqual({ kind: 'folded', count: 17 });
    expect(rows.slice(1, 4).map((row) => ('text' in row ? row.text : ''))).toEqual([
      'dòng 18',
      'dòng 19',
      'dòng 20',
    ]);
    expect(rows.slice(4).map((row) => row.kind)).toEqual(['removed', 'added']);
  });
});
