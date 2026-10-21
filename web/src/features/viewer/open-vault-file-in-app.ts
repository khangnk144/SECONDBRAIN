/**
 * The app's `openVaultFile`: notes open as note tabs, PDFs in the viewer tab, everything else
 * (images, Office files, HTML pages…) is downloaded with an offer to open it with another app.
 */
import type { VaultPath } from '../../lib/api/vault-types';
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
