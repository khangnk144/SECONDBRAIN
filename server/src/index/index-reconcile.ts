/**
 * Compares the vault listing with the index and plans the changes made while nobody watched
 * (app closed, watcher overflow). Size and mtime decide what to re-read; the revision then
 * decides what really changed. A note that vanished and a new note with the same revision are
 * treated as a rename, so the row (and the event history) follows the file.
 */
import {
  isVaultError,
  type NoteRead,
  type VaultPath,
  type VaultService,
} from '../vault/vault-types.js';
import type { StoredFileState } from './index-reader.js';
import { applyChanges, type ChangeSet, type MutationContext } from './index-mutations.js';
import { danglingLinkKeys } from './link-reresolve.js';
import { isIndexedAsNote } from './note-record.js';

/** Bounds memory: each chunk's files are read before its transaction. */
const CHUNK = 500;

async function readOrNull(vault: VaultService, path: VaultPath): Promise<NoteRead | null> {
  try {
    return await vault.read(path);
  } catch (error) {
    if (isVaultError(error) && error.code === 'NOT_FOUND') return null;
    throw error;
  }
}

export async function planReconcile(
  vault: VaultService,
  stored: readonly StoredFileState[],
): Promise<ChangeSet[]> {
  const listing = await vault.list();
  const known = new Map(stored.map((s) => [s.path, s]));
  const onDisk = new Set<VaultPath>();
  const written: VaultPath[] = [];
  const added: VaultPath[] = [];
  for (const file of listing.files) {
    onDisk.add(file.path);
    const state = known.get(file.path);
    if (!state) added.push(file.path);
    else if (state.size !== file.size || state.mtime !== Math.trunc(file.mtimeMs))
      written.push(file.path);
  }
  const removed = stored.filter((s) => !onDisk.has(s.path));

  const renamed: { from: VaultPath; to: VaultPath }[] = [];
  const preloaded = new Map<VaultPath, NoteRead>();
  const vanishedByRevision = new Map<string, VaultPath[]>();
  for (const s of removed) {
    if (s.revision === null) continue;
    vanishedByRevision.set(s.revision, [...(vanishedByRevision.get(s.revision) ?? []), s.path]);
  }
  const newFiles: VaultPath[] = [];
  for (const path of added) {
    if (vanishedByRevision.size === 0 || !isIndexedAsNote(path)) {
      newFiles.push(path);
      continue;
    }
    const read = await readOrNull(vault, path);
    if (!read) continue;
    preloaded.set(path, read);
    const candidates = vanishedByRevision.get(read.revision);
    // Only an unambiguous match is a rename; identical copies stay delete + create.
    if (candidates?.length === 1) {
      renamed.push({ from: candidates[0] as VaultPath, to: path });
      vanishedByRevision.delete(read.revision);
    } else {
      newFiles.push(path);
    }
  }
  const renamedFrom = new Set(renamed.map((r) => r.from));
  const first: ChangeSet = {
    removed: removed.map((s) => s.path).filter((p) => !renamedFrom.has(p)),
    renamed,
    preloaded,
    written: [],
  };
  const all = [...written, ...newFiles];
  const sets: ChangeSet[] = [first];
  for (let i = 0; i < all.length; i += CHUNK) {
    const part = all.slice(i, i + CHUNK);
    if (i === 0) first.written = part;
    else sets.push({ written: part, preloaded });
  }
  return sets.filter(
    (set) =>
      (set.removed?.length ?? 0) + (set.renamed?.length ?? 0) + (set.written?.length ?? 0) > 0,
  );
}

/**
 * Applies the reconcile plan, then repairs links that still point at a file the index does not
 * hold (normally none; left behind by an interrupted update or an older index). `context` returns
 * null once the service closed, which stops the work between steps.
 */
export async function reconcileIndex(
  vault: VaultService,
  stored: readonly StoredFileState[],
  context: () => MutationContext | null,
): Promise<void> {
  for (const set of await planReconcile(vault, stored)) {
    const ctx = context();
    if (!ctx) return;
    await applyChanges(ctx, set);
  }
  const ctx = context();
  const dangling = ctx ? danglingLinkKeys(ctx.db) : [];
  if (ctx && dangling.length > 0) await applyChanges(ctx, { reresolveKeys: dangling });
}
