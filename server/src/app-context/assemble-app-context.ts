import type { DeadlineService, IndexService } from '../index/index-types.js';
import type { AppLogger } from '../logging/rotating-file-logger.js';
import { createSampleDataService } from '../sample-data/sample-data-service.js';
import type { PendingJournalEntry, VaultService } from '../vault/vault-types.js';
import type { VaultWatcher } from '../vault/vault-watcher.js';
import type { ServerEvent } from '../ws/server-events.js';
import type { WebSocketHub } from '../ws/websocket-hub.js';
import { errorCodeOf } from './app-context-errors.js';
import type { AppContext } from './create-app-context.js';
import type { VaultChangeRouter } from './vault-change-router.js';
import type { VaultPluginInstance } from './vault-plugins.js';

export interface ContextParts {
  vault: VaultService;
  index: IndexService;
  deadlines: DeadlineService;
  hub: WebSocketHub;
  router: VaultChangeRouter;
  watcher: VaultWatcher | null;
  logger: AppLogger;
  now: () => Date;
  /** Journal entries reported at boot (clients get them on connect). */
  pending: PendingJournalEntry[];
  /** Subscribers of the router's client events (`AppContext.onEvent`). */
  listeners?: Set<(event: ServerEvent) => void>;
}

/** The running context: rebuild control, journal broadcasts and an orderly shutdown. */
export function assembleAppContext(parts: ContextParts): AppContext {
  const { vault, index, hub, router, watcher, logger } = parts;
  let lastJournal = JSON.stringify(parts.pending);
  let rebuilding: Promise<void> | null = null;
  let closing: Promise<void> | null = null;
  const plugins = new Map<string, VaultPluginInstance>();
  const listeners = parts.listeners ?? new Set<(event: ServerEvent) => void>();

  return {
    vault,
    index,
    deadlines: parts.deadlines,
    hub,
    sampleData: createSampleDataService(vault, parts.now),
    logger,
    now: parts.now,
    settled: () => router.settled(),
    startRebuild() {
      if (rebuilding || index.isRebuilding()) return false;
      logger.info('Index rebuild requested.');
      rebuilding = index
        .rebuild((progress) => hub.broadcast({ type: 'index:progress', ...progress }))
        .then(() => logger.info('Index rebuilt.'))
        .catch((error: unknown) => logger.error(`Index rebuild failed (${errorCodeOf(error)}).`))
        .finally(() => {
          rebuilding = null;
        });
      return true;
    },
    async refreshPendingJournal() {
      // Best-effort: it runs after an operation (often in `finally`), and a failure to read the
      // journal must never replace the operation's own result or error.
      try {
        const entries = await vault.pendingJournal();
        const json = JSON.stringify(entries);
        if (json === lastJournal) return;
        lastJournal = json;
        hub.broadcast({ type: 'journal:pending', entries });
      } catch (error) {
        logger.warn(`Reading the journal after an operation failed (${errorCodeOf(error)}).`);
      }
    },
    async greet(send) {
      send({ type: 'journal:pending', entries: await vault.pendingJournal() });
    },
    plugin<T extends VaultPluginInstance>(name: string): T | null {
      return (plugins.get(name) as T | undefined) ?? null;
    },
    attachPlugin(name, instance) {
      plugins.set(name, instance);
    },
    onEvent(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    close() {
      closing ??= (async () => {
        // Plugins first (their timers may still read the index or write through the vault).
        for (const [name, instance] of [...plugins].reverse()) {
          await instance
            .close()
            .catch((error: unknown) =>
              logger.warn(`Closing the ${name} plugin failed (${errorCodeOf(error)}).`),
            );
        }
        plugins.clear();
        listeners.clear();
        await watcher?.close();
        await vault.close(); // queued writes finish and still reach the router
        await router.close();
        // Also cancels a running rebuild (the old index stays); the next start reconciles.
        index.close();
        await rebuilding;
        logger.info('Vault closed.');
      })();
      return closing;
    },
  };
}
