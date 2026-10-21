/**
 * Page and zoom of each PDF opened in this window, so switching tabs, reloading a changed file or
 * following a rename comes back where the reader was. Memory only (per vault, cleared on reload).
 */
import type { VaultPath } from '../../lib/api/vault-types';
import { pathKey } from '../../lib/vault-paths';
import { useVaultStore } from '../../lib/vault-store';
import { subscribeServerEvent } from '../../lib/ws/server-event-bus';

export interface PdfView {
  page: number;
  zoom: number;
  /** Zoom follows the width of the window. */
  fitWidth: boolean;
}

export const DEFAULT_PDF_VIEW: PdfView = { page: 1, zoom: 1, fitWidth: true };

const views = new Map<string, PdfView>();
let unsubscribe: (() => void) | null = null;

const keyOf = (path: VaultPath) => `${useVaultStore.getState().vaultId ?? ''}|${pathKey(path)}`;

function followRenames(): void {
  if (unsubscribe) return;
  unsubscribe = subscribeServerEvent('note:renamed', (event) => {
    const view = views.get(keyOf(event.oldPath));
    if (!view) return;
    views.delete(keyOf(event.oldPath));
    views.set(keyOf(event.path), view);
  });
}

export function rememberedView(path: VaultPath): PdfView {
  followRenames();
  return views.get(keyOf(path)) ?? DEFAULT_PDF_VIEW;
}

export function rememberView(path: VaultPath, view: PdfView): void {
  followRenames();
  views.set(keyOf(path), view);
}

/** Test helper. */
export function resetPdfViews(): void {
  views.clear();
  unsubscribe?.();
  unsubscribe = null;
}
