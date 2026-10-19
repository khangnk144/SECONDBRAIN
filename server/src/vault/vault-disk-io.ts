import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import {
  atomicCreateFile,
  atomicWriteFile,
  renameWithRetry,
  type AtomicWriteHooks,
} from '../fs/atomic-write-file.js';
import { moveFile } from '../fs/move-file.js';
import type { VaultCore } from './vault-core.js';
import type { DiskLocation } from './vault-disk-names.js';
import { alreadyExists, asWriteFailed } from './vault-errors.js';
import { injectedErrnoError, SimulatedCrashError } from './vault-faults.js';
import type { VaultPath } from './vault-types.js';

/**
 * Creates the missing parent folders of `location` (and the location itself when `includeSelf`)
 * one by one, so each new folder can be reported; returns their vault paths, parents first.
 */
export async function ensureFolders(
  core: VaultCore,
  location: DiskLocation,
  includeSelf: boolean,
): Promise<VaultPath[]> {
  const created: VaultPath[] = [];
  const last = location.segments.length - (includeSelf ? 0 : 1);
  for (let depth = location.existingDepth; depth < last; depth += 1) {
    const segments = location.segments.slice(0, depth + 1);
    const folder = segments.join('/').normalize('NFC');
    try {
      await mkdir(path.join(core.root, ...segments));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue;
      throw asWriteFailed(error, folder);
    }
    created.push(folder);
  }
  for (const folder of created) core.emit({ kind: 'folder-created', path: folder, origin: 'app' });
  return created;
}

function writeHooks(core: VaultCore, vaultPath: VaultPath): AtomicWriteHooks {
  const { failOperation, crashBeforeRename } = core.faults;
  return {
    beforeWrite: () => {
      const code = failOperation?.('write', vaultPath);
      if (code) throw injectedErrnoError(code, 'write');
    },
    beforeRename: () => {
      if (crashBeforeRename?.(vaultPath)) throw new SimulatedCrashError('before rename');
    },
  };
}

/** Atomic replace of a vault file with the fault hooks wired in; disk refusals → WRITE_FAILED. */
export async function writeVaultFile(
  core: VaultCore,
  vaultPath: VaultPath,
  abs: string,
  content: Uint8Array,
): Promise<void> {
  try {
    await atomicWriteFile(abs, content, { hooks: writeHooks(core, vaultPath) });
  } catch (error) {
    throw asWriteFailed(error, vaultPath);
  }
}

/** Atomic creation that never replaces a file another program created meanwhile (→ EXISTS). */
export async function createVaultFile(
  core: VaultCore,
  vaultPath: VaultPath,
  abs: string,
  content: Uint8Array,
): Promise<void> {
  try {
    await atomicCreateFile(abs, content, { hooks: writeHooks(core, vaultPath) });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw alreadyExists(vaultPath);
    throw asWriteFailed(error, vaultPath);
  }
}

/** Moves one file (rename, or verified copy across volumes) with the fault hooks wired in. */
export async function moveVaultFile(
  core: VaultCore,
  vaultPath: VaultPath,
  from: string,
  to: string,
): Promise<void> {
  const { failOperation } = core.faults;
  try {
    await moveFile(from, to, {
      rename: async (a, b) => {
        const code = failOperation?.('move', vaultPath);
        if (code) throw injectedErrnoError(code, 'move');
        await renameWithRetry(a, b);
      },
      beforeCopy: () => {
        const code = failOperation?.('copy', vaultPath);
        if (code) throw injectedErrnoError(code, 'copy');
      },
    });
  } catch (error) {
    throw asWriteFailed(error, vaultPath);
  }
}
