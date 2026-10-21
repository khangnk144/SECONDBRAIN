import { createApiClient, VAULT_ID_HEADER, type ApiClient } from './api-client';

/**
 * Shared API client for the app; the token is set once from the boot config, the vault id once
 * `GET /api/health` named it.
 */
let currentToken: string | null = null;
let currentVaultId: string | null = null;
let vaultSwitchedHandler: ((vaultId: string | null) => void) | null = null;

function build(token: string | null): ApiClient {
  return createApiClient({
    token,
    vaultId: () => currentVaultId,
    onVaultSwitched: (vaultId) => vaultSwitchedHandler?.(vaultId),
  });
}

let client: ApiClient = build(null);

export function setApiToken(token: string | null): void {
  currentToken = token;
  client = build(token);
}

/** The session token (also needed for `/ws?token=`). */
export function getApiToken(): string | null {
  return currentToken;
}

/** The vault this window shows; every request names it (`x-sb-vault-id`) once set. */
export function setApiVaultId(vaultId: string | null): void {
  currentVaultId = vaultId;
}

/** What happens when the server says another vault is open now (the app reloads). */
export function setVaultSwitchedHandler(handler: ((vaultId: string | null) => void) | null): void {
  vaultSwitchedHandler = handler;
}

/** Headers for a request made without the client (token and vault id). */
export function apiAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  if (currentToken) headers['X-SB-Token'] = currentToken;
  if (currentVaultId) headers[VAULT_ID_HEADER] = currentVaultId;
  return headers;
}

export function api(): ApiClient {
  return client;
}
