import path from 'node:path';
import type { GlobalSettings } from '../config/global-settings.js';
import { findVaultOverlap, resolveVaultRoot } from '../config/vault-location.js';
import { createDeadlineService } from '../index/deadline-service.js';
import { createIndexRelinkPlanner } from '../index/index-relink-planner.js';
import type { DeadlineService, IndexService, RebuildProgress } from '../index/index-types.js';
import { openIndex } from '../index/open-index.js';
import type { AppLogger } from '../logging/rotating-file-logger.js';
import { isVaultHandoverLogger } from '../logging/vault-handover-logger.js';
import type { SampleDataService } from '../sample-data/sample-data-service.js';
import { openVault } from '../vault/open-vault.js';
import type { VaultFaults } from '../vault/vault-faults.js';
import type { VaultChange, VaultService } from '../vault/vault-types.js';
import { startVaultWatcher, type VaultWatcher } from '../vault/vault-watcher.js';
import type { ServerEvent } from '../ws/server-events.js';
import type { VaultPluginInstance } from './vault-plugins.js';
import { createWebSocketHub, type WebSocketHub } from '../ws/websocket-hub.js';
import { errorCodeOf, VaultUnusableError } from './app-context-errors.js';
import { assembleAppContext } from './assemble-app-context.js';
import { createVaultChangeRouter, type VaultChangeRouter } from './vault-change-router.js';

/** SPEC §4.11: trash entries older than this are purged at start. */
const TRASH_RETENTION_DAYS = 30;

export interface AppContextOptions {
  /** Install root (`D:\SECONDBRAIN`); the default vault is `<home>/vault`. */
  home: string;
  settings: Pick<GlobalSettings, 'vaultPath'>;
  logger: AppLogger;
  now?: () => Date;
  /** The app's code folder when it is not `<home>/app` (`--home` elsewhere); never a vault. */
  appDir?: string;
  /** File watcher timing (tests shorten it); `false` runs without a watcher. */
  watcher?: { renameWindowMs?: number; stabilityMs?: number } | false;
  /** Test-only disk faults and simulated crashes, passed to the vault service. */
  faults?: VaultFaults;
  /**
   * WebSocket clients to send events to. The vault host passes one hub that outlives every
   * vault it opens (clients stay connected across a vault switch); default: a new hub.
   */
  hub?: WebSocketHub;
}

/** Everything the API needs about the open vault, created once at boot and closed on shutdown. */
export interface AppContext {
  readonly vault: VaultService;
  readonly index: IndexService;
  readonly deadlines: DeadlineService;
  readonly hub: WebSocketHub;
  readonly sampleData: SampleDataService;
  readonly logger: AppLogger;
  readonly now: () => Date;
  /** Resolves once every vault change so far is in the index (read-your-writes for the API). */
  settled(): Promise<void>;
  /** Starts a full rebuild in the background; false when one is already running. */
  startRebuild(): boolean;
  /** Re-reads unfinished journal operations and tells clients when the list changed; never throws. */
  refreshPendingJournal(): Promise<void>;
  /** Sends the connection-time state to a new WebSocket client. */
  greet(send: (event: ServerEvent) => void): Promise<void>;
  /** A per-vault plugin started for this vault (`REMINDERS_PLUGIN`, `HISTORY_PLUGIN`), else null. */
  plugin<T extends VaultPluginInstance>(name: string): T | null;
  /** Host only: records a started plugin; `close()` closes plugins first, in reverse order. */
  attachPlugin(name: string, instance: VaultPluginInstance): void;
  /**
   * Every event the vault's change router sends to clients (`note:*`, `folder:changed`, sent once
   * the change is in the index), for per-vault services such as text extraction and embedding
   * jobs. Listeners must be quick and must not throw (errors are logged as codes). Returns an
   * unsubscribe function.
   */
  onEvent(listener: (event: ServerEvent) => void): () => void;
  close(): Promise<void>;
}

/**
 * Boot order: vault → watcher (buffering) → index (open + reconcile) → deadline service →
 * relink planner → change routing → trash purge → journal report. The watcher starts before the
 * index opens so nothing edited during a long first index is missed; its events wait until the
 * index is ready.
 */
export async function createAppContext(options: AppContextOptions): Promise<AppContext> {
  const now = options.now ?? (() => new Date());
  const { logger } = options;
  const root = resolveVaultRoot(options.settings, options.home);
  const installDirs = [path.join(options.home, '.secondbrain'), path.join(options.home, 'app')];
  if (options.appDir) installDirs.push(options.appDir);
  // Checked before anything is created: no state or templates may land in the install folders.
  const overlap = await findVaultOverlap(root, installDirs);
  if (overlap !== null) {
    throw new VaultUnusableError(
      root,
      new Error(`it overlaps the app's own folder "${overlap}"; choose a folder outside it`),
    );
  }
  let vault: VaultService;
  let created: string[];
  try {
    ({ vault, created } = await openVault({
      root,
      now,
      faults: options.faults,
      // Best-effort housekeeping problems: counts and codes; details may name files, so not logged.
      onWarning: (message) => logger.warn(message),
    }));
  } catch (error) {
    throw new VaultUnusableError(root, error);
  }
  if (isVaultHandoverLogger(logger)) logger.moveToVault(vault.paths.logsDir);
  logger.info(`Vault ${vault.id} opened; ${created.length} missing standard entries created.`);

  const hub = options.hub ?? createWebSocketHub();
  const listeners = new Set<(event: ServerEvent) => void>();
  const broadcast = (event: ServerEvent) => {
    hub.broadcast(event);
    for (const listener of listeners) {
      try {
        listener(event);
      } catch (error) {
        logger.warn(`A vault event listener failed (${errorCodeOf(error)}).`);
      }
    }
  };
  const early: VaultChange[] = [];
  let forward: (change: VaultChange) => void = (change) => early.push(change);
  let index: IndexService | null = null;
  let router: VaultChangeRouter | null = null;
  let watcher: VaultWatcher | null = null;

  try {
    if (options.watcher !== false) {
      watcher = startVaultWatcher({
        root: vault.root,
        onChange: (change) => forward(change),
        onError: (error) => {
          logger.warn(`File watcher problem (${errorCodeOf(error)}); re-scanning the vault.`);
          router?.requestReconcile();
        },
        knownRevision: (vaultPath) => {
          try {
            return index?.getNote(vaultPath)?.revision ?? null;
          } catch {
            return null; // index closed or between databases: report a plain deletion
          }
        },
        ...options.watcher,
      });
    }
    const openedIndex: IndexService = await openIndex({
      vault,
      now,
      onProgress: (progress: RebuildProgress) => broadcast({ type: 'index:progress', ...progress }),
      // Details may name notes; the log gets the message only.
      onWarning: (message: string) => logger.warn(message),
    });
    index = openedIndex;
    router = createVaultChangeRouter({ index: openedIndex, broadcast, logger });
    forward = router.handle;
    for (const change of early.splice(0)) router.handle(change);
    vault.onChange(router.handle);
    await watcher?.ready;

    const deadlines = createDeadlineService(openedIndex, now);
    const activeRouter = router;
    vault.setRelinkPlanner(
      createIndexRelinkPlanner(openedIndex, vault, { beforePlan: () => activeRouter.settled() }),
    );
    const purged = await vault.purgeTrash(TRASH_RETENTION_DAYS, now());
    if (purged > 0)
      logger.info(`Purged ${purged} trash entries older than ${TRASH_RETENTION_DAYS} days.`);
    const pending = await vault.pendingJournal();
    if (pending.length > 0) {
      const list = pending.map((entry) => `${entry.op} ${entry.id} (${entry.status})`).join(', ');
      logger.warn(`Unfinished operations in the journal: ${list}.`);
    }
    return assembleAppContext({
      vault,
      index: openedIndex,
      deadlines,
      hub,
      router,
      watcher,
      logger,
      now,
      pending,
      listeners,
    });
  } catch (error) {
    await watcher?.close().catch(() => undefined);
    await router?.close().catch(() => undefined);
    await vault.close().catch(() => undefined);
    index?.close();
    throw error;
  }
}
