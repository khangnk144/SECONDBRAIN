/**
 * `POST /api/vault/switch` (SPEC F18.3): mirrored from `server/src/api/vault-switch-routes.ts`.
 * On failure the previous vault is open again and the error says why in `details.reason`.
 */
import { api } from '../api';
import { isApiError } from '../api-client';

export interface VaultSwitchResult {
  vaultId: string;
  path: string;
}

/** `null` opens the default `<home>/vault`. */
export function switchVault(path: string | null): Promise<VaultSwitchResult> {
  return api().request<VaultSwitchResult>('/vault/switch', { method: 'POST', body: { path } });
}

/**
 * Why a folder could not be opened (`VAULT_UNUSABLE` and `VALIDATION` reasons of the switch and
 * the restore), or null for any other error.
 */
export function vaultRefusalReason(error: unknown): string | null {
  if (!isApiError(error, 'VAULT_UNUSABLE') && !isApiError(error, 'VALIDATION')) {
    if (isApiError(error, 'CONFLICT') && error.details.reason === 'switch-in-progress') {
      return 'switch-in-progress';
    }
    return null;
  }
  const reason = error.details.reason;
  return typeof reason === 'string' ? reason : null;
}
