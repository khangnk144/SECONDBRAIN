import type { VaultPath } from '../../lib/api/vault-types';
import { openVaultFile } from '../../lib/open-vault-file';
import { useTabsStore } from '../../lib/tabs-store';
import { isNotePath } from '../../lib/vault-paths';

/**
 * Opens a node: a Markdown file (note, or a raw source in `.md`) opens in the editor; a source node
 * of another type goes through `openVaultFile` (a PDF opens in the viewer tab, anything else is
 * offered as a download, never rendered in the app).
 */
export function openGraphNode(id: VaultPath, options: { newTab?: boolean } = {}): void {
  const newTab = options.newTab === true;
  if (isNotePath(id)) useTabsStore.getState().openNote(id, { newTab });
  else openVaultFile(id, { newTab });
}
