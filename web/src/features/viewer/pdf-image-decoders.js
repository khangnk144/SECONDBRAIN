/* global URL */
/**
 * Loaded by the pdf.js worker, never by the page. With WebAssembly off (the app's CSP has no
 * `wasm-unsafe-eval`), pdf.js imports its plain-JavaScript image decoders from
 * `${wasmUrl}openjpeg_nowasm_fallback.js` and `${wasmUrl}jbig2_nowasm_fallback.js`. The bundler
 * gives those files hashed names, so `wasmUrl` points at this module with their real URLs in the
 * query (`?openjpeg=…&jbig2=…&file=/`); pdf.js appends the name it wants and this module hands
 * back the matching decoder. Same origin, no eval: allowed by `script-src 'self'`.
 */
const params = new URL(import.meta.url).searchParams;
const wanted = params.get('file') ?? '';
const target = wanted.includes('jbig2') ? params.get('jbig2') : params.get('openjpeg');
const decoder = target ? await import(/* @vite-ignore */ target) : null;

export default function createDecoder(...args) {
  if (!decoder) throw new Error('No image decoder for ' + wanted);
  return decoder.default(...args);
}
