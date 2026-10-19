import { lstat, mkdir, readdir, rmdir } from 'node:fs/promises';
import path from 'node:path';
import { renameWithRetry } from '../fs/atomic-write-file.js';
import type { VaultCore } from './vault-core.js';
import { moveVaultFile } from './vault-disk-io.js';
import { alreadyExists, asWriteFailed } from './vault-errors.js';
import { injectedErrnoError } from './vault-faults.js';
import type { VaultPath } from './vault-types.js';

/** What occupies a place: a real folder (symlinks are not followed), something else, or nothing. */
export type Presence = 'dir' | 'other' | null;

export async function presenceAt(abs: string): Promise<Presence> {
  try {
    return (await lstat(abs)).isDirectory() ? 'dir' : 'other';
  } catch {
    return null;
  }
}

const childPath = (vaultPath: VaultPath, name: string) => `${vaultPath}/${name.normalize('NFC')}`;

/**
 * Moves the content of `from` into `to` file by file (verified copy across volumes), never
 * replacing a file that is already there, then removes the emptied source folders. Resumable: a
 * second run carries on with whatever is still in `from`.
 */
async function mergeFolder(core: VaultCore, vaultPath: VaultPath, from: string, to: string) {
  try {
    await mkdir(to, { recursive: true });
    for (const entry of await readdir(from, { withFileTypes: true })) {
      const child = childPath(vaultPath, entry.name);
      const [a, b] = [path.join(from, entry.name), path.join(to, entry.name)];
      if (entry.isDirectory()) {
        await mergeFolder(core, child, a, b);
        continue;
      }
      if ((await presenceAt(b)) !== null) throw alreadyExists(child);
      await moveVaultFile(core, child, a, b);
    }
    // Only an empty folder can be removed this way: nothing inside is ever deleted.
    await rmdir(from);
  } catch (error) {
    throw asWriteFailed(error, vaultPath);
  }
}

/**
 * Moves a folder with everything in it: one rename on the same volume. Across volumes (`EXDEV`,
 * e.g. the trash on another drive) or into a destination that already holds part of the folder
 * (an interrupted cross-volume move), and only when `allowMerge`, it falls back to `mergeFolder`.
 */
export async function moveFolder(
  core: VaultCore,
  vaultPath: VaultPath,
  from: string,
  to: string,
  allowMerge: boolean,
): Promise<void> {
  if ((await presenceAt(to)) === null) {
    try {
      await mkdir(path.dirname(to), { recursive: true });
      const code = core.faults.failOperation?.('move', vaultPath);
      if (code) throw injectedErrnoError(code, 'move');
      await renameWithRetry(from, to);
      return;
    } catch (error) {
      if (!allowMerge || (error as NodeJS.ErrnoException).code !== 'EXDEV') {
        throw asWriteFailed(error, vaultPath);
      }
    }
  } else if (!allowMerge) {
    throw alreadyExists(vaultPath);
  }
  await mergeFolder(core, vaultPath, from, to);
}
