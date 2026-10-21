/**
 * Turns the bytes of one supported file into cacheable page text with a quality verdict (SPEC
 * F30): PDFs through the worker extractor with a time cap, `.md`/`.txt`/`.html` as one page.
 */
import { htmlToText } from '../index/html-text.js';
import { ExtractorMemoryError, type PdfExtractor } from './pdf-worker-extractor.js';
import { SOURCE_CACHE_VERSION, type CachedSourceText } from './source-cache.js';
import type { SourceFormat } from './source-formats.js';
import { judgeQuality, normalizeExtractedText } from './source-quality.js';
import type { ExtractionReason } from './source-types.js';

export interface ExtractionLimits {
  /** Larger files are not read at all (`too-large`). */
  maxFileBytes: number;
  /** PDF pages read; more → the first ones only, quality at most `low`, reason `too-large`. */
  maxPages: number;
  /** Characters kept per PDF page. */
  maxPageChars: number;
  /** Time for one PDF; the worker is terminated after it (`timeout`). */
  timeoutMs: number;
}

export const DEFAULT_EXTRACTION_LIMITS: ExtractionLimits = {
  maxFileBytes: 50 * 1024 * 1024,
  maxPages: 500,
  maxPageChars: 100_000,
  timeoutMs: 60_000,
};

export function unreadableText(reason: ExtractionReason): CachedSourceText {
  return {
    version: SOURCE_CACHE_VERSION,
    pageCount: 0,
    pages: [],
    quality: 'none',
    reason,
    title: null,
  };
}

function fromPages(pages: string[], truncated: boolean, title: string | null): CachedSourceText {
  const verdict = judgeQuality(pages, truncated);
  return { version: SOURCE_CACHE_VERSION, pageCount: pages.length, pages, ...verdict, title };
}

/** `.md`/`.txt` (UTF-8, BOM dropped) and `.html` (visible text) as a single page. */
export function textFileText(bytes: Uint8Array, format: 'text' | 'html'): CachedSourceText {
  // TextDecoder drops a leading BOM; invalid bytes become U+FFFD (never written anywhere).
  const decoded = new TextDecoder('utf-8').decode(bytes);
  const text = format === 'html' ? htmlToText(decoded) : decoded;
  return fromPages([normalizeExtractedText(text)], false, null);
}

async function pdfText(
  bytes: Uint8Array,
  extractor: PdfExtractor,
  limits: ExtractionLimits,
): Promise<CachedSourceText> {
  let timer: NodeJS.Timeout | undefined;
  const timedOut = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), limits.timeoutMs);
  });
  const job = extractor.extract(bytes, {
    maxPages: limits.maxPages,
    maxPageChars: limits.maxPageChars,
  });
  // A job abandoned by a timeout rejects later; that rejection is expected.
  job.catch(() => undefined);
  try {
    const outcome = await Promise.race([job, timedOut]);
    if (outcome === 'timeout') {
      await extractor.reset();
      return unreadableText('timeout');
    }
    if (outcome.kind === 'failed') return unreadableText(outcome.reason);
    return fromPages(outcome.pages, outcome.truncated, outcome.title);
  } catch (error) {
    // The worker was stopped on this file (memory cap, native crash): it restarts for the next
    // one. A file that needs too much memory (a "deflate bomb") is `too-large`.
    return unreadableText(error instanceof ExtractorMemoryError ? 'too-large' : 'damaged');
  } finally {
    clearTimeout(timer);
  }
}

export function extractSourceText(
  format: SourceFormat,
  bytes: Uint8Array,
  extractor: PdfExtractor,
  limits: ExtractionLimits,
): Promise<CachedSourceText> {
  if (bytes.byteLength > limits.maxFileBytes) return Promise.resolve(unreadableText('too-large'));
  if (format === 'pdf') return pdfText(bytes, extractor, limits);
  return Promise.resolve(textFileText(bytes, format));
}
