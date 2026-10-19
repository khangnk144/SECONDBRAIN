/**
 * Changes that arrive while a rebuild is pending wait in the queue and are applied to the NEW
 * database. That database may already contain them (the rebuild read the file after the edit),
 * so their event-log diff must start from what the OLD index knew. Just before the swap, this
 * keeps old snapshots of every path those changes touch – and of every note whose links they can
 * re-resolve – and hands each out once. Leftovers are dropped when the last waiting change ran.
 */
import type Database from 'better-sqlite3';
import type { VaultPath } from '../vault/vault-types.js';
import { takeSnapshot, type NoteSnapshot } from './index-events.js';
import { notesLinkingByKeys } from './link-reresolve.js';
import { pathTargetKey } from './link-targets.js';

export class DeferredSnapshots {
  private readonly paths = new Set<VaultPath>();
  private readonly snapshots = new Map<VaultPath, NoteSnapshot | null>();
  private waiting = 0;

  /**
   * A change to `paths` (both names for a rename) was queued behind a rebuild. Call `done()`
   * once it has been applied.
   */
  remember(paths: readonly VaultPath[]): void {
    for (const p of paths) this.paths.add(p);
    this.waiting += 1;
  }

  done(): void {
    this.waiting = Math.max(0, this.waiting - 1);
    if (this.waiting === 0) {
      this.paths.clear();
      this.snapshots.clear();
    }
  }

  /** Called with the old database right before the swap (or with null when there was none). */
  capture(oldDb: Database.Database | null): void {
    if (oldDb && this.paths.size > 0) {
      const linking = notesLinkingByKeys(oldDb, [...this.paths].map(pathTargetKey));
      for (const p of [...this.paths, ...linking])
        if (!this.snapshots.has(p)) this.snapshots.set(p, takeSnapshot(oldDb, p));
    }
    this.paths.clear();
  }

  /** The captured before-state, or undefined when there is none (use the live database). */
  take(path: VaultPath): NoteSnapshot | null | undefined {
    if (!this.snapshots.has(path)) return undefined;
    const snapshot = this.snapshots.get(path) ?? null;
    this.snapshots.delete(path);
    return snapshot;
  }
}
