/**
 * Path → content hash memory of the sources cache (`index.json`), so status checks never re-read
 * a file whose size and mtime did not change. Writes are queued one after the other.
 */
import type { FileStat, VaultPath } from '../vault/vault-types.js';
import { writePathIndex, type PathIndexEntry } from './source-cache.js';

export class SourcePathIndex {
  private persisting: Promise<void> = Promise.resolve();
  /** Hashes learned by status checks, saved with the next write. */
  private unsaved = false;

  constructor(
    private readonly dir: string,
    readonly entries: Map<VaultPath, PathIndexEntry>,
    private readonly onPersistError: (error: unknown) => void,
  ) {}

  /** The hash recorded for this exact size and mtime, if any (no file read). */
  knownHash(stat: FileStat): string | null {
    const entry = this.entries.get(stat.path);
    return entry && entry.size === stat.size && entry.mtimeMs === stat.mtimeMs
      ? entry.contentHash
      : null;
  }

  /** Kept in memory only (a status check must not write); saved with the next `record`. */
  learn(stat: FileStat, contentHash: string): void {
    this.entries.set(stat.path, { size: stat.size, mtimeMs: stat.mtimeMs, contentHash });
    this.unsaved = true;
  }

  /** Records a hash and saves; `force` saves even without a change (the folder may be gone). */
  record(stat: FileStat, contentHash: string, force: boolean): void {
    const before = this.entries.get(stat.path);
    const same =
      before?.contentHash === contentHash &&
      before.size === stat.size &&
      before.mtimeMs === stat.mtimeMs;
    if (same && !this.unsaved && !force) return;
    this.entries.set(stat.path, { size: stat.size, mtimeMs: stat.mtimeMs, contentHash });
    this.persist();
  }

  /** A renamed file keeps its known hash (same bytes). */
  move(from: VaultPath, to: VaultPath): void {
    const entry = this.entries.get(from);
    if (!entry) return;
    this.entries.delete(from);
    this.entries.set(to, entry);
    this.persist();
  }

  forget(paths: readonly VaultPath[]): void {
    let changed = false;
    for (const path of paths) changed = this.entries.delete(path) || changed;
    if (changed) this.persist();
  }

  hashes(): Set<string> {
    return new Set([...this.entries.values()].map((entry) => entry.contentHash));
  }

  persist(): void {
    this.unsaved = false;
    this.persisting = this.persisting
      .then(() => writePathIndex(this.dir, this.entries))
      .catch(this.onPersistError);
  }

  /** Resolves once every write queued so far is done. */
  flushed(): Promise<void> {
    return this.persisting;
  }
}
