/**
 * Zoom of the PDF viewer. `zoom` 1 = 100 % = a page at its printed size (1 PDF point = 96/72 CSS
 * px, like browsers' PDF viewers); the steps match what readers expect from Chrome/Edge.
 */
export const PDF_TO_CSS_UNITS = 96 / 72;
export const ZOOM_STEPS = [
  0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4,
];
export const MIN_ZOOM = ZOOM_STEPS[0]!;
export const MAX_ZOOM = ZOOM_STEPS[ZOOM_STEPS.length - 1]!;
/** Space between pages and around them (px), also subtracted when fitting the width. */
export const PAGE_GAP = 16;

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/** The next step above the current zoom (a fitted 1.07 goes to 1.1, not 1.25). */
export function zoomIn(zoom: number): number {
  return ZOOM_STEPS.find((step) => step > zoom + 0.001) ?? MAX_ZOOM;
}

export function zoomOut(zoom: number): number {
  return [...ZOOM_STEPS].reverse().find((step) => step < zoom - 0.001) ?? MIN_ZOOM;
}

/** Zoom at which a page `pageWidthPt` points wide fills `containerWidth` px (gaps left free). */
export function fitWidthZoom(containerWidth: number, pageWidthPt: number): number {
  if (containerWidth <= 0 || pageWidthPt <= 0) return 1;
  const available = Math.max(containerWidth - PAGE_GAP * 2, 50);
  return clampZoom(available / (pageWidthPt * PDF_TO_CSS_UNITS));
}

export function zoomPercent(zoom: number): number {
  return Math.round(zoom * 100);
}

/**
 * Canvas pixels per CSS pixel for a page: the screen's pixel ratio, lowered when the canvas would
 * exceed `maxPixels` (very large zooms of big pages), so memory stays bounded.
 */
export function outputScale(
  cssWidth: number,
  cssHeight: number,
  pixelRatio: number,
  maxPixels = 16_777_216,
): number {
  const wanted = Math.max(pixelRatio, 1);
  const area = cssWidth * cssHeight * wanted * wanted;
  return area <= maxPixels ? wanted : Math.sqrt(maxPixels / (cssWidth * cssHeight));
}
