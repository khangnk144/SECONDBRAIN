import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createSourcesTestApp,
  fakeExtractor,
  pdfOf,
  type SourcesTestApp,
} from '../sources/helpers/sources-test-host.js';

let t: SourcesTestApp | null = null;
afterEach(async () => {
  await t?.close();
  t = null;
});

const LONG = 'Giải tích: đạo hàm, tích phân và chuỗi số, đủ dài để có chữ trên trang.';

function seed(root: string): void {
  mkdirSync(path.join(root, '3 Resources', 'papers'), { recursive: true });
  mkdirSync(path.join(root, 'Attachments', '2026-10'), { recursive: true });
  const write = (rel: string, bytes: Buffer | string) =>
    writeFileSync(path.join(root, ...rel.split('/')), bytes);
  write('3 Resources/papers/Đọc được.pdf', pdfOf(LONG, LONG));
  write('3 Resources/papers/Bản quét.pdf', pdfOf('', ''));
  write('3 Resources/Ghi chép nguồn.md', `# Nguồn\n\n${LONG}\n`);
  write('3 Resources/slides.pptx', 'PK');
  write('Attachments/2026-10/ảnh.png', 'png');
  write('Attachments/2026-10/đính kèm.pdf', pdfOf(LONG));
}

type Row = { path: string; text: unknown };
const textByPath = (rows: Row[]) => Object.fromEntries(rows.map((row) => [row.path, row.text]));

describe('GET /api/resources text state (F30.2)', () => {
  it('reports quality, page count and reason for supported files, null for the rest', async () => {
    t = await createSourcesTestApp(47715, { extractor: fakeExtractor(), seed });
    await t.sources.idle();
    const response = await t.call('GET', '/api/resources');
    expect(response.statusCode).toBe(200);
    expect(textByPath(response.json().files)).toEqual({
      '3 Resources/papers/Đọc được.pdf': { quality: 'ok', pages: 2, reason: null },
      '3 Resources/papers/Bản quét.pdf': { quality: 'none', pages: 2, reason: 'no-text' },
      '3 Resources/Ghi chép nguồn.md': { quality: 'ok', pages: 1, reason: null },
      '3 Resources/slides.pptx': null,
      'Attachments/2026-10/ảnh.png': null,
      'Attachments/2026-10/đính kèm.pdf': { quality: 'ok', pages: 1, reason: null },
    });
  });

  it('says pending for a file not extracted yet and never extracts in the request', async () => {
    const extractor = fakeExtractor();
    t = await createSourcesTestApp(47716, { extractor, debounceMs: 60_000 });
    await t.sources.idle();
    await t.context.vault.create('3 Resources/mới.pdf', pdfOf(LONG));
    await t.context.settled();
    const response = await t.call('GET', '/api/resources');
    expect(textByPath(response.json().files)).toEqual({
      '3 Resources/mới.pdf': { quality: 'pending', pages: null, reason: null },
    });
    expect(extractor.calls).toBe(0);
  });

  it('gives text: null everywhere without the sources plugin', async () => {
    t = await createSourcesTestApp(47717, { seed, plugin: false });
    const rows = (await t.call('GET', '/api/resources')).json().files as Row[];
    expect(rows).toHaveLength(6);
    expect(rows.every((row) => row.text === null)).toBe(true);
  });
});
