/**
 * Extraction quality, titles, ids and text cleanup shared by every source format (SPEC F30,
 * F32 `extractionQuality`).
 */
import { createHash } from 'node:crypto';
import type { VaultPath } from '../vault/vault-types.js';
import type { ExtractionQuality, ExtractionReason } from './source-types.js';

/**
 * Quality thresholds. A whole document with fewer than NO_TEXT_CHARS non-space characters has
 * no usable text (a scan, a blank or image-only file): `none`. A page with fewer than
 * SPARSE_PAGE_CHARS non-space characters is "sparse" (a figure, a scanned page, a title page);
 * when at least SPARSE_PAGE_SHARE of the pages are sparse the text is incomplete: `low`. A
 * document cut at the page cap is `low` too, whatever its pages hold.
 */
export const NO_TEXT_CHARS = 20;
export const SPARSE_PAGE_CHARS = 40;
export const SPARSE_PAGE_SHARE = 0.3;

const SPACE = /\s/gu;
const nonSpaceLength = (text: string) => text.replace(SPACE, '').length;

export interface QualityVerdict {
  quality: ExtractionQuality;
  reason: ExtractionReason | null;
}

/** Quality of extracted pages; `truncated` = the page cap cut the document. */
export function judgeQuality(pages: readonly string[], truncated: boolean): QualityVerdict {
  const counts = pages.map(nonSpaceLength);
  const total = counts.reduce((sum, n) => sum + n, 0);
  if (total < NO_TEXT_CHARS) return { quality: 'none', reason: 'no-text' };
  if (truncated) return { quality: 'low', reason: 'too-large' };
  const sparse = counts.filter((n) => n < SPARSE_PAGE_CHARS).length;
  if (sparse >= SPARSE_PAGE_SHARE * pages.length) return { quality: 'low', reason: 'sparse-text' };
  return { quality: 'ok', reason: null };
}

/**
 * Whitespace cleanup of extracted text: one line ending style, runs of spaces/tabs collapsed,
 * lines trimmed, at most one blank line in a row, NFC (diacritics kept as composed letters).
 */
export function normalizeExtractedText(text: string): string {
  return text
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(/[^\S\n]+/gu, ' ')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Metadata titles that name a file or a placeholder rather than the document. */
const FILE_LIKE_TITLE = [
  /^untitled\b/i,
  /^microsoft (word|powerpoint|excel) - /i,
  /\.(docx?|pptx?|xlsx?|pdf|txt|tex|dvi|odt|rtf)$/i,
];

/** The PDF's own title when it looks like one (≥ 3 letters, not a file name), else null. */
export function sensibleTitle(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const title = raw.normalize('NFC').replace(/\s+/gu, ' ').trim();
  if ((title.match(/\p{L}/gu)?.length ?? 0) < 3) return null;
  if (FILE_LIKE_TITLE.some((pattern) => pattern.test(title))) return null;
  return title;
}

/** `src_` + 16 hex of SHA-256 over the NFC, lower-cased vault path (stable across hosts). */
export function sourceIdForPath(path: VaultPath): string {
  const key = path.normalize('NFC').toLowerCase();
  return `src_${createHash('sha256').update(key, 'utf8').digest('hex').slice(0, 16)}`;
}
