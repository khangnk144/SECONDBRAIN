/**
 * Keys of the PDF viewer, handled only while focus is inside it (the browser keeps its own zoom
 * and keys everywhere else): PageUp/PageDown move a page, Home/End go to the first/last page,
 * Ctrl+= / Ctrl+- zoom, Ctrl+0 shows 100 %. Arrow keys are left to the browser (they scroll).
 * In the page-number field Home/End keep moving the caret.
 */
export type PdfViewerKeyAction =
  'next' | 'previous' | 'first' | 'last' | 'zoom-in' | 'zoom-out' | 'actual-size';

/**
 * The keys as the shortcut sheet lists them (one row per pair of opposite moves); a test checks
 * every listed key against `pdfViewerKeyAction`, so the sheet and the handler cannot drift.
 */
export const PDF_VIEWER_KEYS: ReadonlyArray<{
  id: 'pages' | 'ends' | 'zoomIn' | 'zoomOut' | 'actualSize';
  keys: readonly string[];
  actions: readonly PdfViewerKeyAction[];
}> = [
  { id: 'pages', keys: ['PageUp', 'PageDown'], actions: ['previous', 'next'] },
  { id: 'ends', keys: ['Home', 'End'], actions: ['first', 'last'] },
  { id: 'zoomIn', keys: ['Ctrl+='], actions: ['zoom-in'] },
  { id: 'zoomOut', keys: ['Ctrl+-'], actions: ['zoom-out'] },
  { id: 'actualSize', keys: ['Ctrl+0'], actions: ['actual-size'] },
];

interface KeyLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  target: EventTarget | null;
  defaultPrevented?: boolean;
}

function inTextField(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
}

export function pdfViewerKeyAction(event: KeyLike): PdfViewerKeyAction | null {
  if (event.defaultPrevented || event.altKey) return null;
  if (event.ctrlKey || event.metaKey) {
    if (event.key === '=' || event.key === '+') return 'zoom-in';
    if (event.key === '-' || event.key === '_') return 'zoom-out';
    if (event.key === '0') return 'actual-size';
    return null;
  }
  if (event.shiftKey) return null;
  if (event.key === 'PageDown') return 'next';
  if (event.key === 'PageUp') return 'previous';
  if (inTextField(event.target)) return null;
  if (event.key === 'Home') return 'first';
  if (event.key === 'End') return 'last';
  return null;
}
