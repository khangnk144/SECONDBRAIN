/**
 * Fetch wrapper for the local API. Every /api call carries the session token in the X-SB-Token
 * header and, once known, the id of the vault this window shows (so a request queued behind a
 * vault switch is refused instead of landing in the other vault); errors follow the server's
 * {error:{code,message,details}} shape.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  /** Machine-readable extras (e.g. CONFLICT: `currentRevision`, `currentContent`). */
  readonly details: Record<string, unknown>;

  constructor(status: number, code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details ?? {};
  }
}

/** Request header naming the vault this window shows (the server refuses a stale one). */
export const VAULT_ID_HEADER = 'X-SB-Vault-Id';

export interface ApiClientOptions {
  token: string | null;
  fetchImpl?: typeof fetch;
  /** The vault this window shows, sent on every request once known. */
  vaultId?: () => string | null;
  /**
   * Called when the server answers 409 `vault-switched`: another vault is open now, so nothing
   * more of this window's state may reach the server (the page reloads into the new vault).
   */
  onVaultSwitched?: (vaultId: string | null) => void;
}

export interface ApiRequestInit {
  method?: string;
  body?: unknown;
  /** Aborts the request (e.g. "Hủy" on an AI action; the server then stops the provider call). */
  signal?: AbortSignal;
}

/** A request whose body and answer are not JSON (multipart upload, file download). */
export interface ApiRawInit {
  method?: string;
  body?: BodyInit;
  signal?: AbortSignal;
}

export interface ApiClient {
  request<T>(path: string, init?: ApiRequestInit): Promise<T>;
  get<T>(path: string): Promise<T>;
  /** Same headers and error handling as `request`; resolves with the successful response. */
  raw(path: string, init?: ApiRawInit): Promise<Response>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

async function toApiError(response: Response): Promise<ApiError> {
  const fallbackCode = 'HTTP_' + String(response.status);
  try {
    const body = (await response.json()) as {
      error?: { code?: string; message?: string; details?: unknown };
    };
    const details = isRecord(body.error?.details) ? body.error.details : undefined;
    return new ApiError(
      response.status,
      body.error?.code ?? fallbackCode,
      body.error?.message ?? response.statusText,
      details,
    );
  } catch {
    return new ApiError(response.status, fallbackCode, response.statusText);
  }
}

/** True for the 409 the server sends once the vault this window shows is no longer open. */
export function isVaultSwitchedError(error: unknown): error is ApiError {
  return isApiError(error, 'CONFLICT') && error.details.reason === 'vault-switched';
}

function apiUrl(path: string): string {
  return path.startsWith('/api/') ? path : '/api' + (path.startsWith('/') ? path : '/' + path);
}

export function createApiClient({
  token,
  fetchImpl,
  vaultId,
  onVaultSwitched,
}: ApiClientOptions): ApiClient {
  const doFetch = fetchImpl ?? ((input, init) => fetch(input, init));

  function baseHeaders(): Record<string, string> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (token) headers['X-SB-Token'] = token;
    const id = vaultId?.();
    if (id) headers[VAULT_ID_HEADER] = id;
    return headers;
  }

  async function send(path: string, init: RequestInit): Promise<Response> {
    const response = await doFetch(apiUrl(path), { ...init, credentials: 'same-origin' });
    if (response.ok) return response;
    const error = await toApiError(response);
    if (isVaultSwitchedError(error)) {
      const next = error.details.vaultId;
      onVaultSwitched?.(typeof next === 'string' ? next : null);
    }
    throw error;
  }

  async function request<T>(path: string, init: ApiRequestInit = {}) {
    const headers = baseHeaders();
    let body: string | undefined;
    if (init.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(init.body);
    }
    const response = await send(path, {
      method: init.method ?? 'GET',
      headers,
      body,
      signal: init.signal,
    });
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  return {
    request,
    get: <T>(path: string) => request<T>(path),
    // The browser sets the multipart boundary itself, so no Content-Type here.
    raw: (path, init = {}) =>
      send(path, {
        method: init.method ?? 'GET',
        headers: baseHeaders(),
        body: init.body,
        signal: init.signal,
      }),
  };
}

/** What a 409 CONFLICT on a note carries: `currentRevision` null = the file no longer exists. */
export interface NoteConflictDetails {
  currentRevision: string | null;
  currentContent?: string;
}

export function isApiError(error: unknown, code?: string): error is ApiError {
  return error instanceof ApiError && (code === undefined || error.code === code);
}

/** The disk state reported by a note CONFLICT, or null when the error is something else. */
export function noteConflictDetails(error: unknown): NoteConflictDetails | null {
  if (!isApiError(error, 'CONFLICT')) return null;
  const { currentRevision, currentContent } = error.details;
  if (currentRevision !== null && typeof currentRevision !== 'string') return null;
  return typeof currentContent === 'string'
    ? { currentRevision, currentContent }
    : { currentRevision };
}

/**
 * Number of files that blocked an undo/complete of a journal entry (they changed since the
 * operation), or null when the error is not a journal conflict.
 */
export function journalConflictCount(error: unknown): number | null {
  if (!isApiError(error, 'CONFLICT')) return null;
  const conflicts = error.details.conflicts;
  return Array.isArray(conflicts) ? conflicts.length : null;
}

/**
 * Paths of the files that blocked an undo/complete (in the server's order), or null when the error
 * is not a journal conflict. Entries without a path are skipped.
 */
export function journalConflictPaths(error: unknown): string[] | null {
  if (!isApiError(error, 'CONFLICT')) return null;
  const conflicts = error.details.conflicts;
  if (!Array.isArray(conflicts)) return null;
  return conflicts
    .map((c: unknown) => (c && typeof c === 'object' ? (c as { path?: unknown }).path : undefined))
    .filter((p): p is string => typeof p === 'string');
}
