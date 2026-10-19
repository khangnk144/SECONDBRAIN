import { describe, expect, it, vi } from 'vitest';
import { ApiError, createApiClient, journalConflictCount, noteConflictDetails } from './api-client';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('createApiClient', () => {
  it('sends the session token header on every request', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { ok: true }));
    const client = createApiClient({ token: 'secret-token', fetchImpl });

    await expect(client.get('/settings')).resolves.toEqual({ ok: true });

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/settings');
    expect((init.headers as Record<string, string>)['X-SB-Token']).toBe('secret-token');
  });

  it('serializes JSON bodies', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, {}));
    const client = createApiClient({ token: 't', fetchImpl });
    await client.request('/api/capture', { method: 'POST', body: { text: 'Đồ án' } });
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ text: 'Đồ án' }));
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  it('turns the server error shape into an ApiError', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(409, { error: { code: 'CONFLICT', message: 'changed on disk' } }),
    );
    const client = createApiClient({ token: 't', fetchImpl });
    const error = await client.get('/note').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 409, code: 'CONFLICT', message: 'changed on disk' });
  });

  it('omits the header when there is no token', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, {}));
    await createApiClient({ token: null, fetchImpl }).get('/health');
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)['X-SB-Token']).toBeUndefined();
  });

  it('keeps the error details (CONFLICT carries the disk revision and content)', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(409, {
        error: {
          code: 'CONFLICT',
          message: 'changed',
          details: { path: 'a.md', currentRevision: 'abc', currentContent: 'Đĩa' },
        },
      }),
    );
    const error = await createApiClient({ token: 't', fetchImpl })
      .get('/note')
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).details).toMatchObject({ currentRevision: 'abc' });
    expect(noteConflictDetails(error)).toEqual({ currentRevision: 'abc', currentContent: 'Đĩa' });
  });

  it('reads a deleted-on-disk conflict and journal conflicts', () => {
    const deleted = new ApiError(409, 'CONFLICT', 'gone', { currentRevision: null });
    expect(noteConflictDetails(deleted)).toEqual({ currentRevision: null });
    const journal = new ApiError(409, 'CONFLICT', 'x', {
      journalId: 'j',
      conflicts: [{ path: 'a.md' }, { path: 'b.md' }],
    });
    expect(journalConflictCount(journal)).toBe(2);
    expect(journalConflictCount(new ApiError(404, 'NOT_FOUND', 'x'))).toBeNull();
    expect(noteConflictDetails(new Error('x'))).toBeNull();
  });
});
