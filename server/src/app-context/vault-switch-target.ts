import { constants } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import { findVaultOverlap } from '../config/vault-location.js';
import { ApiError } from '../http/api-errors.js';

/** Why a folder cannot become the open vault (`details.reason` of 400 `VAULT_UNUSABLE`). */
export type VaultUnusableReason =
  | 'not-found'
  | 'not-a-directory'
  | 'not-writable'
  | 'overlaps-app'
  | 'overlaps-vault'
  | 'open-failed';

const MESSAGES: Record<VaultUnusableReason, string> = {
  'not-found': 'That folder does not exist.',
  'not-a-directory': 'That path is a file, not a folder.',
  'not-writable': 'The app cannot write in that folder.',
  'overlaps-app': "That folder is (or contains) the app's own folder; choose another one.",
  'overlaps-vault': 'That folder is inside (or contains) the open vault; choose one outside it.',
  'open-failed': 'That folder could not be opened as a vault; the previous vault is open again.',
};

export function vaultUnusable(reason: VaultUnusableReason): ApiError {
  return new ApiError(400, 'VAULT_UNUSABLE', MESSAGES[reason], { reason });
}

/**
 * Cheap checks before anything closes: the folder exists (the default `<home>/vault` may be
 * missing; opening creates it as at boot), is a folder, is writable, and is not the app or its
 * `.secondbrain` folder (nor inside or around them). An empty folder becomes a new vault.
 * It must not sit inside the open vault or contain it either: opening it would lay out a second
 * vault (`.secondbrain/`, standard folders, templates) among her notes, which the outer vault
 * then indexes, serves and commits as her own files. (The open vault itself is handled before.)
 */
export async function checkSwitchTarget(
  folder: string,
  options: { allowMissing: boolean; protectedDirs: readonly string[]; openVault: string },
): Promise<void> {
  if ((await findVaultOverlap(folder, options.protectedDirs)) !== null)
    throw vaultUnusable('overlaps-app');
  if ((await findVaultOverlap(folder, [options.openVault])) !== null)
    throw vaultUnusable('overlaps-vault');
  let isDirectory: boolean;
  try {
    isDirectory = (await stat(folder)).isDirectory();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' && options.allowMissing) return;
    throw vaultUnusable(code === 'EACCES' || code === 'EPERM' ? 'not-writable' : 'not-found');
  }
  if (!isDirectory) throw vaultUnusable('not-a-directory');
  try {
    await access(folder, constants.W_OK | constants.R_OK);
  } catch {
    throw vaultUnusable('not-writable');
  }
}
