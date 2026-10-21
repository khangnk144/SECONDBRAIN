import { describe, expect, it } from 'vitest';
import { documentParameters, imageDecodersPrefix } from './pdf-js';
import { PDF_VIEWER_KEYS, pdfViewerKeyAction } from './pdf-viewer-keys';
import { fitWidthZoom, outputScale, zoomIn, zoomOut, zoomPercent } from './pdf-zoom';
import { currentPageOf, pagesToDraw } from './use-visible-pages';

const key = (key: string, extra: Partial<KeyboardEvent> = {}) => ({
  key,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  target: null as EventTarget | null,
  ...extra,
});

describe('PDF viewer rules (F15.3)', () => {
  it('opens documents from bytes with WebAssembly off and same-origin JS image decoders', () => {
    const bytes = new TextEncoder().encode('%PDF-1.7').buffer;
    const params = documentParameters(bytes);
    expect(params.data).toBeInstanceOf(Uint8Array);
    expect(params.url).toBeUndefined();
    expect(params.useWasm).toBe(false);
    expect(params.enableXfa).toBe(false);
    // pdf.js requires a trailing slash and appends e.g. `openjpeg_nowasm_fallback.js`.
    const prefix = imageDecodersPrefix('http://localhost:4747/');
    expect(prefix.endsWith('&file=/')).toBe(true);
    const asked = new URL(`${prefix}openjpeg_nowasm_fallback.js`);
    expect(asked.origin).toBe('http://localhost:4747');
    expect(asked.searchParams.get('file')).toBe('/openjpeg_nowasm_fallback.js');
    expect(asked.searchParams.get('openjpeg')).toContain('openjpeg_nowasm_fallback');
    expect(asked.searchParams.get('jbig2')).toContain('jbig2_nowasm_fallback');
    expect(new URL(asked.searchParams.get('jbig2') ?? '').origin).toBe('http://localhost:4747');
  });

  it('zooms in steps, fits the width and keeps canvases bounded', () => {
    expect(zoomIn(1)).toBe(1.1);
    expect(zoomIn(1.07)).toBe(1.1);
    expect(zoomOut(1)).toBe(0.9);
    expect(zoomIn(4)).toBe(4);
    expect(zoomOut(0.25)).toBe(0.25);
    expect(zoomPercent(1.335)).toBe(134);
    expect(fitWidthZoom(832, 600)).toBeCloseTo(1);
    expect(fitWidthZoom(0, 600)).toBe(1);
    expect(fitWidthZoom(100_000, 600)).toBe(4);
    expect(outputScale(800, 1000, 2)).toBe(2);
    const capped = outputScale(4000, 5000, 2);
    expect(4000 * 5000 * capped * capped).toBeLessThanOrEqual(16_777_216 + 1);
  });

  it('draws visible pages ±1 and names the page showing the most of itself', () => {
    expect([...pagesToDraw([5, 6], 12)].sort((a, b) => a - b)).toEqual([4, 5, 6, 7]);
    expect([...pagesToDraw([1], 1)]).toEqual([1]);
    expect([...pagesToDraw([], 3)]).toEqual([1]);
    expect(
      currentPageOf(
        new Map([
          [3, 100],
          [4, 500],
        ]),
        1,
      ),
    ).toBe(4);
    expect(
      currentPageOf(
        new Map([
          [3, 300],
          [4, 300],
        ]),
        1,
      ),
    ).toBe(3);
    expect(currentPageOf(new Map(), 7)).toBe(7);
  });

  it('maps the viewer keys, leaving Home/End to the page field and Alt combinations alone', () => {
    expect(pdfViewerKeyAction(key('PageDown'))).toBe('next');
    expect(pdfViewerKeyAction(key('PageUp'))).toBe('previous');
    expect(pdfViewerKeyAction(key('Home'))).toBe('first');
    expect(pdfViewerKeyAction(key('End'))).toBe('last');
    expect(pdfViewerKeyAction(key('=', { ctrlKey: true }))).toBe('zoom-in');
    expect(pdfViewerKeyAction(key('+', { ctrlKey: true }))).toBe('zoom-in');
    expect(pdfViewerKeyAction(key('-', { metaKey: true }))).toBe('zoom-out');
    expect(pdfViewerKeyAction(key('0', { ctrlKey: true }))).toBe('actual-size');
    expect(pdfViewerKeyAction(key('ArrowDown'))).toBeNull();
    expect(pdfViewerKeyAction(key('w', { altKey: true }))).toBeNull();
    expect(pdfViewerKeyAction(key('k', { ctrlKey: true }))).toBeNull();
    const input = document.createElement('input');
    expect(pdfViewerKeyAction(key('Home', { target: input }))).toBeNull();
    expect(pdfViewerKeyAction(key('PageDown', { target: input }))).toBe('next');
  });

  it('the list the shortcut sheet shows is exactly what the key handler does', () => {
    for (const { keys, actions } of PDF_VIEWER_KEYS) {
      const done = keys.map((combo) => {
        const parts = combo.split('+');
        const name = parts[parts.length - 1] ?? '';
        return pdfViewerKeyAction(key(name, { ctrlKey: parts.includes('Ctrl') }));
      });
      expect(done, keys.join(' / ')).toEqual(actions);
    }
    const listed = PDF_VIEWER_KEYS.flatMap((entry) => entry.actions);
    expect([...listed].sort()).toEqual(
      ['actual-size', 'first', 'last', 'next', 'previous', 'zoom-in', 'zoom-out'].sort(),
    );
  });
});
