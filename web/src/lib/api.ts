import { createApiClient, type ApiClient } from './api-client';

/** Shared API client for the app; the token is set once from the boot config. */
let client: ApiClient = createApiClient({ token: null });

export function setApiToken(token: string | null): void {
  client = createApiClient({ token });
}

export function api(): ApiClient {
  return client;
}
