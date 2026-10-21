import { useEffect, useRef } from 'react';
import type { VaultPath } from '../../lib/api/vault-types';
import { isPageRequestApplied, markPageRequestApplied, requestedPage } from './pdf-view-memory';
import type { PdfPageRequest } from './pdf-viewer';

/** The page the view opens at: a fresh `&page=N` request, else the remembered page. */
export function openingPage(
  path: VaultPath,
  request: PdfPageRequest | null,
  pageCount: number,
  rememberedPage: number,
): number {
  const fresh = request !== null && !isPageRequestApplied(path, request.key);
  const page = fresh ? requestedPage(request.page, pageCount) : rememberedPage;
  return Math.min(Math.max(page, 1), pageCount);
}

/**
 * Applies a `&page=N` request once per navigation: at mount (the view already opened there) and
 * when another request arrives for the PDF on screen (a second search hit in it).
 */
export function usePdfPageRequest(
  path: VaultPath,
  request: PdfPageRequest | null,
  pageCount: number,
  goToPage: (page: number) => void,
): void {
  const goTo = useRef(goToPage);
  goTo.current = goToPage;
  const key = request?.key ?? null;
  const page = request?.page ?? Number.NaN;
  useEffect(() => {
    if (key === null || isPageRequestApplied(path, key)) return;
    markPageRequestApplied(path, key);
    goTo.current(requestedPage(page, pageCount));
  }, [path, key, page, pageCount]);
}
