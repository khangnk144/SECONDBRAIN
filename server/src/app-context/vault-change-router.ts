import type { IndexService } from '../index/index-types.js';
import type { AppLogger } from '../logging/rotating-file-logger.js';
import { isVaultError, type VaultChange, type VaultPath } from '../vault/vault-types.js';
import { serverEventForChange, type ServerEvent } from '../ws/server-events.js';
import { errorCodeOf } from './app-context-errors.js';
import { RecentAppChanges } from './recent-app-changes.js';

export interface VaultChangeRouterOptions {
  index: IndexService;
  broadcast: (event: ServerEvent) => void;
  logger: AppLogger;
  echoTtlMs?: number;
  reconcileDelayMs?: number;
}

/**
 * The one place that turns vault changes (made by the app or seen by the watcher) into index
 * updates and WebSocket events. Changes are applied strictly in arrival order through one queue,
 * so the index never sees an older state after a newer one; clients hear about a change only
 * after the index reflects it (a refresh triggered by the event already finds the new data).
 */
export interface VaultChangeRouter {
  handle(change: VaultChange): void;
  /**
   * Resolves once every change handled so far has reached the index and the clients; during a
   * rebuild, once it is queued behind the rebuild (queries then come from the old index anyway).
   */
  settled(): Promise<void>;
  /** Re-scans the vault against the index soon (after a watcher error or a failed update). */
  requestReconcile(): void;
  close(): Promise<void>;
}

export function createVaultChangeRouter(options: VaultChangeRouterOptions): VaultChangeRouter {
  const { index, broadcast, logger } = options;
  const echoes = new RecentAppChanges(options.echoTtlMs);
  let tail: Promise<void> = Promise.resolve();
  let closed = false;
  let reconcileTimer: NodeJS.Timeout | null = null;

  function enqueue(task: () => Promise<void>): void {
    // Log codes only: paths are note titles, and logs never carry note content.
    tail = tail.then(task).catch((error: unknown) => {
      logger.error(`Applying a vault change failed (${errorCodeOf(error)}).`);
    });
  }

  const indexedRevision = (path: VaultPath) => index.getNote(path)?.revision ?? null;

  /** The index already shows what the change describes (null = not a note or not yet indexed). */
  function indexAgrees(change: VaultChange): boolean {
    switch (change.kind) {
      case 'created':
      case 'written': {
        const revision = indexedRevision(change.path);
        return revision === null || revision === change.revision;
      }
      case 'deleted':
        return indexedRevision(change.path) === null;
      case 'renamed': {
        const revision = indexedRevision(change.path);
        return (
          indexedRevision(change.oldPath) === null &&
          (revision === null || revision === change.revision)
        );
      }
      default:
        return true;
    }
  }

  async function applyToIndex(change: VaultChange): Promise<void> {
    switch (change.kind) {
      case 'created':
      case 'written':
        try {
          await index.updateFile(change.path);
        } catch (error) {
          // Gone again before it could be read: its deletion event may already be past.
          if (!isVaultError(error) || error.code !== 'NOT_FOUND') throw error;
          await index.removeFile(change.path);
        }
        return;
      case 'deleted':
        return index.removeFile(change.path);
      case 'renamed':
        return index.renameFile(change.oldPath, change.path);
      case 'folder-deleted':
        // A folder deleted or renamed outside the app: depending on the platform the watcher
        // may not report every file inside, so re-scan (reconcile also pairs renamed files).
        if (change.origin === 'external') requestReconcile();
        return;
      default:
        // New folders: the tree is read from disk, and files inside report their own changes.
        return;
    }
  }

  async function apply(change: VaultChange): Promise<void> {
    if (change.origin === 'external' && echoes.isEcho(change) && indexAgrees(change)) return;
    const event = serverEventForChange(change);
    const update = applyToIndex(change).catch((error: unknown) => {
      logger.warn(`Index update for a ${change.kind} change failed (${errorCodeOf(error)}).`);
      requestReconcile();
    });
    if (index.isRebuilding()) {
      // The index holds this update until the rebuild swaps in (minutes on a big vault); saves
      // must not wait for that. Clients hear about it once the new index has it.
      void update.then(() => broadcast(event));
      return;
    }
    await update;
    broadcast(event);
  }

  function requestReconcile(): void {
    if (closed || reconcileTimer) return;
    reconcileTimer = setTimeout(() => {
      reconcileTimer = null;
      enqueue(async () => {
        // A running rebuild re-reads every file anyway.
        if (closed || index.isRebuilding()) return;
        await index.reconcile();
        // Clients cannot know what changed; "done" tells them to reload their views.
        broadcast({ type: 'index:progress', phase: 'done', done: 0, total: 0 });
      });
    }, options.reconcileDelayMs ?? 1000);
  }

  return {
    handle(change) {
      if (closed) return;
      // Recorded synchronously: the watcher's echo may arrive before the queue reaches it.
      if (change.origin === 'app') echoes.record(change);
      enqueue(() => apply(change));
    },
    settled() {
      return tail;
    },
    requestReconcile,
    async close() {
      closed = true;
      if (reconcileTimer) clearTimeout(reconcileTimer);
      reconcileTimer = null;
      await tail;
    },
  };
}
