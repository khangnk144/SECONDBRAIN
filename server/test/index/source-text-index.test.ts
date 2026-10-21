import { createHash } from 'node:crypto';
import { statSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SearchResult } from '../../src/index/index-types.js';
import { STOP_WORDS } from '../../src/index/stop-words.js';
import {
  SOURCE_CACHE_VERSION,
  sourceCacheDir,
  writeCachedText,
  writePathIndex,
} from '../../src/sources/source-cache.js';
import { createIndexedVault, fixtureFiles, type IndexedVault } from './helpers/index-test-vault.js';

const PDF = '3 Resources/papers/Bài giảng Fourier.pdf';
const SCAN = 'Attachments/2026-10/scan.pdf';
const PAGES = [
  'Chuỗi Fourier và biến đổi Fourier.',
  'Ứng dụng trong Giải tích: hội tụ của chuỗi lượng giác.',
  'Bài tập cuối chương.',
];
const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const HASH = sha('fourier v1');

let v: IndexedVault;
beforeEach(async () => {
  v = await createIndexedVault({
    files: { ...fixtureFiles('search-vault'), [PDF]: 'fourier v1', [SCAN]: 'scan bytes' },
  });
});
afterEach(() => v.cleanup());

const pdfHits = (results: SearchResult[]) => results.filter((r) => /\.pdf$/.test(r.path));

describe('PDF page text in search (F30.1)', () => {
  it('finds a PDF page diacritic-insensitively, after title matches, naming the page', async () => {
    await v.index.setSourceText(PDF, HASH, PAGES);
    const results = v.index.search({ q: 'giai tich' });
    expect(results[0]!.matchedIn).toBe('title');
    const [hit] = pdfHits(results);
    expect(hit).toMatchObject({
      path: PDF,
      title: 'Bài giảng Fourier.pdf',
      folder: '3 Resources',
      class: 'source',
      matchedIn: 'body',
      page: 2,
    });
    expect(hit!.snippet!.text).toBe(PAGES[1]);
    const [from, to] = hit!.snippet!.highlights[0]!;
    expect(hit!.snippet!.text.slice(from, to)).toBe('Giải');
    expect(results.filter((r) => r.matchedIn === 'title').every((r) => r.score > hit!.score)).toBe(
      true,
    );
    expect(pdfHits(v.index.search({ q: 'Giải tích'.normalize('NFD') }))).toHaveLength(1);
  });

  it('keeps text only for indexed PDFs of searchable classes; same hash is a no-op', async () => {
    await v.index.setSourceText(SCAN, sha('scan bytes'), ['Giải tích scan']);
    await v.index.setSourceText('3 Resources/không có.pdf', HASH, ['Giải tích']);
    expect(v.index.sourceTextHash(SCAN)).toBeNull();
    expect(v.index.sourceTextHash('3 Resources/không có.pdf')).toBeNull();
    expect(pdfHits(v.index.search({ q: 'giai tich' }))).toEqual([]);

    await v.index.setSourceText(PDF, HASH, PAGES);
    await v.index.setSourceText(PDF, HASH, ['khác hẳn']);
    expect(pdfHits(v.index.search({ q: 'hoi tu' }))).toHaveLength(1);
    await v.index.setSourceText(PDF, sha('v2'), ['Phiên bản mới về hội tụ đều.']);
    expect(pdfHits(v.index.search({ q: 'phien ban' }))).toHaveLength(1);
    expect(pdfHits(v.index.search({ q: 'chuoi luong giac' }))).toEqual([]);
    await v.index.setSourceText(PDF, sha('v2'), null);
    expect(v.index.sourceTextHash(PDF)).toBeNull();
    expect(pdfHits(v.index.search({ q: 'phien ban' }))).toEqual([]);
  });

  it('applies folder: to PDFs and leaves them out of tag:, type: and due: searches', async () => {
    await v.index.setSourceText(PDF, HASH, PAGES);
    expect(pdfHits(v.index.search({ q: 'folder:"3 Resources" fourier' }))).toHaveLength(1);
    expect(pdfHits(v.index.search({ q: 'folder:"2 Areas" fourier' }))).toEqual([]);
    for (const q of ['tag:môn fourier', 'type:course fourier', 'due:30d fourier'])
      expect(pdfHits(v.index.search({ q }))).toEqual([]);
    for (const q of ['"fourier', 'fourier*', '-fourier', '(fourier', 'NEAR(fourier)'])
      expect(() => v.index.search({ q })).not.toThrow();
  });

  it('follows deletes and renames of the PDF', async () => {
    await v.index.setSourceText(PDF, HASH, PAGES);
    const moved = '3 Resources/Fourier (bản 2).pdf';
    v.renameFile(PDF, moved);
    await v.index.renameFile(PDF, moved);
    expect(pdfHits(v.index.search({ q: 'fourier' })).map((r) => [r.path, r.page])).toEqual([
      [moved, 1],
    ]);
    expect(v.index.sourceTextHash(moved)).toBe(HASH);
    v.renameFile(moved, 'Attachments/Fourier.pdf');
    await v.index.renameFile(moved, 'Attachments/Fourier.pdf');
    expect(pdfHits(v.index.search({ q: 'fourier' }))).toEqual([]);

    await v.index.setSourceText(SCAN, HASH, PAGES);
    v.writeFile(PDF, 'fourier v1');
    await v.index.updateFile(PDF);
    await v.index.setSourceText(PDF, HASH, PAGES);
    v.removeFile(PDF);
    await v.index.removeFile(PDF);
    expect(v.index.sourceTextHash(PDF)).toBeNull();
    expect(pdfHits(v.index.search({ q: 'fourier' }))).toEqual([]);
  });

  it('gives identical results after a rebuild, refilled from the sources cache (F30.4)', async () => {
    await v.index.setSourceText(PDF, HASH, PAGES);
    const dir = sourceCacheDir(v.vault.paths.cacheDir);
    await writeCachedText(dir, HASH, {
      version: SOURCE_CACHE_VERSION,
      pageCount: PAGES.length,
      pages: PAGES,
      quality: 'ok',
      reason: null,
      title: null,
    });
    const info = statSync(path.join(v.root, ...PDF.split('/')));
    await writePathIndex(
      dir,
      new Map([[PDF, { size: info.size, mtimeMs: info.mtimeMs, contentHash: HASH }]]),
    );
    const queries = ['giai tich', 'fourier', 'bai tap', 'folder:"3 Resources" chuoi', 'hoi tu'];
    const snapshot = () => queries.map((q) => v.index.search({ q }));
    const retrieval = () =>
      v.index.retrieve({ text: 'chuỗi Fourier hội tụ', limit: 20, includePdf: true });
    const before = { search: snapshot(), retrieval: retrieval() };
    expect(pdfHits(before.search.flat()).length).toBeGreaterThan(0);
    await v.index.rebuild();
    expect({ search: snapshot(), retrieval: retrieval() }).toEqual(before);
  });
});

describe('retrieve() for AI questions (F33 BM25)', () => {
  it('ORs the terms: a note that only mentions "đạo hàm" is found', () => {
    const hits = v.index.retrieve({ text: 'tóm tắt những gì mình học về đạo hàm', limit: 10 });
    expect(hits.map((h) => h.path)).toContain('2 Areas/Giải tích 1.md');
    expect(hits[0]).toMatchObject({ page: null, class: 'user' });
    expect(hits.every((h, i) => i === 0 || hits[i - 1]!.score >= h.score)).toBe(true);
  });

  it('ignores stop words, never throws on FTS syntax and skips unsearchable classes', () => {
    expect(v.index.retrieve({ text: 'là gì và của những cái này?', limit: 10 })).toEqual([]);
    expect(STOP_WORDS.has('nhung')).toBe(false);
    for (const text of ['"', '*', '-', '(', 'NEAR(a b)', 'a OR', ':', '"giải" AND (tích']) {
      expect(() => v.index.retrieve({ text, limit: 5 })).not.toThrow();
    }
    const paths = v.index.retrieve({ text: 'giải tích', limit: 200 }).map((h) => h.path);
    expect(paths).not.toContain('Templates/Mẫu giải tích.md');
    expect(paths).toContain('3 Resources/web/Trang lưu.html');
  });

  it('adds PDF pages only when asked, with their page, and clamps the limit', async () => {
    await v.index.setSourceText(PDF, HASH, PAGES);
    const question = 'hội tụ của chuỗi lượng giác trong giải tích';
    expect(v.index.retrieve({ text: question, limit: 20 }).some((h) => h.page !== null)).toBe(
      false,
    );
    const hits = v.index.retrieve({ text: question, limit: 20, includePdf: true });
    expect(hits.find((h) => h.path === PDF)).toMatchObject({
      title: 'Bài giảng Fourier.pdf',
      class: 'source',
      page: 2,
    });
    expect(v.index.retrieve({ text: question, limit: 1, includePdf: true })).toHaveLength(1);
    expect(v.index.retrieve({ text: question, limit: 0 })).toHaveLength(1);
  });
});
