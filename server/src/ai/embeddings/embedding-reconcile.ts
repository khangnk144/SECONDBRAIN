/**
 * Aligns the embedding store with the settings and the vault: a store made with another
 * provider, model or size is emptied for the new one (a full rebuild), rows of notes that left the
 * scope or the vault are deleted, and every in-scope note whose stored revision differs is queued.
 */
import { isNotePath } from '../../markdown/content-classes.js';
import type { VaultPath } from '../../vault/vault-types.js';
import type { EmbeddingConfig, EmbeddingStore } from './embedding-store.js';

export interface ReconcileResult {
  /** The store held vectors of another configuration (now dropped). */
  stale: boolean;
  /** The store was emptied (stale, new, or a requested rebuild). */
  reset: boolean;
}

export function sameConfig(a: EmbeddingConfig | null, b: EmbeddingConfig): boolean {
  return a !== null && a.provider === b.provider && a.model === b.model && a.dims === b.dims;
}

export function reconcileStore(
  store: EmbeddingStore,
  config: EmbeddingConfig,
  notes: readonly { path: VaultPath; revision: string }[],
  inScope: (path: VaultPath) => boolean,
  queue: Set<VaultPath>,
  force: boolean,
): ReconcileResult {
  const current = store.config();
  const matches = sameConfig(current, config);
  const reset = force || !matches;
  if (reset) store.reset(config);
  const stored = store.revisions();
  const wanted = new Set<VaultPath>();
  for (const note of notes) {
    if (!isNotePath(note.path) || !inScope(note.path)) continue;
    wanted.add(note.path);
    if (stored.get(note.path) !== note.revision) queue.add(note.path);
  }
  for (const path of stored.keys()) {
    if (wanted.has(path)) continue;
    store.removeNote(path);
    queue.delete(path);
  }
  return { stale: current !== null && !matches, reset };
}
