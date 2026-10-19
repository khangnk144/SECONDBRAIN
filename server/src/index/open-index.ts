/**
 * The index service: one live SQLite connection for queries, one serial queue for every change.
 * A rebuild runs as a queue task, so file changes arriving meanwhile wait behind it and are
 * applied right after the swap, while queries keep reading the previous database.
 */
import path from 'node:path';
import type { VaultPath, VaultService } from '../vault/vault-types.js';
import { DeferredSnapshots } from './deferred-snapshots.js';
import { createEventLog, type EventLog } from './event-log.js';
import { approximateHistory } from './first-index-history.js';
import { BuildCancelledError } from './index-builder.js';
import { openLiveDatabase } from './index-database.js';
import { applyChanges, type ChangeSet, type MutationContext } from './index-mutations.js';
import { IndexQueries, type LiveIndex } from './index-queries.js';
import { reconcileIndex } from './index-reconcile.js';
import type { IndexService, RebuildProgress } from './index-types.js';
import type { SwapFaults } from './database-swap.js';
import { rebuildAndSwap } from './rebuild-and-swap.js';
import { SerialQueue } from './serial-queue.js';

export interface OpenIndexOptions {
  vault: VaultService;
  now?: () => Date;
  /** Progress of rebuilds (the one `open` may need and those started without a callback). */
  onProgress?: (progress: RebuildProgress) => void;
  /** Defaults to `<vault>/.secondbrain/cache/index.sqlite`. */
  dbFile?: string;
  /** Non-fatal problems (unparseable note, event log not writable). Never receives note content. */
  onWarning?: (message: string, details?: Record<string, unknown>) => void;
  /** Test-only fault injection for the database swap. */
  faults?: SwapFaults;
}

type OpenResult = Awaited<ReturnType<IndexService['open']>>;
type ProgressFn = (progress: RebuildProgress) => void;

class SqliteIndexService extends IndexQueries implements IndexService {
  private readonly dbFile: string;
  private readonly warn: NonNullable<OpenIndexOptions['onWarning']>;
  private readonly events: EventLog;
  private readonly deferred = new DeferredSnapshots();
  private readonly queue = new SerialQueue();
  private opened: Promise<OpenResult> | null = null;
  private pendingRebuild: Promise<void> | null = null;
  private logging = true;
  private closed = false;

  constructor(private readonly options: OpenIndexOptions) {
    super(options.now ?? (() => new Date()));
    this.dbFile = options.dbFile ?? path.join(options.vault.paths.cacheDir, 'index.sqlite');
    this.warn = options.onWarning ?? (() => undefined);
    this.events = createEventLog(options.vault.paths.eventsFile, (error) =>
      this.warn('index: event log append failed', { error: (error as Error).message }),
    );
  }

  open(): Promise<OpenResult> {
    this.opened ??= this.queue.enqueue(async () => {
      // No log yet = the very first index of this vault: history is reconstructed instead.
      const firstIndex = !this.events.exists();
      this.logging = !firstIndex;
      const existing = openLiveDatabase(this.dbFile);
      let result: OpenResult = { rebuilt: false, reason: null };
      if ('db' in existing) {
        this.attach(existing.db);
        this.catalog.reset(this.current.reader.allPaths());
      } else {
        await this.runRebuild(this.options.onProgress);
        result = { rebuilt: true, reason: existing.reason };
      }
      await this.runReconcile();
      if (firstIndex) {
        this.events.append(approximateHistory(this.current.reader.listNotes()));
        this.events.touch();
        this.logging = true;
      }
      return result;
    });
    return this.opened;
  }

  private context(live: LiveIndex): MutationContext {
    return {
      db: live.db,
      writer: live.writer,
      catalog: this.catalog,
      vault: this.options.vault,
      now: this.now,
      log: (events) => {
        if (this.logging) this.events.append(events);
      },
      warn: this.warn,
      takePriorSnapshot: (p) => this.deferred.take(p),
    };
  }

  private mutate(paths: VaultPath[], changes: ChangeSet): Promise<void> {
    const deferred = this.pendingRebuild !== null;
    if (deferred) this.deferred.remember(paths);
    return this.queue.enqueue(async () => {
      try {
        if (this.closed || !this.live) return;
        await applyChanges(this.context(this.live), changes);
      } catch (error) {
        if (!this.closed) throw error;
      } finally {
        if (deferred) this.deferred.done();
      }
    });
  }

  updateFile(p: VaultPath): Promise<void> {
    return this.mutate([p], { written: [p] });
  }

  removeFile(p: VaultPath): Promise<void> {
    return this.mutate([p], { removed: [p] });
  }

  renameFile(oldPath: VaultPath, newPath: VaultPath): Promise<void> {
    return this.mutate([oldPath, newPath], { renamed: [{ from: oldPath, to: newPath }] });
  }

  private async runReconcile(): Promise<void> {
    if (this.closed || !this.live) return;
    const context = () => (this.closed || !this.live ? null : this.context(this.live));
    await reconcileIndex(this.options.vault, this.live.reader.storedStates(), context);
  }

  reconcile(): Promise<void> {
    return this.queue.enqueue(() => this.runReconcile());
  }

  private async runRebuild(onProgress?: ProgressFn): Promise<void> {
    const report = onProgress ?? this.options.onProgress ?? (() => undefined);
    const outcome = await rebuildAndSwap({
      vault: this.options.vault,
      dbFile: this.dbFile,
      current: this.live?.db ?? null,
      deferred: this.deferred,
      report,
      isCancelled: () => this.closed,
      warn: this.warn,
      faults: this.options.faults ?? {},
    });
    // The old connection is closed either way: never keep pointing at it.
    this.live = null;
    if (outcome.db) this.attach(outcome.db);
    if (!outcome.swapped) {
      this.warn('index: the rebuilt index could not be put in place', {
        error: outcome.error.message,
        previousIndexKept: outcome.db !== null,
      });
      throw outcome.error;
    }
    this.catalog.reset(outcome.paths);
    // Reported only now, so a listener may query the new index right away.
    report({ phase: 'done', done: outcome.paths.length, total: outcome.paths.length });
  }

  /** A request while a rebuild is queued or running joins that rebuild. */
  rebuild(onProgress?: ProgressFn): Promise<void> {
    this.pendingRebuild ??= this.queue.enqueue(async () => {
      try {
        if (!this.closed) await this.runRebuild(onProgress);
      } catch (error) {
        if (!(error instanceof BuildCancelledError)) throw error;
      } finally {
        this.pendingRebuild = null;
      }
    });
    return this.pendingRebuild;
  }

  isRebuilding(): boolean {
    return this.pendingRebuild !== null;
  }

  /** Every queued change (and any queued meanwhile) has been applied. */
  settled(): Promise<void> {
    return this.queue.idle();
  }

  close(): void {
    this.closed = true;
    this.live?.db.close();
    this.live = null;
  }
}

/**
 * Opens (or rebuilds) the index of `vault` and reconciles it with the files. Calling `open()` on
 * the returned service again just returns the result of this first open.
 */
export async function openIndex(options: OpenIndexOptions): Promise<IndexService> {
  const service = new SqliteIndexService(options);
  try {
    await service.open();
  } catch (error) {
    service.close();
    throw error;
  }
  return service;
}
