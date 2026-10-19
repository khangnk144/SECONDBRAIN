import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { expect } from 'vitest';
import { openVault } from '../../../src/vault/open-vault.js';
import type { VaultFaults } from '../../../src/vault/vault-faults.js';
import {
  isVaultError,
  type VaultChange,
  type VaultErrorCode,
  type VaultService,
} from '../../../src/vault/vault-types.js';
import { makeTempDir, removeDir } from '../../helpers/test-environment.js';

export interface TempVault {
  /** Temp folder holding the vault (and anything a test puts "outside" it). */
  base: string;
  /** Vault root as given to openVault (a child of `base`, with spaces and Vietnamese letters). */
  root: string;
  vault: VaultService;
  changes: VaultChange[];
  reopen: (faults?: VaultFaults) => Promise<VaultService>;
  cleanup: () => Promise<void>;
}

export async function openTempVault(
  options: { faults?: VaultFaults; now?: () => Date; label?: string } = {},
): Promise<TempVault> {
  const base = makeTempDir(options.label ?? 'sb vault Ghi chú');
  const root = path.join(base, 'Kho ghi chú của tôi');
  const changes: VaultChange[] = [];
  const handle: TempVault = {
    base,
    root,
    changes,
    vault: undefined as unknown as VaultService,
    reopen: async (faults) => {
      await handle.vault.close();
      handle.vault = (await openVault({ root, now: options.now, faults })).vault;
      handle.vault.onChange((change) => changes.push(change));
      return handle.vault;
    },
    cleanup: async () => {
      await handle.vault.close();
      removeDir(base);
    },
  };
  handle.vault = (await openVault({ root, now: options.now, faults: options.faults })).vault;
  handle.vault.onChange((change) => changes.push(change));
  return handle;
}

/** Every entry under `dir`, relative, forward slashes; folders end with `/`. */
export function listTree(dir: string, prefix = ''): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = `${prefix}${entry.name}`;
    if (entry.isDirectory())
      out.push(`${rel}/`, ...listTree(path.join(dir, entry.name), `${rel}/`));
    else out.push(rel);
  }
  return out.sort();
}

export const sha256 = (data: string | Uint8Array) =>
  createHash('sha256').update(data).digest('hex');

export function readDisk(root: string, vaultPath: string): string {
  return readFileSync(path.join(root, ...vaultPath.split('/')), 'utf8');
}

/** Awaits a rejection and checks it is a VaultError with that code; returns its details. */
export async function expectVaultError(
  promise: Promise<unknown>,
  code: VaultErrorCode,
): Promise<Record<string, unknown>> {
  try {
    await promise;
  } catch (error) {
    if (!isVaultError(error)) throw error;
    expect(error.code).toBe(code);
    return error.details ?? {};
  }
  throw new Error(`expected VaultError ${code}, but the call succeeded`);
}
