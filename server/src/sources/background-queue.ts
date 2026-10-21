/**
 * The background work list of the sources plugin: paths to check (and extract if needed) plus
 * housekeeping tasks, run strictly one after the other so background extraction never competes
 * with itself. A path already waiting is not added twice.
 */
import type { VaultPath } from '../vault/vault-types.js';

type Item = { kind: 'path'; path: VaultPath } | { kind: 'task'; run: () => Promise<void> };

export class BackgroundQueue {
  private readonly items: Item[] = [];
  private readonly waiting = new Set<VaultPath>();
  private current: Promise<void> | null = null;
  private closed = false;
  private idleWaiters: (() => void)[] = [];

  constructor(
    private readonly processPath: (path: VaultPath) => Promise<void>,
    private readonly onError: (error: unknown) => void,
  ) {}

  addPath(path: VaultPath): void {
    if (this.closed || this.waiting.has(path)) return;
    this.waiting.add(path);
    this.items.push({ kind: 'path', path });
    this.pump();
  }

  addTask(run: () => Promise<void>): void {
    if (this.closed) return;
    this.items.push({ kind: 'task', run });
    this.pump();
  }

  /** Forgets a waiting path (deleted or renamed meanwhile). */
  drop(path: VaultPath): void {
    if (!this.waiting.delete(path)) return;
    const at = this.items.findIndex((item) => item.kind === 'path' && item.path === path);
    if (at !== -1) this.items.splice(at, 1);
  }

  /** Resolves when nothing is waiting or running (tests, shutdown). */
  idle(): Promise<void> {
    if (!this.current && this.items.length === 0) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  private pump(): void {
    if (this.current || this.closed) return;
    const item = this.items.shift();
    if (!item) {
      for (const resolve of this.idleWaiters.splice(0)) resolve();
      return;
    }
    if (item.kind === 'path') this.waiting.delete(item.path);
    const work = item.kind === 'path' ? this.processPath(item.path) : item.run();
    this.current = work.catch(this.onError).finally(() => {
      this.current = null;
      this.pump();
    });
  }

  async close(): Promise<void> {
    this.closed = true;
    this.items.splice(0);
    this.waiting.clear();
    await this.current;
    for (const resolve of this.idleWaiters.splice(0)) resolve();
  }
}
