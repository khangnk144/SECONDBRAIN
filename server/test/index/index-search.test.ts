import { utimesSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createIndexedVault,
  fixtureFiles,
  makeClock,
  titles,
  type IndexedVault,
} from './helpers/index-test-vault.js';

const clock = makeClock(new Date(2026, 9, 21, 9, 0));
let v: IndexedVault;

beforeAll(async () => {
  v = await createIndexedVault({ files: fixtureFiles('search-vault'), now: clock.now });
  // A file created on macOS keeps its NFD name on disk; it must be found by NFC queries.
  const nfdName = 'Xác suất thống kê.md'.normalize('NFD');
  writeFileSync(path.join(v.root, '2 Areas', nfdName), 'Biến ngẫu nhiên và kỳ vọng.\n');
  await v.index.reconcile();
});
afterAll(() => v.cleanup());

const search = (q: string, extra: object = {}) => v.index.search({ q, ...extra });

describe('diacritic-insensitive search (F8.2)', () => {
  it('finds Vietnamese titles typed without diacritics', () => {
    expect(titles(search('giai tich')).slice(0, 2).sort()).toEqual([
      'Giải tích 1',
      'Đồ án Giải tích',
    ]);
    expect(titles(search('dai so'))[0]).toBe('Đại số tuyến tính');
    expect(titles(search('do an')).slice(0, 4)).toEqual(
      expect.arrayContaining(['Đồ án Giải tích', 'Đồ án Xác suất', 'Đồ án đã xong', 'Đồ án cũ']),
    );
    expect(titles(search('xac suat thong ke'))).toContain('Xác suất thống kê');
  });

  it('ranks title matches above body matches and labels them', () => {
    const results = search('giai tich');
    const firstBody = results.findIndex((r) => r.matchedIn === 'body');
    expect(firstBody).toBeGreaterThan(0);
    expect(results.slice(0, firstBody).every((r) => r.matchedIn === 'title')).toBe(true);
    expect(results.slice(firstBody).every((r) => r.matchedIn === 'body')).toBe(true);
    expect(Math.min(...results.slice(0, firstBody).map((r) => r.score))).toBeGreaterThan(
      Math.max(...results.slice(firstBody).map((r) => r.score)),
    );
    expect(titles(results.slice(firstBody))).toEqual(
      expect.arrayContaining(['Ý tưởng', 'Đạo hàm', 'Trang lưu']),
    );
  });

  it('searches only searchable classes: templates and attachments never show up', () => {
    const paths = search('giai tich').map((r) => r.path);
    expect(paths).not.toContain('Templates/Mẫu giải tích.md');
    expect(search('PNG').length).toBe(0);
  });

  it('indexes clipped HTML pages as text without markup, scripts or styles', () => {
    const html = search('fourier').find((r) => r.path === '3 Resources/web/Trang lưu.html');
    expect(html).toMatchObject({ title: 'Trang lưu', class: 'source', matchedIn: 'body' });
    expect(html?.snippet?.text).toBe('x Giải tích nâng cao Bài viết về chuỗi Fourier & tích phân.');
    expect(search('color red').length).toBe(0);
    expect(search('var').length).toBe(0);
  });

  it('builds snippets from the original text with highlights', () => {
    const idea = search('tich phan').find((r) => r.title === 'Ý tưởng');
    expect(idea?.snippet?.text).toBe(
      'Ôn lại giải tích trước kỳ thi; hỏi thầy về TÍCH PHÂN suy rộng.',
    );
    const marked = idea?.snippet?.highlights.map(([a, b]) => idea.snippet?.text.slice(a, b));
    expect(marked).toEqual(['tích', 'TÍCH', 'PHÂN']);
  });

  it('NFD and NFC queries give identical results and snippets', () => {
    for (const q of ['Giải tích', 'Đồ án', 'Đại số'])
      expect(search(q.normalize('NFD'))).toEqual(search(q));
  });

  it('never throws on FTS special characters', () => {
    for (const q of [
      '"',
      '"giải',
      '*',
      'giải*',
      '-',
      '-giải',
      '(',
      'giải)',
      'NEAR(a b)',
      'a OR',
      ':',
      'tag:"',
      '\\',
      "'",
    ]) {
      expect(() => search(q), q).not.toThrow();
    }
    expect(titles(search('"giải tích"'))).toContain('Giải tích 1');
  });

  it('a query with nothing searchable in it finds nothing (only a blank box shows recents)', () => {
    for (const q of ['😀', '🙂🙂', '"(*-', '!!! ...', '—']) expect(search(q), q).toEqual([]);
    expect(search('').length).toBeGreaterThan(0);
  });

  it('an empty query lists the most recently modified searchable notes', () => {
    const idea = path.join(v.root, '0 Inbox', 'Ý tưởng.md');
    const future = new Date(2030, 0, 1);
    utimesSync(idea, future, future);
    return v.index.updateFile('0 Inbox/Ý tưởng.md').then(() => {
      const recents = search('');
      expect(recents.length).toBeLessThanOrEqual(8);
      expect(recents[0]).toMatchObject({ title: 'Ý tưởng', matchedIn: 'recent', snippet: null });
      expect(recents.some((r) => r.class === 'template' || r.class === 'attachment')).toBe(false);
      expect(search('   ')).toEqual(recents);
    });
  });
});

describe('search filters (groundwork for F8.3)', () => {
  it('tag:đồ-án due:7d returns only user notes with an open item within 7 days', () => {
    const results = search('tag:đồ-án due:7d');
    expect(titles(results)).toEqual(['Đồ án Giải tích']);
    expect(results[0]?.matchedIn).toBe('filter');
  });

  it('archived notes join due filters only with class:archive', () => {
    expect(titles(search('tag:đồ-án due:7d class:archive')).sort()).toEqual([
      'Đồ án Giải tích',
      'Đồ án cũ',
    ]);
    expect(titles(search('do an')).includes('Đồ án cũ')).toBe(true);
  });

  it('due:overdue and due:30d use local calendar days', () => {
    expect(titles(search('due:overdue'))).toEqual([]);
    expect(titles(search('due:30d')).sort()).toEqual(['Đồ án Giải tích', 'Đồ án Xác suất']);
    clock.set(new Date(2026, 9, 25, 9, 0));
    expect(titles(search('due:overdue'))).toEqual(['Đồ án Giải tích']);
    clock.set(new Date(2026, 9, 21, 9, 0));
  });

  it('a tag filter also matches nested tags', () => {
    expect(titles(search('tag:môn')).sort()).toEqual(['Giải tích 1', 'Đại số tuyến tính']);
    expect(titles(search('tag:môn/giải-tích'))).toEqual(['Giải tích 1']);
    expect(titles(search('tag:Môn/Đại-Số'))).toEqual(['Đại số tuyến tính']);
  });

  it('tag filters ignore diacritics like tag autocomplete, and still nest by /', () => {
    expect(titles(search('tag:do-an')).sort()).toEqual(titles(search('tag:đồ-án')).sort());
    expect(titles(search('tag:do-an')).length).toBeGreaterThan(0);
    expect(titles(search('tag:mon')).sort()).toEqual(['Giải tích 1', 'Đại số tuyến tính']);
    expect(titles(search('tag:mon/giai-tich'))).toEqual(['Giải tích 1']);
    expect(titles(search('tag:MON/DAI-SO'))).toEqual(['Đại số tuyến tính']);
    expect(search('tag:mo')).toEqual([]);
  });

  it('folder: matches the first segment or a path prefix, case-insensitively', () => {
    expect(titles(search('folder:"2 areas"')).sort()).toEqual([
      'Giải tích 1',
      'Xác suất thống kê',
      'Đại số tuyến tính',
    ]);
    expect(titles(search('folder:wiki/concepts'))).toEqual(['Đạo hàm']);
    expect(titles(search('dao ham folder:wiki'))).toEqual(['Đạo hàm']);
  });

  it('type: and free text combine', () => {
    expect(titles(search('type:course giai')).sort()).toEqual(['Giải tích 1']);
    expect(titles(search('', { type: 'project', folder: '1 Projects' })).length).toBe(3);
  });
});
