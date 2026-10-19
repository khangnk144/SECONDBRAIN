import { describe, expect, it } from 'vitest';
import { foldedTerms, searchTerms } from '../../src/index/fts-query.js';
import { buildSnippet, findMatches, SNIPPET_LENGTH } from '../../src/index/search-snippet.js';
import { buildTermPattern, firstMatchIndex } from '../../src/index/term-pattern.js';

function snippet(plain: string, q: string) {
  const terms = foldedTerms(searchTerms(q));
  return buildSnippet(plain, terms, buildTermPattern(terms));
}

const highlighted = (s: { text: string; highlights: [number, number][] } | null) =>
  s ? s.highlights.map(([a, b]) => s.text.slice(a, b)) : [];

describe('search snippets', () => {
  it('highlights diacritic-insensitive word-start matches in the original text', () => {
    const s = snippet('Ôn tập Giải tích: đạo hàm, TÍCH PHÂN và tích chập.', 'giai tich');
    expect(s?.text).toBe('Ôn tập Giải tích: đạo hàm, TÍCH PHÂN và tích chập.');
    expect(highlighted(s)).toEqual(['Giải', 'tích', 'TÍCH', 'tích']);
  });

  it('maps highlights back onto NFD text without splitting a letter from its marks', () => {
    const plain = 'Đồ án cuối kỳ'.normalize('NFD');
    const s = snippet(plain, 'do an');
    expect(highlighted(s).map((h) => h.normalize('NFC'))).toEqual(['Đồ', 'án']);
  });

  it('matches prefixes at word starts only', () => {
    expect(highlighted(snippet('bài giảng và giải bài', 'giai'))).toEqual(['giải']);
    expect(highlighted(snippet('xgiải không khớp', 'giai'))).toEqual([]);
    expect(highlighted(snippet('giảng viên', 'gia'))).toEqual(['giả']);
  });

  it('centres a long text around the first match with ellipses and stays short', () => {
    const plain = `${'mở đầu '.repeat(60)}trọng tâm là ma trận nghịch đảo ${'phần sau '.repeat(60)}`;
    const s = snippet(plain, 'ma tran');
    expect(s).not.toBeNull();
    expect(s?.text.startsWith('…')).toBe(true);
    expect(s?.text.endsWith('…')).toBe(true);
    expect((s?.text.length ?? 0) <= SNIPPET_LENGTH + 2).toBe(true);
    expect(highlighted(s)).toEqual(['ma', 'trận']);
    expect(s?.text.indexOf('ma trận')).toBeGreaterThan(10);
  });

  it('collapses line breaks and whitespace runs', () => {
    const s = snippet('Dòng một\n\n   dòng   hai\twith tab', 'hai');
    expect(s?.text).toBe('Dòng một dòng hai with tab');
    expect(highlighted(s)).toEqual(['hai']);
  });

  it('falls back to the start of the text when the body has no match, and to null when empty', () => {
    const s = snippet('Nội dung không chứa từ khóa.', 'xyz');
    expect(s).toEqual({ text: 'Nội dung không chứa từ khóa.', highlights: [] });
    expect(snippet('   \n ', 'xyz')).toBeNull();
    expect(snippet('', 'xyz')).toBeNull();
  });

  it('finds the first match in mixed case and NFD text with one regex scan', () => {
    const pattern = buildTermPattern(['dai', 'so']);
    expect(firstMatchIndex(pattern, 'Học ĐẠI SỐ')).toBe(4);
    expect(firstMatchIndex(pattern, 'Môn Đại số'.normalize('NFD'))).toBe(
      'Môn '.normalize('NFD').length,
    );
    expect(firstMatchIndex(pattern, 'không có')).toBe(-1);
    expect(firstMatchIndex(buildTermPattern([]), 'x')).toBe(-1);
    expect(findMatches('a [b] c', ['b'])).toEqual([[3, 4]]);
  });
});
