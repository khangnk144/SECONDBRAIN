import type { VaultErrorCode } from '../vault/vault-types.js';

/** HTTP status for each vault error code (SPEC §9). */
export const VAULT_ERROR_STATUS: Readonly<Record<VaultErrorCode, number>> = {
  NOT_FOUND: 404,
  EXISTS: 409,
  CONFLICT: 409,
  INVALID_PATH: 400,
  VALIDATION: 400,
  FORBIDDEN: 403,
  WRITE_FAILED: 500,
};
