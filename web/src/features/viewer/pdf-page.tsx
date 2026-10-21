import { memo, useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { loadPdfJs, type PDFDocumentProxy } from './pdf-js';
import { outputScale, PDF_TO_CSS_UNITS } from './pdf-zoom';

/** A page's size at zoom 1, in PDF points, rotation applied. */
export interface PageSize {
  width: number;
  height: number;
}

export interface PdfPageProps {
  doc: PDFDocumentProxy;
  pageNumber: number;
  pageCount: number;
  size: PageSize;
  zoom: number;
  /** Visible or next to a visible page: draw it; otherwise only the empty frame stays. */
  active: boolean;
  onMeasured: (pageNumber: number, size: PageSize) => void;
  setElement: (pageNumber: number, element: HTMLDivElement | null) => void;
}

const isCancellation = (error: unknown) =>
  error instanceof Error &&
  (error.name === 'RenderingCancelledException' || error.name === 'AbortException');

/**
 * One page: a frame of the page's size (so the scroll length is right before anything is drawn),
 * the drawing on a `<canvas>` and pdf.js's text layer above it (selectable, read by screen
 * readers). A redraw goes into a fresh canvas that replaces the old one only when finished, so
 * zooming never flashes an empty page; leaving the active window removes the canvas (memory).
 */
export const PdfPage = memo(function PdfPage({
  doc,
  pageNumber,
  pageCount,
  size,
  zoom,
  active,
  onMeasured,
  setElement,
}: PdfPageProps) {
  const { t } = useTranslation();
  const canvasHolder = useRef<HTMLDivElement>(null);
  const textLayer = useRef<HTMLDivElement>(null);
  const measured = useRef(onMeasured);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    measured.current = onMeasured;
  });

  useEffect(() => {
    const holder = canvasHolder.current;
    const text = textLayer.current;
    if (!holder || !text) return;
    if (!active) {
      holder.replaceChildren();
      text.replaceChildren();
      return;
    }
    let cancelled = false;
    let task: { cancel: () => void } | null = null;
    let layer: { cancel: () => void } | null = null;
    void (async () => {
      const page = await doc.getPage(pageNumber);
      if (cancelled) return;
      const base = page.getViewport({ scale: 1 });
      measured.current(pageNumber, { width: base.width, height: base.height });
      const viewport = page.getViewport({ scale: zoom * PDF_TO_CSS_UNITS });
      const ratio = outputScale(viewport.width, viewport.height, window.devicePixelRatio || 1);
      const canvas = document.createElement('canvas');
      canvas.className = 'pdf-page__canvas';
      canvas.width = Math.max(1, Math.floor(viewport.width * ratio));
      canvas.height = Math.max(1, Math.floor(viewport.height * ratio));
      const render = page.render({
        canvas,
        viewport,
        transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
      });
      task = render;
      await render.promise;
      if (cancelled) return;
      holder.replaceChildren(canvas);
      setFailed(false);
      const pdfjs = await loadPdfJs();
      if (cancelled) return;
      text.replaceChildren();
      const textLayerTask = new pdfjs.TextLayer({
        textContentSource: page.streamTextContent(),
        container: text,
        viewport,
      });
      layer = textLayerTask;
      await textLayerTask.render();
    })().catch((error: unknown) => {
      if (!cancelled && !isCancellation(error)) setFailed(true);
    });
    return () => {
      cancelled = true;
      task?.cancel();
      layer?.cancel();
    };
  }, [doc, pageNumber, zoom, active]);

  const frameRef = useCallback(
    (element: HTMLDivElement | null) => setElement(pageNumber, element),
    [setElement, pageNumber],
  );
  const scale = zoom * PDF_TO_CSS_UNITS;
  // The text layer sizes itself from this variable (pdf.js reads `--total-scale-factor`).
  const style = {
    width: `${size.width * scale}px`,
    height: `${size.height * scale}px`,
    '--total-scale-factor': String(scale),
  } as CSSProperties;
  return (
    <div
      ref={frameRef}
      className="pdf-page"
      data-page={pageNumber}
      role="group"
      aria-label={t('viewer.pdf.pageLabel', { page: pageNumber, total: pageCount })}
      style={style}
    >
      <div ref={canvasHolder} className="pdf-page__drawing" aria-hidden="true" />
      <div ref={textLayer} className="pdf-text-layer" />
      {failed ? <p className="pdf-page__failed">{t('viewer.pdf.pageFailed')}</p> : null}
    </div>
  );
});
