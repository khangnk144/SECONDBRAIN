import Database from 'better-sqlite3';
import { afterAll, describe, expect, it } from 'vitest';
import { foldedTerms, ftsMatchExpression, searchTerms } from '../../src/index/fts-query.js';
import { createSchema } from '../../src/index/index-schema.js';
import { normalizeForIndex } from '../../src/markdown/normalize-text.js';

const db = new Database(':memory:');
createSchema(db);
const insert = db.prepare(
  'INSERT INTO notes_fts(rowid, path, title_norm, body_norm) VALUES (?, ?, ?, ?)',
);
[
  ['Giải tích 1', 'Đạo hàm, tích phân và chuỗi Taylor.'],
  ['Đại số tuyến tính', 'Ma trận và định thức (NEAR the end).'],
  ['Đồ án Giải tích', 'Nộp báo cáo "cuối kỳ" - C++ * ghi chú'],
].forEach(([title, body], i) =>
  insert.run(
    i + 1,
    `n${i}.md`,
    normalizeForIndex(title as string),
    normalizeForIndex(body as string),
  ),
);
afterAll(() => db.close());

function match(q: string, column?: 'title_norm'): number[] {
  const expr = ftsMatchExpression(searchTerms(q), column);
  if (!expr) return [];
  return db
    .prepare('SELECT rowid FROM notes_fts WHERE notes_fts MATCH ? ORDER BY rowid')
    .pluck()
    .all(expr) as number[];
}

describe('FTS query building (F8.2)', () => {
  it('normalizes terms (NFC, lowercase, đ→d) and keeps diacritics for the tokenizer', () => {
    expect(searchTerms('Đồ ÁN  đồ')).toEqual(['dồ', 'án']);
    expect(searchTerms('Giải tích'.normalize('NFD'))).toEqual(searchTerms('Giải tích'));
    expect(foldedTerms(searchTerms('Giải tích'))).toEqual(['giai', 'tich']);
  });

  it('matches without diacritics, by prefix, in any order', () => {
    expect(match('giai tich')).toEqual([1, 3]);
    expect(match('dai so')).toEqual([2]);
    expect(match('do an')).toEqual([3]);
    expect(match('tich giai')).toEqual([1, 3]);
    expect(match('gia')).toEqual([1, 3]);
  });

  it('restricts to the title column when asked', () => {
    expect(match('giai', 'title_norm')).toEqual([1, 3]);
    expect(match('dao ham', 'title_norm')).toEqual([]);
    expect(match('dao ham')).toEqual([1]);
  });

  it('NFD and NFC input give the same results', () => {
    expect(match('Đại số'.normalize('NFD'))).toEqual(match('Đại số'));
  });

  it('never produces an FTS syntax error, whatever the input', () => {
    const nasty = [
      '"',
      '""',
      '*',
      '-',
      '(',
      ')',
      ':',
      'NEAR',
      'NEAR(a b)',
      'a OR b',
      'AND',
      'NOT x',
      '^x',
      '+',
      '{title_norm}: x',
      'title_norm: x',
      'c++',
      '"cuối kỳ',
      "'",
      '\\',
      '́',
      'á',
      '🙂',
      '\u0000',
      'x'.repeat(5000),
      Array.from({ length: 50 }, (_, i) => `w${i}`).join(' '),
    ];
    for (const q of nasty) expect(() => match(q), q).not.toThrow();
    expect(match('NEAR')).toEqual([2]);
    expect(match('"cuối kỳ')).toEqual([3]);
    expect(match('c++')).toContain(3);
  });

  it('drops terms that are only combining marks (they would match nothing)', () => {
    expect(searchTerms('́ giải')).toEqual(['giải']);
    expect(match('́ giai')).toEqual([1, 3]);
    expect(ftsMatchExpression(searchTerms('*** ---'))).toBeNull();
  });
});
