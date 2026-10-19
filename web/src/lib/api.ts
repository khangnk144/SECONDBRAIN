import { createApiClient, type ApiClient } from './api-client';

/** Shared API client for the app; the token is set once from the boot config. */
let client: ApiClient = createApiClient({ token: null });
let currentToken: string | null = null;

export function setApiToken(token: string | null): void {
  currentToken = token;
  client = createApiClient({ token });
}

/** The session token (also needed for `/ws?token=`). */
export function getApiToken(): string | null {
  return currentToken;
}

export function api(): ApiClient {
  return client;
}
