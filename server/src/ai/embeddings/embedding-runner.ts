/**
 * Runs embedding passes one at a time and decides what happens after a failure: retry after
 * 1 min, 5 min, 30 min, then every 2 h; `auth`/`quota` stop until the settings change; a batch
 * that would cross the monthly limit holds the jobs until next month or a higher limit.
 */
import type { VaultPath } from '../../vault/vault-types.js';
import { monthKey } from '../budget/usage-store.js';
import type { EmbeddingDeps } from './embedding-deps.js';
import { failureAction } from './embedding-failures.js';
import { runEmbeddingPass } from './embedding-pass.js';
import type { EmbeddingStore } from './embedding-store.js';

export interface RunnerHooks {
  deps: EmbeddingDeps;
  queue: Set<VaultPath>;
  store: () => EmbeddingStore;
  isActive: () => boolean;
  notify: (force?: boolean) => void;
  /** After every pass; `completed` = the queue was emptied without a failure or a cancel. */
  afterPass: (completed: boolean) => void;
}

export class EmbeddingRunner {
  readonly progress = { done: 0, total: 0 };
  /** Deleted or renamed away during the running pass: never written. */
  readonly dropped = new Set<VaultPath>();
  /** `auth` or `quota`: no pass until the settings change. */
  halted: string | null = null;
  lastError: string | null = null;
  private running: Promise<void> | null = null;
  private controller: AbortController | null = null;
  private retryTimer: unknown = null;
  private attempt = 0;
  private budgetHold: { month: string; limit: number } | null = null;
  private closed = false;

  constructor(private readonly hooks: RunnerHooks) {}

  get busy(): boolean {
    return this.running !== null;
  }

  get retrying(): boolean {
    return this.retryTimer !== null;
  }

  /** True while a batch was refused by the budget in this month at this limit. */
  held(): boolean {
    const { deps } = this.hooks;
    const hold = this.budgetHold;
    if (!hold) return false;
    const limit = deps.settings().ai.monthlyTokenLimit;
    if (hold.month === monthKey(deps.now()) && hold.limit === limit) return true;
    this.budgetHold = null;
    return false;
  }

  /** Cancels the running request (its unfinished notes go back to the queue). */
  abort(): void {
    this.controller?.abort();
  }

  /** Cancels the request and a pending retry (switched off, paused, or a rebuild). */
  reset(): void {
    this.abort();
    if (this.retryTimer !== null) this.hooks.deps.timers.clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.attempt = 0;
  }

  noteRemoved(path: VaultPath): void {
    if (this.running) this.dropped.add(path);
  }

  kick(): void {
    const { hooks } = this;
    if (this.closed || this.running || this.retryTimer !== null || this.halted) return;
    if (hooks.queue.size === 0 || !hooks.isActive()) return;
    const pass = new AbortController();
    this.controller = pass;
    this.dropped.clear();
    this.progress.done = 0;
    this.progress.total = 0;
    let completed = false;
    this.running = (async () => {
      try {
        await runEmbeddingPass({
          deps: hooks.deps,
          store: hooks.store(),
          queue: hooks.queue,
          signal: pass.signal,
          progress: this.progress,
          dropped: this.dropped,
          isActive: hooks.isActive,
          onProgress: () => hooks.notify(),
        });
        completed = hooks.queue.size === 0 && !pass.signal.aborted;
        if (completed) {
          this.attempt = 0;
          this.lastError = null;
        }
      } catch (error) {
        if (!pass.signal.aborted && !this.closed) this.failed(error);
      }
    })().finally(() => {
      this.running = null;
      if (this.controller === pass) this.controller = null;
      if (!this.closed) hooks.afterPass(completed);
    });
    hooks.notify(true); // after `running` is set, so clients see the pass start
  }

  private failed(error: unknown): void {
    const { deps } = this.hooks;
    const action = failureAction(error, this.attempt);
    if (action.kind === 'ignore') return;
    this.lastError = action.code;
    if (action.kind === 'budget') {
      this.budgetHold = {
        month: monthKey(deps.now()),
        limit: deps.settings().ai.monthlyTokenLimit,
      };
    } else if (action.kind === 'halt') {
      this.halted = action.code;
      deps.logger.warn(`Embeddings stopped (${action.code}); waiting for a settings change.`);
    } else {
      this.attempt += 1;
      const minutes = action.delayMs / 60_000;
      deps.logger.warn(`Embedding batch failed (${action.code}); retrying in ${minutes} min.`);
      this.retryTimer = deps.timers.setTimeout(() => {
        this.retryTimer = null;
        this.kick();
        this.hooks.notify(true);
      }, action.delayMs);
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    this.reset();
    await this.running?.catch(() => undefined);
  }
}
