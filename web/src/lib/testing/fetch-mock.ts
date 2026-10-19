/**
 * Test helper: replaces `fetch` at the `api()` boundary with a small route table. Every call is
 * recorded with its parsed JSON body; unmatched requests answer 404 NOT_FOUND.
 */
import { vi } from 'vitest';

export interface RecordedCall {
  method: string;
  /** Path and query as sent, e.g. `/api/note?path=0%20Inbox%2Fa.md`. */
  url: string;
  /** Path without the query. */
  path: string;
  query: URLSearchParams;
  body: unknown;
}

export interface MockReply {
  status?: number;
  body?: unknown;
}

export type MockHandler = (call: RecordedCall) => MockReply | Promise<MockReply>;

export interface FetchMock {
  calls: RecordedCall[];
  /** `'POST /api/note/rename'` → handler (later registrations win). */
  on: (route: string, handler: MockHandler | MockReply) => void;
  callsTo: (route: string) => RecordedCall[];
}

export function apiError(
  status: number,
  code: string,
  details?: Record<string, unknown>,
): MockReply {
  return { status, body: { error: { code, message: code, details } } };
}

export function installFetchMock(): FetchMock {
  const routes = new Map<string, MockHandler>();
  const calls: RecordedCall[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const [path = '', search = ''] = url.split('?');
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
    const call: RecordedCall = { method, url, path, query: new URLSearchParams(search), body };
    calls.push(call);
    const handler = routes.get(`${method} ${path}`);
    const reply = handler ? await handler(call) : apiError(404, 'NOT_FOUND');
    const status = reply.status ?? 200;
    if (status === 204) return new Response(null, { status });
    return new Response(JSON.stringify(reply.body ?? {}), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fetchImpl);
  return {
    calls,
    on: (route, handler) =>
      routes.set(route, typeof handler === 'function' ? handler : () => handler),
    callsTo: (route) => calls.filter((call) => `${call.method} ${call.path}` === route),
  };
}
