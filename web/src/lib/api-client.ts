/**
 * Fetch wrapper for the local API. Every /api call carries the session token
 * in the X-SB-Token header; errors follow the server's {error:{code,message,details}} shape.
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

export interface ApiClientOptions {
  token: string | null;
  fetchImpl?: typeof fetch;
}

export interface ApiRequestInit {
  method?: string;
  body?: unknown;
}

export interface ApiClient {
  request<T>(path: string, init?: ApiRequestInit): Promise<T>;
  get<T>(path: string): Promise<T>;
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

export function createApiClient({ token, fetchImpl }: ApiClientOptions): ApiClient {
  const doFetch = fetchImpl ?? ((input, init) => fetch(input, init));

  async function request<T>(path: string, init: ApiRequestInit = {}) {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (token) headers['X-SB-Token'] = token;
    let body: string | undefined;
    if (init.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(init.body);
    }
    const url = path.startsWith('/api/')
      ? path
      : '/api' + (path.startsWith('/') ? path : '/' + path);
    const response = await doFetch(url, {
      method: init.method ?? 'GET',
      headers,
      body,
      credentials: 'same-origin',
    });
    if (!response.ok) throw await toApiError(response);
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  return {
    request,
    get: <T>(path: string) => request<T>(path),
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
