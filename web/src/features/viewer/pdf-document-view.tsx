import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { VaultPath } from '../../lib/api/vault-types';
import { focusIsLost, MAIN_REGION_ID } from '../../lib/focus-recovery';
import { baseName } from '../../lib/vault-paths';
import type { PDFDocumentProxy } from './pdf-js';
import { PdfPage, type PageSize } from './pdf-page';
import { PdfToolbar } from './pdf-toolbar';
import { rememberedView, rememberView, type PdfView } from './pdf-view-memory';
import { clampZoom, fitWidthZoom, PAGE_GAP, zoomIn, zoomOut } from './pdf-zoom';
import { pdfViewerKeyAction } from './pdf-viewer-keys';
import { pagesToDraw, useVisiblePages } from './use-visible-pages';

export interface PdfDocumentViewProps {
  doc: PDFDocumentProxy;
  path: VaultPath;
  onDownload: () => void;
  onOpenExternal: () => void;
}

/** US Letter, until the first page tells its real size. */
const FALLBACK_SIZE: PageSize = { width: 612, height: 792 };

/** Top of `element` inside the scrolling `container`, in the container's scroll coordinates. */
function offsetIn(container: HTMLElement, element: HTMLElement): number {
  return (
    element.getBoundingClientRect().top -
    container.getBoundingClientRect().top +
    container.scrollTop
  );
}

const sameSize = (a: PageSize, b: PageSize) =>
  Math.abs(a.width - b.width) < 0.5 && Math.abs(a.height - b.height) < 0.5;

/**
 * The pages of one opened PDF in a scroll area, drawn lazily (visible pages and one on each side),
 * with the toolbar above. The reading position is kept as "page + how far into it", so zooming
 * or fitting the width keeps the same spot on screen.
 */
export function PdfDocumentView({ doc, path, onDownload, onOpenExternal }: PdfDocumentViewProps) {
  const { t } = useTranslation();
  const pageCount = doc.numPages;
  const scroller = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<PdfView>(() => {
    const saved = rememberedView(path);
    return { ...saved, page: Math.min(Math.max(saved.page, 1), pageCount) };
  });
  const [baseSize, setBaseSize] = useState<PageSize | null>(null);
  const [sizes, setSizes] = useState<ReadonlyMap<number, PageSize>>(() => new Map());
  const pages = useVisiblePages(scroller, baseSize !== null);
  const anchor = useRef({ page: view.page, ratio: 0 });
  const { setCurrent, elementOf, current } = pages;

  useEffect(() => {
    let live = true;
    doc
      .getPage(1)
      .then((page) => {
        const viewport = page.getViewport({ scale: 1 });
        if (live) setBaseSize({ width: viewport.width, height: viewport.height });
      })
      .catch(() => {
        if (live) setBaseSize(FALLBACK_SIZE);
      });
    return () => {
      live = false;
    };
  }, [doc]);

  useEffect(() => setCurrent(anchor.current.page), [setCurrent]);

  // Opening the viewer with nothing focused puts the keyboard on the pages (PageDown works).
  useEffect(() => {
    if (!baseSize) return;
    const active = document.activeElement;
    if (focusIsLost() || active?.id === MAIN_REGION_ID)
      scroller.current?.focus({ preventScroll: true });
  }, [baseSize]);

  useEffect(() => {
    rememberView(path, { ...view, page: current });
  }, [path, view, current]);

  // "Vừa chiều rộng" follows the window's width until the reader zooms by hand.
  useLayoutEffect(() => {
    const element = scroller.current;
    if (!view.fitWidth || !baseSize || !element) return;
    const apply = () => {
      const zoom = fitWidthZoom(element.clientWidth, baseSize.width);
      setView((v) => (v.fitWidth && Math.abs(v.zoom - zoom) > 0.001 ? { ...v, zoom } : v));
    };
    apply();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(apply);
    observer.observe(element);
    return () => observer.disconnect();
  }, [view.fitWidth, baseSize]);

  // After a zoom (or once the page size is known) put the remembered spot back on screen.
  useLayoutEffect(() => {
    const element = scroller.current;
    const page = elementOf(anchor.current.page);
    if (!element || !page || !baseSize) return;
    const { ratio } = anchor.current;
    const top = offsetIn(element, page) + ratio * page.offsetHeight;
    element.scrollTop = ratio === 0 ? top - PAGE_GAP : top;
  }, [view.zoom, baseSize, elementOf]);

  const recordAnchor = () => {
    const element = scroller.current;
    const page = pages.elementOf(pages.current);
    if (!element || !page || page.offsetHeight === 0) return;
    const ratio = (element.scrollTop - offsetIn(element, page)) / page.offsetHeight;
    anchor.current = { page: pages.current, ratio: Math.min(Math.max(ratio, 0), 1) };
  };

  const goToPage = (wanted: number) => {
    const target = Math.min(Math.max(Math.round(wanted), 1), pageCount);
    const element = scroller.current;
    const page = pages.elementOf(target);
    anchor.current = { page: target, ratio: 0 };
    if (element && page) element.scrollTop = offsetIn(element, page) - PAGE_GAP;
    setCurrent(target);
  };

  const setZoom = (zoom: number) =>
    setView((v) => ({ ...v, zoom: clampZoom(zoom), fitWidth: false }));

  const onMeasured = useCallback((pageNumber: number, size: PageSize) => {
    setSizes((previous) => {
      const known = previous.get(pageNumber);
      if (known && sameSize(known, size)) return previous;
      return new Map(previous).set(pageNumber, size);
    });
  }, []);

  const draw = pagesToDraw(pages.visible, pageCount);
  const base = baseSize ?? FALLBACK_SIZE;

  return (
    <div
      className="pdf-document"
      onKeyDown={(event) => {
        const action = pdfViewerKeyAction(event);
        if (!action) return;
        event.preventDefault();
        if (action === 'next') goToPage(pages.current + 1);
        else if (action === 'previous') goToPage(pages.current - 1);
        else if (action === 'first') goToPage(1);
        else if (action === 'last') goToPage(pageCount);
        else if (action === 'zoom-in') setZoom(zoomIn(view.zoom));
        else if (action === 'zoom-out') setZoom(zoomOut(view.zoom));
        else setZoom(1);
      }}
    >
      <PdfToolbar
        page={pages.current}
        pageCount={pageCount}
        zoom={view.zoom}
        fitWidth={view.fitWidth}
        onPage={goToPage}
        onZoomIn={() => setZoom(zoomIn(view.zoom))}
        onZoomOut={() => setZoom(zoomOut(view.zoom))}
        onFitWidth={() => setView((v) => ({ ...v, fitWidth: true }))}
        onDownload={onDownload}
        onOpenExternal={onOpenExternal}
      />
      <div
        ref={scroller}
        className="pdf-scroller"
        tabIndex={0}
        role="region"
        aria-label={t('viewer.pdf.pagesLabel', { name: baseName(path) })}
        onScroll={recordAnchor}
      >
        <div className="pdf-pages">
          {Array.from({ length: pageCount }, (_, index) => index + 1).map((pageNumber) => (
            <PdfPage
              key={pageNumber}
              doc={doc}
              pageNumber={pageNumber}
              pageCount={pageCount}
              size={sizes.get(pageNumber) ?? base}
              zoom={view.zoom}
              active={baseSize !== null && draw.has(pageNumber)}
              onMeasured={onMeasured}
              setElement={pages.setElement}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
