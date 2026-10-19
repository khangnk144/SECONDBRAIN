import type { VaultPath } from './api/vault-types';
import { useTabsStore } from './tabs-store';
import { subscribeServerEvent } from './ws/server-event-bus';

/**
 * Notes whose tab must stay open when the file is deleted elsewhere: the note screen registers
 * "has unsaved text", so the conflict screen can offer to re-create the note instead of the tab
 * silently closing over text that only lives in a draft.
 */
let keepTabWhenDeleted: (path: VaultPath) => boolean = () => false;

export function setKeepTabWhenDeleted(predicate: (path: VaultPath) => boolean): void {
  keepTabWhenDeleted = predicate;
}

/**
 * Keeps open tabs in step with the vault: a renamed note's tab follows it; a deleted note's tab
 * closes with a 4 s toast unless it has unsaved text. Deletions made by the app itself close
 * their tabs first, so no toast.
 */
export function startTabsSync(): () => void {
  const unsubscribers = [
    subscribeServerEvent('note:renamed', (event) =>
      useTabsStore.getState().renamePath(event.oldPath, event.path),
    ),
    subscribeServerEvent('note:deleted', (event) => {
      if (keepTabWhenDeleted(event.path)) return;
      useTabsStore.getState().closePaths([event.path], { notify: true });
    }),
  ];
  return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
}
