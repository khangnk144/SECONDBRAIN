import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { SearchResult } from '../../src/index/index-types.js';
import { sourceCacheDir } from '../../src/sources/source-cache.js';
import type { ServerEvent } from '../../src/ws/server-events.js';
import { writeFixturePdf } from '../fixtures/sources/pdf-fixture-writer.js';
import {
  createSourcesTestApp,
  fakeExtractor,
  pdfOf,
  waitFor,
  type SourcesTestApp,
} from './helpers/sources-test-host.js';

let t: SourcesTestApp | null = null;
afterEach(async () => {
  await t?.close();
  t = null;
});

const PAPER = writeFixturePdf({
  title: 'Bài giảng',
  pages: [['Chương 1: Giới thiệu môn học'], ['Giải tích: đạo hàm và tích phân'], []],
});
const pdfResults = (results: SearchResult[]) =>
  results.filter((r) => r.path.endsWith('.pdf')).map((r) => ({ path: r.path, page: r.page }));
const extracted = (events: ServerEvent[], vaultPath: string) =>
  events.find((e) => e.type === 'source:extracted' && e.path === vaultPath);

describe('background extraction (F30.1, F30.3)', () => {
  it('makes a new PDF searchable, follows its rename and forgets it on delete', async () => {
    t = await createSourcesTestApp(47711);
    const app = t;
    await app.sources.idle();
    const target = '3 Resources/papers/Bài giảng Giải tích.pdf';
    const created = await app.context.vault.create(target, PAPER);
    await waitFor(() => extracted(app.events, target));
    expect(extracted(app.events, target)).toEqual({
      type: 'source:extracted',
      path: target,
      quality: 'low', // one of three pages is blank: sparse
    });
    expect(pdfResults(app.context.index.search({ q: 'giai tich' }))).toEqual([
      { path: target, page: 2 },
    ]);
    const response = await app.call('GET', `/api/search?q=${encodeURIComponent('dao ham')}`);
    expect(response.json().results).toContainEqual(
      expect.objectContaining({ path: target, page: 2, class: 'source' }),
    );

    const moved = '3 Resources/Giải tích (đã đổi tên).pdf';
    await app.context.vault.rename(target, moved, {
      expectedRevision: created.revision,
      relink: false,
    });
    await app.context.settled();
    await waitFor(
      () => pdfResults(app.context.index.search({ q: 'giai tich' }))[0]?.path === moved,
    );
    await app.sources.idle();
    expect(pdfResults(app.context.index.search({ q: 'giai tich' }))).toEqual([
      { path: moved, page: 2 },
    ]);

    await app.context.vault.trash([moved], [created.revision]);
    await app.context.settled();
    expect(pdfResults(app.context.index.search({ q: 'giai tich' }))).toEqual([]);
  }, 20_000);

  it('extracts what is missing at start, reuses the cache after a restart and prunes it', async () => {
    const first = fakeExtractor();
    const seed = (root: string) => {
      mkdirSync(path.join(root, '3 Resources'), { recursive: true });
      mkdirSync(path.join(root, 'Attachments'), { recursive: true });
      writeFileSync(
        path.join(root, '3 Resources', 'một.pdf'),
        pdfOf('Giải tích: một trang có đủ chữ để đọc, đạo hàm và tích phân của hàm số'),
      );
      writeFileSync(path.join(root, '3 Resources', 'ghi chú.md'), '# Ghi chú nguồn đủ dài');
      writeFileSync(path.join(root, 'Attachments', 'đính kèm.pdf'), pdfOf('Tệp đính kèm có chữ'));
    };
    t = await createSourcesTestApp(47712, { extractor: first, seed });
    await t.sources.idle();
    expect(first.calls).toBe(2);
    expect(pdfResults(t.context.index.search({ q: 'giai tich' }))).toEqual([
      { path: '3 Resources/một.pdf', page: 1 },
    ]);
    const home = t.home;
    const dir = sourceCacheDir(t.context.vault.paths.cacheDir);
    writeFileSync(path.join(dir, `${'f'.repeat(64)}.json`), '{}');
    await t.app.close();
    await t.host.close();
    t = null;

    const second = fakeExtractor();
    t = await createSourcesTestApp(47713, { extractor: second, home });
    try {
      await t.sources.idle();
      expect(second.calls).toBe(0);
      expect(readdirSync(dir).filter((name) => name.startsWith('f'))).toEqual([]);
      expect((await t.sources.status('3 Resources/một.pdf'))?.quality).toBe('ok');
    } finally {
      await t.close();
      t = null;
      const { removeDir } = await import('../helpers/test-environment.js');
      removeDir(home);
    }
  });

  it('search results are identical before and after an index rebuild (F30.4)', async () => {
    const seed = (root: string) => {
      mkdirSync(path.join(root, '3 Resources', 'papers'), { recursive: true });
      mkdirSync(path.join(root, '2 Areas'), { recursive: true });
      writeFileSync(path.join(root, '3 Resources', 'papers', 'Giải tích.pdf'), PAPER);
      writeFileSync(
        path.join(root, '3 Resources', 'papers', 'Fourier.pdf'),
        writeFixturePdf({ pages: [['Chuỗi Fourier hội tụ trong giải tích']] }),
      );
      writeFileSync(path.join(root, '2 Areas', 'Giải tích 1.md'), '# Giải tích 1\n\nĐạo hàm.\n');
    };
    t = await createSourcesTestApp(47714, { seed });
    await t.sources.idle();
    const queries = ['giai tich', 'dao ham', 'fourier', 'folder:"3 Resources" tich', 'chuong'];
    const snapshot = () => queries.map((q) => t!.context.index.search({ q }));
    const before = snapshot();
    expect(pdfResults(before.flat()).length).toBeGreaterThan(3);
    await t.context.index.rebuild();
    expect(snapshot()).toEqual(before);
  }, 20_000);
});
