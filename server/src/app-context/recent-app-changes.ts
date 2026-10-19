import type { VaultChange, VaultPath } from '../vault/vault-types.js';

/** Long enough for the watcher (≈ 0.3 s) to see an app write even on a busy machine. */
const DEFAULT_TTL_MS = 5000;

/** A path written twice in quick succession keeps both states (the first echo is still due). */
const MAX_STATES_PER_PATH = 8;

/**
 * Remembers what the app itself just did to the vault, so the watcher's later report of the
 * same change (its "echo") is recognised and does not produce a second WS event. Each path keeps
 * its recent expected states: a revision, or null for "gone". Keys ignore case and Unicode form
 * because the watcher reports on-disk names, which may differ in both on Windows/macOS.
 */
export class RecentAppChanges {
  private readonly files = new Map<string, { revision: string | null; at: number }[]>();
  private readonly folders = new Map<string, number>();

  constructor(
    private readonly ttlMs = DEFAULT_TTL_MS,
    private readonly clock: () => number = Date.now,
  ) {}

  record(change: VaultChange): void {
    const at = this.clock();
    const expect = (path: VaultPath, revision: string | null) => {
      const states = this.files.get(key(path)) ?? [];
      states.push({ revision, at });
      this.files.set(key(path), states.slice(-MAX_STATES_PER_PATH));
    };
    switch (change.kind) {
      case 'created':
      case 'written':
        expect(change.path, change.revision);
        break;
      case 'deleted':
        expect(change.path, null);
        break;
      case 'renamed':
        expect(change.oldPath, null);
        expect(change.path, change.revision);
        break;
      case 'folder-created':
      case 'folder-deleted':
        this.folders.set(`${change.kind}:${key(change.path)}`, at);
        break;
    }
  }

  /** True when a watcher-reported change only repeats what the app did moments ago. */
  isEcho(change: VaultChange): boolean {
    this.prune();
    const matches = (path: VaultPath, revision: string | null) =>
      this.files.get(key(path))?.some((state) => state.revision === revision) ?? false;
    switch (change.kind) {
      case 'created':
      case 'written':
        return matches(change.path, change.revision);
      case 'deleted':
        return matches(change.path, null);
      case 'renamed':
        return matches(change.oldPath, null) && matches(change.path, change.revision);
      case 'folder-created':
      case 'folder-deleted':
        return this.folders.has(`${change.kind}:${key(change.path)}`);
    }
  }

  private prune(): void {
    const cutoff = this.clock() - this.ttlMs;
    for (const [path, states] of this.files) {
      const fresh = states.filter((state) => state.at >= cutoff);
      if (fresh.length === 0) this.files.delete(path);
      else this.files.set(path, fresh);
    }
    for (const [path, at] of this.folders) if (at < cutoff) this.folders.delete(path);
  }
}

function key(path: VaultPath): string {
  return path.normalize('NFC').toLowerCase();
}
