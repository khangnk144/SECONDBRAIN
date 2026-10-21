/**
 * A small "deflate bomb" PDF (a few hundred kB whose content stream inflates to hundreds of MB)
 * must not take the server down: the extraction worker is stopped when its decoded buffers pass
 * the cap, the file gets quality `none` (reason `too-large`) and the next file is read normally.
 */
import { createDeflate } from 'node:zlib';
import { afterAll, describe, expect, it } from 'vitest';
import {
  createWorkerPdfExtractor,
  ExtractorMemoryError,
} from '../../src/sources/pdf-worker-extractor.js';
import {
  DEFAULT_EXTRACTION_LIMITS,
  extractSourceText,
} from '../../src/sources/source-extraction.js';
import { writeFixturePdf } from '../fixtures/sources/pdf-fixture-writer.js';

const MB = 1024 * 1024;
const limits = { maxPages: 500, maxPageChars: 100_000 };

/** zlib stream of `megabytes` MB of spaces, built chunk by chunk (never held inflated). */
async function deflatedSpaces(megabytes: number): Promise<Buffer> {
  const deflate = createDeflate({ level: 9 });
  const out: Buffer[] = [];
  deflate.on('data', (chunk: Buffer) => out.push(chunk));
  const ended = new Promise((resolve) => deflate.on('end', resolve));
  const chunk = Buffer.alloc(MB, 0x20);
  for (let i = 0; i < megabytes; i += 1) {
    if (!deflate.write(chunk)) await new Promise((resolve) => deflate.once('drain', resolve));
  }
  deflate.end();
  await ended;
  return Buffer.concat(out);
}

/** One page whose only content stream is `stream` (FlateDecode). */
function bombPdf(stream: Buffer): Uint8Array {
  const objects = [
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
    Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    Buffer.from('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>'),
    Buffer.concat([
      Buffer.from(`<< /Length ${stream.length} /Filter /FlateDecode >>\nstream\n`),
      stream,
      Buffer.from('\nendstream'),
    ]),
  ];
  const parts: Buffer[] = [Buffer.from('%PDF-1.4\n')];
  let size = parts[0]!.length;
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(size);
    const part = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`), body, Buffer.from('\nendobj\n')]);
    parts.push(part);
    size += part.length;
  });
  const xref = [
    'xref',
    `0 ${objects.length + 1}`,
    '0000000000 65535 f ',
    ...offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n `),
    'trailer',
    `<< /Size ${objects.length + 1} /Root 1 0 R >>`,
    'startxref',
    String(size),
    '%%EOF',
    '',
  ].join('\n');
  return new Uint8Array(Buffer.concat([...parts, Buffer.from(xref)]));
}

describe('memory cap of PDF extraction (F30.2)', () => {
  const extractor = createWorkerPdfExtractor();
  afterAll(() => extractor.close());

  it('a 600 MB deflate bomb: quality none (too-large), the process grows a few hundred MB at most', async () => {
    const line = 'Giải tích 1: đạo hàm, tích phân và chuỗi số của hàm một biến thực';
    const text = writeFixturePdf({ pages: [[line]] });
    // Warm up (pdf.js loaded) so the measure below is the bomb's alone.
    expect(
      await extractSourceText('pdf', text, extractor, DEFAULT_EXTRACTION_LIMITS),
    ).toMatchObject({ quality: 'ok' });
    const bomb = bombPdf(await deflatedSpaces(600));
    expect(bomb.byteLength).toBeLessThan(1.5 * MB);
    const before = process.memoryUsage.rss();
    let peak = before;
    const sampler = setInterval(() => (peak = Math.max(peak, process.memoryUsage.rss())), 5);
    try {
      const result = await extractSourceText('pdf', bomb, extractor, DEFAULT_EXTRACTION_LIMITS);
      expect(result).toMatchObject({ quality: 'none', reason: 'too-large', pageCount: 0 });
    } finally {
      clearInterval(sampler);
    }
    // Without the cap this file took the process past 1.6 GB; the cap is 256 MB of buffers.
    expect((peak - before) / MB).toBeLessThan(512);
    const after = await extractSourceText('pdf', text, extractor, DEFAULT_EXTRACTION_LIMITS);
    expect(after.pages).toEqual([line]);
  }, 60_000);

  it('the watchdog stops a worker that keeps allocating, and the next job runs', async () => {
    const stubUrl = new URL('../fixtures/sources/stub-pdf-worker.mjs', import.meta.url);
    const host = createWorkerPdfExtractor({ workerUrl: stubUrl, maxBuffersMb: 32 });
    try {
      await expect(host.extract(Buffer.from('M hungry'), limits)).rejects.toBeInstanceOf(
        ExtractorMemoryError,
      );
      const mapped = await extractSourceText(
        'pdf',
        Buffer.from('M'),
        host,
        DEFAULT_EXTRACTION_LIMITS,
      );
      expect(mapped).toMatchObject({ quality: 'none', reason: 'too-large' });
      expect(await host.extract(Buffer.from('fine'), limits)).toMatchObject({
        pages: ['stub page of 4 bytes'],
      });
    } finally {
      await host.close();
    }
  });
});
