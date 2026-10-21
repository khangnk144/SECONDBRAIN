import { lstat, readdir } from 'node:fs/promises';
import path from 'node:path';
import { isAtomicTempName } from '../fs/atomic-write-file.js';

/** One file (or empty folder) of the vault as it goes into the zip. */
export interface BackupEntry {
  /** Vault-relative name with `/`, spelled exactly as on disk (NFC or NFD). */
  name: string;
  abs: string;
  kind: 'file' | 'dir';
  size: number;
  mtimeMs: number;
}

export interface BackupListing {
  entries: BackupEntry[];
  totalBytes: number;
  /** Folders or files that could not be read (permissions); they are not in the backup. */
  unreadable: number;
}

const fold = (name: string) => name.toLowerCase();

/**
 * What a backup leaves out (SPEC §4.13, F18.5): the derived cache, the logs, the vault's git
 * repository and atomic-write temp files. `vault.json`, `state/` and `trash/` are kept.
 */
function isExcluded(parentName: string, name: string, isDirectory: boolean): boolean {
  if (parentName === '' && isDirectory && fold(name) === '.git') return true;
  if (fold(parentName) === '.secondbrain' && isDirectory) {
    const folded = fold(name);
    if (folded === 'cache' || folded === 'logs') return true;
  }
  return !isDirectory && isAtomicTempName(name);
}

/**
 * Every regular file under the vault root (and every empty folder, so the tree comes back as it
 * was), sorted per folder. Symlinks and junctions are skipped, never followed: a backup never
 * contains anything outside the vault.
 */
export async function listBackupEntries(root: string): Promise<BackupListing> {
  const entries: BackupEntry[] = [];
  let totalBytes = 0;
  let unreadable = 0;

  async function walk(abs: string, name: string): Promise<boolean> {
    let children;
    try {
      children = await readdir(abs, { withFileTypes: true });
    } catch {
      unreadable += 1;
      return true; // not empty as far as we know: no folder entry for it
    }
    children.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    let added = false;
    for (const child of children) {
      if (child.isSymbolicLink()) continue;
      const childAbs = path.join(abs, child.name);
      const childName = name === '' ? child.name : `${name}/${child.name}`;
      if (isExcluded(name, child.name, child.isDirectory())) continue;
      if (child.isDirectory()) {
        // A second look without following links (Windows junctions are reparse points).
        const stats = await lstat(childAbs).catch(() => null);
        if (!stats?.isDirectory()) continue;
        if (!(await walk(childAbs, childName))) {
          entries.push({
            name: childName,
            abs: childAbs,
            kind: 'dir',
            size: 0,
            mtimeMs: stats.mtimeMs,
          });
        }
        added = true;
        continue;
      }
      if (!child.isFile()) continue;
      const stats = await lstat(childAbs).catch(() => null);
      if (!stats?.isFile()) {
        if (!stats) unreadable += 1;
        continue;
      }
      entries.push({
        name: childName,
        abs: childAbs,
        kind: 'file',
        size: stats.size,
        mtimeMs: stats.mtimeMs,
      });
      totalBytes += stats.size;
      added = true;
    }
    return added;
  }

  await walk(root, '');
  return { entries, totalBytes, unreadable };
}
