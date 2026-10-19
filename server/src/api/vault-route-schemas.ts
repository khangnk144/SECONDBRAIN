import { isNotePath } from '../markdown/content-classes.js';
import { guardVaultPath } from '../security/path-guard.js';
import { VaultError, type VaultPath } from '../vault/vault-types.js';

/**
 * JSON-schema fragments shared by the vault routes. Paths are only length-checked here: the
 * path guard decides what is valid, so a bad path always answers `INVALID_PATH`, never a
 * generic schema error.
 */
export const vaultPathSchema = { type: 'string', maxLength: 4096 } as const;
export const revisionSchema = { type: 'string', pattern: '^[0-9a-f]{64}$' } as const;
export const journalIdParams = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string', pattern: '^[0-9A-Za-z]{10,40}$' } },
} as const;

export const pathQuerySchema = {
  type: 'object',
  required: ['path'],
  properties: { path: vaultPathSchema },
} as const;

export interface PathQuery {
  path: string;
}

/** Guards a path from a request and requires a Markdown note (`.md`). */
export function guardNotePath(input: string): VaultPath {
  const path = guardVaultPath(input);
  if (!isNotePath(path)) {
    throw new VaultError('VALIDATION', 'Only Markdown notes (.md) can be used here.', { path });
  }
  return path;
}
