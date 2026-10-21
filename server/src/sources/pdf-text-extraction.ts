/**
 * Page text of a PDF with pdf.js (legacy build: the modern one needs APIs Node lacks). Runs inside
 * the extraction worker thread (`pdf-text-worker.ts`), never on the server's event loop. Nothing is
 * rendered; fonts are never loaded from the network (only pdf.js's own CMaps and standard font
 * data from its package folder, read from disk).
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { normalizeExtractedText, sensibleTitle } from './source-quality.js';

export interface PdfLimits {
  /** Pages beyond this are not read; the result says `truncated`. */
  maxPages: number;
  /** Characters kept per page. */
  maxPageChars: number;
}

export type PdfExtraction =
  /** `title`: the metadata title when it looks like one (see `sensibleTitle`). */
  | { kind: 'ok'; pages: string[]; title: string | null; truncated: boolean }
  | { kind: 'failed'; reason: 'encrypted' | 'damaged' };

type PdfJs = typeof import('pdfjs-dist/legacy/build/pdf.mjs');
type PdfDocument = Awaited<ReturnType<PdfJs['getDocument']>['promise']>;

let loading: Promise<PdfJs> | null = null;

/** pdf.js's data folders as plain paths with a trailing `/` (what its Node file reader expects). */
function packageFolder(name: string): string {
  const require = createRequire(import.meta.url);
  const root = path.dirname(require.resolve('pdfjs-dist/package.json'));
  return `${path.join(root, name).split(path.sep).join('/')}/`;
}

interface TextItemLike {
  str?: unknown;
  hasEOL?: unknown;
}

/** Joins text items the way pdf.js lays them out: `hasEOL` ends a line. */
export function joinTextItems(items: readonly object[]): string {
  let text = '';
  for (const entry of items) {
    const item = entry as TextItemLike;
    if (typeof item.str !== 'string') continue; // marked-content markers carry no text
    text += item.str;
    if (item.hasEOL === true) text += '\n';
  }
  return text;
}

async function pageText(doc: PdfDocument, pageNumber: number, maxChars: number): Promise<string> {
  try {
    const page = await doc.getPage(pageNumber);
    try {
      const content = await page.getTextContent();
      return normalizeExtractedText(joinTextItems(content.items)).slice(0, maxChars);
    } finally {
      page.cleanup();
    }
  } catch {
    // One unreadable page (broken content stream) leaves the others usable.
    return '';
  }
}

async function metadataTitle(doc: PdfDocument): Promise<unknown> {
  try {
    const { info } = await doc.getMetadata();
    return (info as Record<string, unknown> | null)?.['Title'] ?? null;
  } catch {
    return null;
  }
}

const isPasswordError = (error: unknown) =>
  typeof error === 'object' && error !== null && (error as Error).name === 'PasswordException';

/** Never throws: a file pdf.js cannot open is `encrypted` or `damaged`. */
export async function extractPdfText(bytes: Uint8Array, limits: PdfLimits): Promise<PdfExtraction> {
  const pdfjs = await (loading ??= import('pdfjs-dist/legacy/build/pdf.mjs'));
  const task = pdfjs.getDocument({
    data: bytes,
    // pdf.js 6 never evaluates code from a PDF (the old `isEvalSupported` switch is gone).
    // WebAssembly only decodes images, which text extraction never needs.
    useWasm: false,
    disableFontFace: true,
    useSystemFonts: false,
    stopAtErrors: false,
    verbosity: 0,
    cMapUrl: packageFolder('cmaps'),
    cMapPacked: true,
    standardFontDataUrl: packageFolder('standard_fonts'),
  });
  try {
    const doc = await task.promise;
    const count = Math.min(doc.numPages, limits.maxPages);
    const pages: string[] = [];
    for (let n = 1; n <= count; n += 1) pages.push(await pageText(doc, n, limits.maxPageChars));
    return {
      kind: 'ok',
      pages,
      title: sensibleTitle(await metadataTitle(doc)),
      truncated: doc.numPages > limits.maxPages,
    };
  } catch (error) {
    return { kind: 'failed', reason: isPasswordError(error) ? 'encrypted' : 'damaged' };
  } finally {
    await task.destroy().catch(() => undefined);
  }
}
