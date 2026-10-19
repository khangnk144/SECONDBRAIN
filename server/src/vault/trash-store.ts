import { readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { errorCodeOf } from './housekeeping-tally.js';
import { isValidTrashMeta } from './journal-validation.js';
import { isUlid } from './ulid.js';
import { readStateJson, writeStateJson, type VaultCore } from './vault-core.js';
import type { TrashEntry, TrashMeta, VaultPath } from './vault-types.js';

/** Trash folder of an entry; ids that are not ULIDs never become a path. */
export function trashEntryDir(core: VaultCore, id: string): string {
  if (!isUlid(id)) throw new Error('Invalid trash id');
  return path.join(core.paths.trashDir, id);
}

/** Where a trashed file lives: `trash/<id>/files/<original vault path>`. */
export function trashFileAbs(core: VaultCore, id: string, vaultPath: VaultPath): string {
  return path.join(trashEntryDir(core, id), 'files', ...vaultPath.split('/'));
}

export async function writeTrashMeta(core: VaultCore, entry: TrashEntry): Promise<void> {
  const meta: TrashMeta = {
    opId: entry.opId,
    originalPaths: entry.originalPaths,
    reason: entry.reason,
    deletedAt: entry.deletedAt,
  };
  await writeStateJson(core.paths, path.join(trashEntryDir(core, entry.id), 'meta.json'), meta);
}

/** The entry, or null for unknown ids and meta.json files that are missing or not as we wrote them. */
export async function readTrashEntry(core: VaultCore, id: string): Promise<TrashEntry | null> {
  if (typeof id !== 'string' || !isUlid(id)) return null;
  const meta = await readStateJson(path.join(trashEntryDir(core, id), 'meta.json'));
  if (!isValidTrashMeta(meta)) return null;
  const { opId, originalPaths, reason, deletedAt } = meta;
  return { id, opId, originalPaths, reason, deletedAt };
}

/** Newest first; entries that cannot be read are left out. */
export async function listTrashEntries(core: VaultCore): Promise<TrashEntry[]> {
  let names: string[];
  try {
    names = await readdir(core.paths.trashDir);
  } catch {
    return [];
  }
  const entries: TrashEntry[] = [];
  for (const id of names.filter(isUlid).sort().reverse()) {
    try {
      const entry = await readTrashEntry(core, id);
      if (entry) entries.push(entry);
    } catch {
      // An unreadable meta.json hides only that entry.
    }
  }
  return entries;
}

async function containsFiles(dir: string): Promise<boolean> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) return true;
    if (await containsFiles(path.join(dir, entry.name))) return true;
  }
  return false;
}

/**
 * Drops a trash entry whose files have all been moved out (after a restore, or the undo of a
 * trash). If any file is still inside, the entry stays: trashed data is never deleted here. A
 * folder that cannot be removed is only reported; the operation itself already succeeded.
 */
export async function removeTrashEntryIfEmpty(core: VaultCore, id: string): Promise<boolean> {
  const dir = trashEntryDir(core, id);
  if (await containsFiles(path.join(dir, 'files'))) return false;
  try {
    await rm(dir, { recursive: true, force: true });
    return true;
  } catch (error) {
    core.warn(`Could not remove an emptied trash entry (${errorCodeOf(error)}).`, { trashId: id });
    return false;
  }
}
