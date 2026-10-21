import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { sourceCacheDir } from '../../src/sources/source-cache.js';
import {
  createSourcesTestApp,
  fakeExtractor,
  pdfOf,
  type FakeExtractor,
  type SourcesTestApp,
  waitFor,
} from './helpers/sources-test-host.js';

let t: SourcesTestApp | null = null;
afterEach(async () => {
  await t?.close();
  t = null;
});

const TEXT = 'Chương này trình bày đạo hàm, tích phân và các ứng dụng của giải tích.';
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const cacheDir = (app: SourcesTestApp) => sourceCacheDir(app.context.vault.paths.cacheDir);

async function start(
  extractor: FakeExtractor,
  options: Parameters<typeof createSourcesTestApp>[1] = {},
) {
  t = await createSourcesTestApp(47710, { extractor, ...options });
  await t.sources.idle();
  return t;
}

async function put(app: SourcesTestApp, vaultPath: string, bytes: Buffer | string) {
  await app.context.vault.create(vaultPath, bytes);
  await app.context.settled();
}

describe('reading sources (F30.2, F32 read_source)', () => {
  it('returns numbered pages, ids, hash and the file name as title; ranges are clamped', async () => {
    const app = await start(fakeExtractor());
    const bytes = pdfOf(TEXT, `Trang hai. ${TEXT}`, `Trang ba. ${TEXT}`);
    await put(app, '3 Resources/papers/Giải tích 1.pdf', bytes);
    const all = await app.sources.read('3 Resources/papers/Giải tích 1.pdf');
    expect(all).toMatchObject({
      path: '3 Resources/papers/Giải tích 1.pdf',
      title: 'Giải tích 1',
      contentHash: sha(bytes),
      pageCount: 3,
      extractionQuality: 'ok',
      reason: null,
    });
    expect(all.sourceId).toMatch(/^src_[0-9a-f]{16}$/);
    expect(all.pages.map((p) => p.page)).toEqual([1, 2, 3]);
    expect(all.pages[1]!.text).toBe(`Trang hai. ${TEXT}`);
    const middle = await app.sources.read('3 Resources/papers/Giải tích 1.pdf', {
      fromPage: 2,
      toPage: 2,
    });
    expect(middle.pages.map((p) => p.page)).toEqual([2]);
    const clamped = await app.sources.read('3 Resources/papers/Giải tích 1.pdf', {
      fromPage: -4,
      toPage: 99,
    });
    expect(clamped.pages.map((p) => p.page)).toEqual([1, 2, 3]);
    expect(app.sources.sourceIdOf('3 RESOURCES/papers/GIẢI TÍCH 1.pdf')).toBe(all.sourceId);
  });

  it('judges quality: blank, sparse and too large files', async () => {
    const extractor = fakeExtractor();
    const app = await start(extractor, { limits: { maxFileBytes: 4000 } });
    await put(app, '3 Resources/scan.pdf', pdfOf('', ' ', '12'));
    await put(app, '3 Resources/half.pdf', pdfOf(TEXT, 'Hình 1', TEXT));
    await put(app, '3 Resources/big.pdf', Buffer.alloc(5000, 0x41));
    expect(await app.sources.read('3 Resources/scan.pdf')).toMatchObject({
      extractionQuality: 'none',
      reason: 'no-text',
    });
    expect(await app.sources.read('3 Resources/half.pdf')).toMatchObject({
      extractionQuality: 'low',
      reason: 'sparse-text',
    });
    const calls = extractor.calls;
    expect(await app.sources.read('3 Resources/big.pdf')).toMatchObject({
      extractionQuality: 'none',
      reason: 'too-large',
      pageCount: 0,
      pages: [],
    });
    expect(extractor.calls).toBe(calls);
  });

  it('times out a slow extraction, resets the worker and goes on', async () => {
    const extractor = fakeExtractor();
    const app = await start(extractor, { limits: { timeoutMs: 50 } });
    await put(app, '3 Resources/slow.pdf', pdfOf(TEXT));
    extractor.mode = 'hang';
    expect(await app.sources.read('3 Resources/slow.pdf')).toMatchObject({
      extractionQuality: 'none',
      reason: 'timeout',
    });
    expect(extractor.resets).toBeGreaterThan(0);
    extractor.mode = 'text';
    // Other bytes: the timeout itself is cached for the slow file's content.
    await put(app, '3 Resources/fast.pdf', pdfOf(`${TEXT} 2`));
    expect((await app.sources.read('3 Resources/fast.pdf')).extractionQuality).toBe('ok');
  });

  it('maps a crashed extraction to damaged', async () => {
    const extractor = fakeExtractor();
    const app = await start(extractor);
    extractor.mode = 'crash';
    await put(app, '3 Resources/bad.pdf', pdfOf(TEXT));
    expect(await app.sources.read('3 Resources/bad.pdf')).toMatchObject({
      extractionQuality: 'none',
      reason: 'damaged',
    });
  });

  it('reads .md, .txt and .html as one page; other types are unsupported', async () => {
    const app = await start(fakeExtractor());
    await put(app, '3 Resources/ghi chép.md', `\uFEFF# Đạo hàm\n\n${TEXT}\n`);
    await put(app, '3 Resources/bài.txt', `${TEXT}\r\n`);
    await put(app, '3 Resources/web/trang.html', `<p>${TEXT}</p><script>x()</script>`);
    await put(app, '3 Resources/slides/x.pptx', Buffer.from('PK'));
    expect((await app.sources.read('3 Resources/ghi chép.md')).pages).toEqual([
      { page: 1, text: `# Đạo hàm\n\n${TEXT}` },
    ]);
    expect((await app.sources.read('3 Resources/bài.txt')).pages[0]!.text).toBe(TEXT);
    expect((await app.sources.read('3 Resources/web/trang.html')).pages[0]!.text).toBe(TEXT);
    expect(await app.sources.read('3 Resources/slides/x.pptx')).toMatchObject({
      extractionQuality: 'none',
      reason: 'unsupported-type',
      pages: [],
    });
    expect(await app.sources.status('3 Resources/slides/x.pptx')).toBeNull();
  });
});

describe('cache (F30.3)', () => {
  it('extracts a given content once, again after a change, and after the cache is deleted', async () => {
    const extractor = fakeExtractor();
    const app = await start(extractor);
    await put(app, '3 Resources/a.pdf', pdfOf(TEXT));
    await app.sources.read('3 Resources/a.pdf');
    await app.sources.read('3 Resources/a.pdf');
    await put(app, 'Attachments/bản sao.pdf', pdfOf(TEXT));
    await app.sources.read('Attachments/bản sao.pdf');
    expect(extractor.calls).toBe(1);

    const current = await app.context.vault.read('3 Resources/a.pdf');
    await app.context.vault.write('3 Resources/a.pdf', `${TEXT} mới`, current.revision);
    expect((await app.sources.read('3 Resources/a.pdf')).pages[0]!.text).toBe(`${TEXT} mới`);
    expect(extractor.calls).toBe(2);

    // Let the debounced background checks of the events above run first.
    await new Promise((resolve) => setTimeout(resolve, 100));
    await app.sources.idle();
    expect(extractor.calls).toBe(2);
    rmSync(cacheDir(app), { recursive: true, force: true });
    await app.sources.read('3 Resources/a.pdf');
    expect(extractor.calls).toBe(3);
    await waitFor(() => existsSync(path.join(cacheDir(app), 'index.json')));
  });

  it('re-extracts when a cache file is corrupt', async () => {
    const extractor = fakeExtractor();
    const app = await start(extractor);
    const bytes = pdfOf(TEXT);
    await put(app, '3 Resources/a.pdf', bytes);
    await app.sources.read('3 Resources/a.pdf');
    writeFileSync(path.join(cacheDir(app), `${sha(bytes)}.json`), '{"version":1,"pages":');
    expect((await app.sources.read('3 Resources/a.pdf')).extractionQuality).toBe('ok');
    expect(extractor.calls).toBe(2);
    const entry = JSON.parse(readFileSync(path.join(cacheDir(app), `${sha(bytes)}.json`), 'utf8'));
    expect(entry).toEqual({
      version: 1,
      pageCount: 1,
      pages: [TEXT],
      quality: 'ok',
      reason: null,
      title: null,
    });
  });

  it('status() never extracts; listSources() covers 3 Resources sorted by path', async () => {
    const extractor = fakeExtractor();
    const app = await start(extractor, {
      seed: (root) => {
        mkdirSync(path.join(root, '3 Resources', 'papers'), { recursive: true });
        mkdirSync(path.join(root, 'Attachments'), { recursive: true });
        writeFileSync(path.join(root, '3 Resources', 'papers', 'b.pdf'), pdfOf(TEXT));
        writeFileSync(path.join(root, '3 Resources', 'a ghi chú.md'), TEXT);
        writeFileSync(path.join(root, '3 Resources', 'ảnh.png'), 'png');
        writeFileSync(path.join(root, 'Attachments', 'c.pdf'), pdfOf(TEXT));
      },
    });
    const list = await app.sources.listSources();
    expect(list.map((s) => s.path)).toEqual([
      '3 Resources/a ghi chú.md',
      '3 Resources/papers/b.pdf',
    ]);
    expect(list[1]).toMatchObject({ quality: 'ok', pageCount: 1, reason: null });
    const calls = extractor.calls;
    await put(app, '3 Resources/new.pdf', pdfOf(`Mới: ${TEXT}`));
    expect(await app.sources.status('3 Resources/new.pdf')).toMatchObject({
      quality: 'pending',
      pageCount: null,
    });
    expect(extractor.calls).toBe(calls);
    expect(await app.sources.status('3 Resources/missing.pdf')).toBeNull();
  });
});

describe('path guard on every method', () => {
  const BAD = ['../x.pdf', '/etc/x.pdf', '3 Resources/../../x.pdf', '.secondbrain/cache/x.pdf'];

  it.each(BAD)('refuses %s', async (bad) => {
    const app = await start(fakeExtractor());
    await expect(app.sources.read(bad)).rejects.toMatchObject({ code: 'INVALID_PATH' });
    await expect(app.sources.status(bad)).rejects.toMatchObject({ code: 'INVALID_PATH' });
    expect(() => app.sources.sourceIdOf(bad)).toThrow(/Invalid vault path/);
  });

  it('reports a missing file as NOT_FOUND', async () => {
    const app = await start(fakeExtractor());
    await expect(app.sources.read('3 Resources/không có.pdf')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});
