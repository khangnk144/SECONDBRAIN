import { afterAll, describe, expect, it } from 'vitest';
import { joinTextItems } from '../../src/sources/pdf-text-extraction.js';
import {
  createWorkerPdfExtractor,
  ExtractorCrashError,
} from '../../src/sources/pdf-worker-extractor.js';
import {
  extractSourceText,
  DEFAULT_EXTRACTION_LIMITS,
} from '../../src/sources/source-extraction.js';
import { writeFixturePdf } from '../fixtures/sources/pdf-fixture-writer.js';

const extractor = createWorkerPdfExtractor();
afterAll(() => extractor.close());

const limits = { maxPages: 500, maxPageChars: 100_000 };
const NFD = 'Giải tích'.normalize('NFD');

describe('PDF text in a worker thread (F30.1, F30.2)', () => {
  it('reads Vietnamese page text in page order, NFD turned into NFC', async () => {
    const pdf = writeFixturePdf({
      title: 'Bài giảng Giải tích',
      pages: [['Giải tích 1', 'Đạo hàm và   tích phân'], [`Trang hai: ${NFD}`], []],
    });
    const result = await extractor.extract(pdf, limits);
    expect(result).toEqual({
      kind: 'ok',
      pages: ['Giải tích 1\nĐạo hàm và tích phân', 'Trang hai: Giải tích', ''],
      title: 'Bài giảng Giải tích',
      truncated: false,
    });
    if (result.kind === 'ok') expect(result.pages[1]).toBe(result.pages[1]!.normalize('NFC'));
  });

  it('drops a file-like metadata title', async () => {
    const pdf = writeFixturePdf({ title: 'Microsoft Word - x.docx', pages: [['Nội dung']] });
    const result = await extractor.extract(pdf, limits);
    expect(result.kind === 'ok' && result.title).toBeNull();
  });

  it('reports a password-protected file as encrypted and truncated bytes as damaged', async () => {
    const encrypted = writeFixturePdf({ pages: [['bí mật']], encrypted: true });
    expect(await extractor.extract(encrypted, limits)).toEqual({
      kind: 'failed',
      reason: 'encrypted',
    });
    const whole = writeFixturePdf({ pages: [['một đoạn văn đủ dài để có chữ']] });
    for (const cut of [40, Math.floor(whole.length / 3)]) {
      expect(await extractor.extract(whole.subarray(0, cut), limits)).toEqual({
        kind: 'failed',
        reason: 'damaged',
      });
    }
  });

  it('reads only the first pages of a document over the page cap', async () => {
    const pages = Array.from({ length: 501 }, (_, i) => [`Trang số ${i + 1} của tài liệu dài`]);
    const result = await extractor.extract(writeFixturePdf({ pages }), limits);
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.truncated).toBe(true);
    expect(result.pages).toHaveLength(500);
    expect(result.pages[499]).toBe('Trang số 500 của tài liệu dài');
    const capped = await extractSourceText(
      'pdf',
      writeFixturePdf({ pages }),
      extractor,
      DEFAULT_EXTRACTION_LIMITS,
    );
    expect(capped).toMatchObject({ quality: 'low', reason: 'too-large', pageCount: 500 });
  }, 60_000);

  it('cuts a page at the character cap', async () => {
    const pdf = writeFixturePdf({ pages: [['abcdefghij'.repeat(10)]] });
    const result = await extractor.extract(pdf, { maxPages: 5, maxPageChars: 25 });
    expect(result.kind === 'ok' && result.pages[0]).toBe('abcdefghij'.repeat(10).slice(0, 25));
  });
});

describe('worker host', () => {
  const stubUrl = new URL('../fixtures/sources/stub-pdf-worker.mjs', import.meta.url);

  it('restarts the worker after a crash', async () => {
    const host = createWorkerPdfExtractor({ workerUrl: stubUrl });
    try {
      await expect(host.extract(Buffer.from('X crash'), limits)).rejects.toBeInstanceOf(
        ExtractorCrashError,
      );
      expect(await host.extract(Buffer.from('fine'), limits)).toMatchObject({
        kind: 'ok',
        pages: ['stub page of 4 bytes'],
      });
    } finally {
      await host.close();
    }
  });

  it('maps a crash to quality none (damaged) and keeps working', async () => {
    const host = createWorkerPdfExtractor({ workerUrl: stubUrl });
    try {
      const crashed = await extractSourceText(
        'pdf',
        Buffer.from('X'),
        host,
        DEFAULT_EXTRACTION_LIMITS,
      );
      expect(crashed).toMatchObject({ quality: 'none', reason: 'damaged', pageCount: 0 });
      const next = await extractSourceText(
        'pdf',
        Buffer.from('ok'),
        host,
        DEFAULT_EXTRACTION_LIMITS,
      );
      expect(next.pages).toEqual(['stub page of 2 bytes']);
    } finally {
      await host.close();
    }
  });
});

describe('joinTextItems', () => {
  it('ends lines at hasEOL and skips marked-content items', () => {
    const items = [
      { str: 'Giải', hasEOL: false },
      { str: ' tích', hasEOL: true },
      { type: 'beginMarkedContent' },
      { str: 'Trang 2', hasEOL: false },
    ];
    expect(joinTextItems(items)).toBe('Giải tích\nTrang 2');
  });
});
