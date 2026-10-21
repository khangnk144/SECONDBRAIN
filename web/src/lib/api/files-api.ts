/**
 * Vault files as bytes (`GET /api/files`) and "open with another app"
 * (`POST /api/files/open-external`). The shared API client only speaks JSON, so the byte fetch
 * builds its own request; it carries the session token in the header like every other call (the
 * token never goes into a URL). Errors are `ApiError`s; a network failure rejects with the
 * browser's `TypeError`.
 */
import { ApiError } from '../api-client';
import { api, getApiToken } from '../api';
import { withQuery } from './query-string';
import type { VaultPath } from './vault-types';

export interface VaultFileFetchOptions {
  /** `download=1`: the server answers `content-disposition: attachment` for every type. */
  download?: boolean;
  signal?: AbortSignal;
}

export function filesUrl(path: VaultPath, options: { download?: boolean } = {}): string {
  return withQuery('/api/files', { path, download: options.download ? 1 : undefined });
}

async function errorOf(response: Response): Promise<ApiError> {
  const fallback = 'HTTP_' + String(response.status);
  try {
    const body = (await response.json()) as {
      error?: { code?: string; message?: string; details?: unknown };
    };
    const details = body.error?.details;
    return new ApiError(
      response.status,
      body.error?.code ?? fallback,
      body.error?.message ?? response.statusText,
      details && typeof details === 'object' && !Array.isArray(details)
        ? (details as Record<string, unknown>)
        : undefined,
    );
  } catch {
    return new ApiError(response.status, fallback, response.statusText);
  }
}

async function fetchFile(path: VaultPath, options: VaultFileFetchOptions): Promise<Response> {
  const headers: Record<string, string> = {};
  const token = getApiToken();
  if (token) headers['X-SB-Token'] = token;
  const response = await fetch(filesUrl(path, options), {
    headers,
    credentials: 'same-origin',
    signal: options.signal,
  });
  if (!response.ok) throw await errorOf(response);
  return response;
}

/** The file as a Blob (downloads). */
export async function fetchVaultFileBlob(
  path: VaultPath,
  options: VaultFileFetchOptions = {},
): Promise<Blob> {
  return (await fetchFile(path, options)).blob();
}

/** The file's bytes (the PDF viewer hands them to pdf.js). */
export async function fetchVaultFileBytes(
  path: VaultPath,
  options: VaultFileFetchOptions = {},
): Promise<ArrayBuffer> {
  return (await fetchFile(path, options)).arrayBuffer();
}

/**
 * Opens the file with the computer's default app. 400 `VALIDATION` with `reason` `not-a-file` or
 * `executable` (programs and scripts are never started from the app), 404 when it is gone.
 */
export function openFileWithOtherApp(path: VaultPath): Promise<void> {
  return api().request<void>('/files/open-external', { method: 'POST', body: { path } });
}
