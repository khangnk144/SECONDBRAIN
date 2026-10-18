/**
 * Fetch wrapper for the local API. Every /api call carries the session token
 * in the X-SB-Token header; errors follow the server's {error:{code,message}} shape.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export interface ApiClientOptions {
  token: string | null;
  fetchImpl?: typeof fetch;
}

export interface ApiClient {
  request<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T>;
  get<T>(path: string): Promise<T>;
}

async function toApiError(response: Response): Promise<ApiError> {
  try {
    const body = (await response.json()) as { error?: { code?: string; message?: string } };
    const code = body.error?.code ?? 'HTTP_' + String(response.status);
    return new ApiError(response.status, code, body.error?.message ?? response.statusText);
  } catch {
    return new ApiError(response.status, 'HTTP_' + String(response.status), response.statusText);
  }
}

export function createApiClient({ token, fetchImpl }: ApiClientOptions): ApiClient {
  const doFetch = fetchImpl ?? ((input, init) => fetch(input, init));

  async function request<T>(path: string, init: { method?: string; body?: unknown } = {}) {
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
