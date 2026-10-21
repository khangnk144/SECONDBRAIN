/**
 * Embedding jobs (SPEC F33.3–F33.5). Nothing runs and nothing is sent unless embeddings are
 * active: AI and embeddings on, embeddings consent for the current provider, its key, and budget
 * left. A saved note is embedded 5 minutes after its last change (one timer per path, reset on
 * every change); vault events only schedule, so saves never wait. Startup, enabling and a model
 * change queue every in-scope note whose stored revision differs for one immediate pass (the
 * runner executes passes and retries).
 */
import path from 'node:path';
import { isNotePath } from '../../markdown/content-classes.js';
import type { VaultPath } from '../../vault/vault-types.js';
import type { ServerEvent } from '../../ws/server-events.js';
import type { EmbeddingIndex, EmbeddingState } from '../ai-types.js';
import { embeddingConfigOf } from '../providers/default-models.js';
import { embedBlock } from '../runtime/ai-readiness.js';
import type { EmbeddingsSnapshot } from '../runtime/ai-status.js';
import type { EmbeddingDeps } from './embedding-deps.js';
import { queryEmbeddings } from './embedding-query.js';
import { reconcileStore, sameConfig } from './embedding-reconcile.js';
import { EmbeddingRunner } from './embedding-runner.js';
import { EmbeddingStore } from './embedding-store.js';
import { createThrottledSender, PathTimers } from './embedding-timers.js';

export const QUIET_PERIOD_MS = 5 * 60_000;
export const BUDGET_RECHECK_MS = 60 * 60_000;
/** Progress events at most twice a second; state changes go out at once. */
export const PROGRESS_INTERVAL_MS = 500;
export const EMBEDDINGS_FILE = 'embeddings.sqlite';

export interface EmbeddingService {
  snapshot(): EmbeddingsSnapshot;
  /** The index when embeddings are active and at least one chunk is stored, else null. */
  index(): EmbeddingIndex | null;
  rebuild(): boolean;
  /** Re-evaluates after a settings change (also clears an auth/quota stop) and announces it. */
  settingsChanged(): void;
  handleEvent(event: ServerEvent): void;
  close(): Promise<void>;
}

export function createEmbeddingService(deps: EmbeddingDeps): EmbeddingService {
  const { timers } = deps;
  const dbFile = path.join(deps.context.vault.paths.cacheDir, EMBEDDINGS_FILE);
  let store: EmbeddingStore | null = null;
  const quiet = new PathTimers(timers, QUIET_PERIOD_MS);
  const queue = new Set<VaultPath>();
  let budgetTimer: unknown = null;
  let stale = false;
  let closed = false;
  let fingerprint: string | null = null;

  const ai = () => deps.settings().ai;
  const usedUp = () => deps.usage.month(deps.now()).tokens >= ai().monthlyTokenLimit;
  const isActive = () => !closed && embedBlock(ai(), usedUp() || runner.held()) === null;
  const openStore = (): EmbeddingStore => (store ??= new EmbeddingStore(dbFile));
  const runner: EmbeddingRunner = new EmbeddingRunner({
    deps,
    queue,
    store: openStore,
    isActive,
    notify: (force) => notify(force),
    afterPass(completed) {
      if (completed) stale = false;
      notify(true);
      sync();
    },
  });

  function state(): EmbeddingState {
    if (!isActive()) return 'off';
    if (runner.halted) return 'error';
    if (runner.busy) return 'running';
    if (stale) return 'stale';
    return queue.size > 0 || runner.retrying ? 'queued' : 'idle';
  }

  const snapshot = (): EmbeddingsSnapshot => ({
    state: state(),
    done: runner.progress.done,
    total: runner.progress.total,
    pending: quiet.size + (runner.retrying ? queue.size : 0),
    lastError: runner.lastError,
    available: isActive() && store !== null && store.hasChunks(),
  });
  const sender = createThrottledSender(timers, deps.now, PROGRESS_INTERVAL_MS, () => {
    if (!closed) deps.broadcast(snapshot());
  });
  const notify = (force = false) => sender.notify(force);

  /** Aligns the store with the settings and the vault; queues what is missing or outdated. */
  function reconcile(force: boolean): void {
    const config = embeddingConfigOf(ai());
    const target = openStore();
    // A pass for the old configuration must not write into the new store.
    if (force || !sameConfig(target.config(), config)) runner.abort();
    const notes = deps.context.index.listNotes();
    const result = reconcileStore(target, config, notes, deps.inScope, queue, force);
    if (!result.reset) return;
    stale = result.stale;
    runner.halted = null;
    runner.lastError = null;
    if (stale) notify(true);
  }

  function sync(forceNotify = false): void {
    if (closed) return;
    const current = JSON.stringify([isActive(), embeddingConfigOf(ai()), ai().folders]);
    const first = fingerprint === null; // the plugin start announces nothing by itself
    const changed = current !== fingerprint;
    fingerprint = current;
    if (!isActive()) {
      if (changed) {
        runner.reset();
        quiet.clear();
        queue.clear(); // the next activation compares revisions again
      }
      // Paused only by the budget: look again later (a new month resumes the jobs).
      if (embedBlock(ai(), false) === null && budgetTimer === null) {
        budgetTimer = timers.setTimeout(() => {
          budgetTimer = null;
          sync();
        }, BUDGET_RECHECK_MS);
      }
    } else {
      if (budgetTimer !== null) timers.clearTimeout(budgetTimer);
      budgetTimer = null;
      if (changed) reconcile(false);
      runner.kick();
    }
    if ((changed && !first) || forceNotify) notify(true);
  }

  function forget(notePath: VaultPath): void {
    quiet.cancel(notePath);
    queue.delete(notePath);
    runner.noteRemoved(notePath);
    store?.removeNote(notePath);
  }

  function schedule(notePath: VaultPath): void {
    if (!isNotePath(notePath)) return;
    if (!deps.inScope(notePath)) return forget(notePath);
    if (!isActive()) return; // the next activation compares revisions anyway
    quiet.restart(notePath, () => {
      if (!isActive()) return;
      queue.add(notePath);
      runner.kick();
    });
  }

  function moved(oldPath: VaultPath, newPath: VaultPath): void {
    if (store && isNotePath(oldPath) && isNotePath(newPath) && deps.inScope(newPath)) {
      quiet.cancel(oldPath);
      queue.delete(oldPath);
      runner.noteRemoved(oldPath);
      store.renameNote(oldPath, newPath); // a move keeps its vectors (same text)
    } else {
      forget(oldPath);
    }
    schedule(newPath);
  }

  const embeddingIndex: EmbeddingIndex = {
    isReady: () =>
      isActive() &&
      !stale &&
      !runner.halted &&
      !runner.busy &&
      !runner.retrying &&
      queue.size === 0,
    query: (text, k, signal) => queryEmbeddings(deps, openStore(), text, k, signal),
  };

  sync();

  return {
    snapshot,
    index() {
      sync();
      return isActive() && store !== null && store.hasChunks() ? embeddingIndex : null;
    },
    rebuild() {
      sync();
      if (!isActive() || runner.busy) return false;
      runner.reset();
      reconcile(true);
      notify(true);
      runner.kick();
      return true;
    },
    settingsChanged() {
      runner.halted = null;
      sync(true);
    },
    handleEvent(event) {
      if (closed) return;
      sync();
      if (event.type === 'note:created' || event.type === 'note:changed') schedule(event.path);
      else if (event.type === 'note:renamed') moved(event.oldPath, event.path);
      else if (event.type === 'note:deleted') forget(event.path);
    },
    async close() {
      if (closed) return;
      closed = true;
      quiet.clear();
      if (budgetTimer !== null) timers.clearTimeout(budgetTimer);
      sender.cancel();
      await runner.close();
      store?.close();
      store = null;
    },
  };
}
