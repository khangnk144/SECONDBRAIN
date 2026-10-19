import { startJournalSync, useJournalStore } from '../features/journal/journal-store';
import { startLinkTargetsSync, useLinkTargetsStore } from '../lib/link-targets-store';
import { usePanesStore } from '../lib/panes-store';
import { startTabsSync } from '../lib/tabs-sync';
import { useTabsStore } from '../lib/tabs-store';
import { startTreeSync, useTreeStore } from '../lib/tree-store';
import { useVaultStore } from '../lib/vault-store';
import { startServerEvents } from '../lib/ws/start-server-events';

/** Reads every per-vault browser state (panes, expanded folders, tabs) of the open vault. */
export function hydrateVaultState(): void {
  usePanesStore.getState().hydrate();
  useTreeStore.getState().hydrate();
  useTabsStore.getState().hydrate();
}

/**
 * Boot: WS events → stores, then `GET /health` for the vault id, then per-vault state and the
 * first fetches. Returns a stop function (used by tests and React StrictMode).
 */
export function startAppServices(token: string | null): () => void {
  const stops = [startTreeSync(), startLinkTargetsSync(), startTabsSync(), startJournalSync()];
  stops.push(startServerEvents(token));
  let stopped = false;
  void useVaultStore
    .getState()
    .load()
    .then(() => {
      if (stopped) return;
      hydrateVaultState();
      void useTreeStore.getState().fetchTree();
      void useLinkTargetsStore.getState().fetchTargets();
      void useJournalStore.getState().fetchPending();
    });
  return () => {
    stopped = true;
    stops.forEach((stop) => stop());
  };
}
