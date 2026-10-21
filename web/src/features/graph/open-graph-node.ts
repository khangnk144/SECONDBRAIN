import { i18n } from '../../i18n';
import type { VaultPath } from '../../lib/api/vault-types';
import { useTabsStore } from '../../lib/tabs-store';
import { showToast } from '../../lib/toast-store';
import { isNotePath } from '../../lib/vault-paths';

/**
 * Opens a node: a Markdown file (note, or a raw source in `.md`) opens in the editor; other
 * documents only get a toast until the attachment viewer exists.
 */
export function openGraphNode(id: VaultPath, options: { newTab?: boolean } = {}): void {
  if (isNotePath(id)) {
    useTabsStore.getState().openNote(id, { newTab: options.newTab === true });
    return;
  }
  showToast({ message: i18n.t('graph.sourceLater') });
}
