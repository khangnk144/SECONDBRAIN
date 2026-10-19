import { describe, expect, it } from 'vitest';
import {
  foldForMatch,
  foldWithMap,
  linkIdentityKey,
  normalizeForIndex,
} from '../../src/markdown/normalize-text.js';

/** What FTS5 `remove_diacritics 2` does on top of normalizeForIndex, for the assertions. */
function ftsKey(value: string): string {
  return normalizeForIndex(value).normalize('NFD').replace(/\p{M}/gu, '');
}

describe('normalizeForIndex and foldForMatch (F8.2, F4.1)', () => {
  it('lowercases after NFC and folds đ/Đ to d', () => {
    expect(normalizeForIndex('Đại Số')).toBe('dại số');
    expect(normalizeForIndex('ĐỒ ÁN')).toBe('dồ án');
  });

  it('makes unaccented queries match Vietnamese titles once diacritics are stripped', () => {
    expect(ftsKey('Giải tích 1')).toContain(ftsKey('giai tich'));
    expect(ftsKey('Đại số tuyến tính')).toContain(ftsKey('dai so'));
    expect(ftsKey('Đồ án môn học')).toContain(ftsKey('do an'));
    expect(foldForMatch('Giải tích 1')).toBe('giai tich 1');
    expect(foldForMatch('Đại số tuyến tính')).toBe('dai so tuyen tinh');
    expect(foldForMatch('Đồ án')).toBe('do an');
  });

  it('treats NFC and NFD input the same', () => {
    const nfc = 'Bài giảng Giải tích Đồ án';
    const nfd = nfc.normalize('NFD');
    expect(nfd).not.toBe(nfc);
    expect(normalizeForIndex(nfd)).toBe(normalizeForIndex(nfc));
    expect(foldForMatch(nfd)).toBe(foldForMatch(nfc));
  });

  it('keeps non-Latin text and emoji intact apart from case', () => {
    expect(normalizeForIndex('ΑΒΓ 📅 日本')).toBe('αβγ 📅 日本');
    expect(foldForMatch('Crème brûlée')).toBe('creme brulee');
  });
});

describe('foldWithMap', () => {
  it('produces the same folded text as foldForMatch with one index per folded character', () => {
    for (const text of ['Giải tích 1', 'ĐẠI SỐ', 'Đồ án'.normalize('NFD'), 'a😀b', '']) {
      const { folded, map } = foldWithMap(text);
      expect(folded).toBe(foldForMatch(text));
      expect(map).toHaveLength(folded.length + 1);
      expect(map[folded.length]).toBe(text.length);
    }
  });

  it('maps a folded match back to the original span, diacritics intact', () => {
    const original = 'Ôn tập Giải tích 1 trước thi';
    const { folded, map } = foldWithMap(original);
    const at = folded.indexOf('giai tich');
    const span = original.slice(map[at], map[at + 'giai tich'.length]);
    expect(span).toBe('Giải tích');
  });

  it('maps highlights in NFD text to whole characters (base letter plus its marks)', () => {
    const original = 'Đồ án cuối kỳ'.normalize('NFD');
    const { folded, map } = foldWithMap(original);
    const at = folded.indexOf('an');
    const span = original.slice(map[at], map[at + 2]);
    expect(span.normalize('NFC')).toBe('án');
  });
});

describe('linkIdentityKey', () => {
  it('is NFC + lowercase only: case and NFD fold, đ stays distinct from d', () => {
    expect(linkIdentityKey('ĐÔNG/Bài 1')).toBe('đông/bài 1');
    expect(linkIdentityKey('Giải tích'.normalize('NFD'))).toBe(linkIdentityKey('giải TÍCH'));
    expect(linkIdentityKey('Đông')).not.toBe(linkIdentityKey('Dông'));
    expect(normalizeForIndex('Đông')).toBe(normalizeForIndex('Dông'));
  });
});
