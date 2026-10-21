/**
 * pdf.js, loaded on first use (it is large) and configured for the app's strict CSP:
 * - the legacy build: pdf.js 6's modern build calls brand-new built-ins
 *   (`Map#getOrInsertComputed`…) that Chromium 141 lacks, so a slightly older Chrome or Edge could
 *   not draw a page; the legacy build carries those polyfills;
 * - no `eval`: pdf.js 6 has no `new Function` path any more (`isEvalSupported` is gone), and the
 *   legacy build's `Function('return this')` is never reached where `globalThis` exists;
 * - the worker is a same-origin bundled file (`worker-src` falls back to `script-src 'self'`);
 * - WebAssembly is off (`useWasm: false`, no `wasm-unsafe-eval` in the CSP): JPEG 2000 and JBIG2
 *   images use pdf.js's plain-JavaScript decoders (see `pdf-image-decoders.js`), ICC colour
 *   profiles fall back to pdf.js's built-in conversion;
 * - fonts load through the FontFace API from bytes (no `data:` URLs); fonts a PDF does not embed
 *   use the system's fonts (the standard font files are not bundled);
 * - the document comes from bytes fetched with the token header, never from a URL.
 */
import type { DocumentInitParameters } from 'pdfjs-dist/types/src/display/api';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import jbig2Url from 'pdfjs-dist/wasm/jbig2_nowasm_fallback.js?url';
import openjpegUrl from 'pdfjs-dist/wasm/openjpeg_nowasm_fallback.js?url';
import decodersUrl from './pdf-image-decoders.js?url';

export type PdfJs = typeof import('pdfjs-dist/legacy/build/pdf.mjs');
export type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';

let loading: Promise<PdfJs> | null = null;

export function loadPdfJs(): Promise<PdfJs> {
  loading ??= import('pdfjs-dist/legacy/build/pdf.mjs').then((pdfjs) => {
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
    return pdfjs;
  });
  return loading;
}

/** `wasmUrl` must end with `/`; pdf.js appends the decoder's file name to the `file` value. */
export function imageDecodersPrefix(base: string = document.baseURI): string {
  const url = new URL(decodersUrl, base);
  url.searchParams.set('openjpeg', new URL(openjpegUrl, base).href);
  url.searchParams.set('jbig2', new URL(jbig2Url, base).href);
  return `${url.href}&file=/`;
}

export function documentParameters(bytes: ArrayBuffer): DocumentInitParameters {
  return {
    data: new Uint8Array(bytes),
    useWasm: false,
    wasmUrl: imageDecodersPrefix(),
    enableXfa: false,
    useSystemFonts: true,
  };
}
