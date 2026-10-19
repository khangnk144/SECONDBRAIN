import type { RebuildProgress } from '../index/index-types.js';
import type { PendingJournalEntry, VaultChange, VaultPath } from '../vault/vault-types.js';

/**
 * Events pushed to every `/ws` client. `note:*` events cover every vault file (notes and
 * attachments alike; the path tells them apart) so the tree, open tabs and views can refresh.
 */
export type ServerEvent =
  | { type: 'hello'; version: string }
  | { type: 'note:changed' | 'note:created'; path: VaultPath; revision: string }
  | { type: 'note:deleted'; path: VaultPath }
  | { type: 'note:renamed'; path: VaultPath; oldPath: VaultPath; revision: string }
  | { type: 'folder:changed'; path: VaultPath }
  | ({ type: 'index:progress' } & RebuildProgress)
  | { type: 'journal:pending'; entries: PendingJournalEntry[] };

/** The client-facing event for a vault change (app or external origin). */
export function serverEventForChange(change: VaultChange): ServerEvent {
  switch (change.kind) {
    case 'created':
      return { type: 'note:created', path: change.path, revision: change.revision };
    case 'written':
      return { type: 'note:changed', path: change.path, revision: change.revision };
    case 'deleted':
      return { type: 'note:deleted', path: change.path };
    case 'renamed':
      return {
        type: 'note:renamed',
        path: change.path,
        oldPath: change.oldPath,
        revision: change.revision,
      };
    case 'folder-created':
    case 'folder-deleted':
      return { type: 'folder:changed', path: change.path };
  }
}
