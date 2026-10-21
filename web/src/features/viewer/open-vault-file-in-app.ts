/**
 * The app's `openVaultFile`: notes open as note tabs, PDFs in the viewer tab (at `page` when
 * given), everything else (images, Office files, HTML pages…) is downloaded with an offer to open
 * it with another app.
 */
import { withQuery } from '../../lib/api/query-string';
import type { VaultPath } from '../../lib/api/vault-types';
import { FILE_ROUTE, navigateTo } from '../../lib/app-navigation';
import {
  setOpenVaultFileImplementation,
  vaultFileKind,
  type OpenVaultFileOptions,
} from '../../lib/open-vault-file';
import { useTabsStore } from '../../lib/tabs-store';
import { downloadVaultFile } from './vault-file-actions';

export function openVaultFileInApp(path: VaultPath, options: OpenVaultFileOptions = {}): void {
  const newTab = options.newTab === true;
  switch (vaultFileKind(path)) {
    case 'note':
      useTabsStore.getState().openNote(path, { newTab });
      return;
    case 'pdf':
      useTabsStore.getState().openFile(path, { newTab });
      // `&page=N` on the same history entry: the viewer scrolls there once (search hits).
      if (options.page !== undefined) {
        navigateTo(withQuery(FILE_ROUTE, { path, page: options.page }), { replace: true });
      }
      return;
    default:
      void downloadVaultFile(path);
  }
}

/** Installs the implementation; the returned function removes it again (tests, StrictMode). */
export function startOpenVaultFile(): () => void {
  setOpenVaultFileImplementation(openVaultFileInApp);
  return () => setOpenVaultFileImplementation(null);
}
