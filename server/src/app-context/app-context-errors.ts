import { isVaultError } from '../vault/vault-types.js';

/** Short machine word for logs: a vault error code, a Node errno code, or the error name. */
export function errorCodeOf(error: unknown): string {
  if (isVaultError(error)) return error.code;
  const code = (error as NodeJS.ErrnoException | null)?.code;
  if (typeof code === 'string') return code;
  return error instanceof Error ? error.name : 'unknown';
}

/**
 * The configured vault folder cannot be opened (parent missing, not a folder, no permission…).
 * The server stops with a clear message instead of running without data.
 */
export class VaultUnusableError extends Error {
  constructor(
    readonly vaultRoot: string,
    cause: unknown,
  ) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    super(`The vault folder "${vaultRoot}" cannot be used: ${reason}`);
    this.name = 'VaultUnusableError';
  }
}
