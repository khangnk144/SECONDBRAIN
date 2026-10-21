import { describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  createApiClient,
  isVaultSwitchedError,
  journalConflictCount,
  noteConflictDetails,
} from './api-client';

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

  it('names the vault this window shows once it is known', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, {}));
    let vaultId: string | null = null;
    const client = createApiClient({ token: 't', fetchImpl, vaultId: () => vaultId });
    await client.get('/tree');
    vaultId = 'vault-ả';
    await client.request('/note', { method: 'PUT', body: {} });
    const headers = fetchImpl.mock.calls.map(
      (call) => (call as unknown as [string, RequestInit])[1].headers as Record<string, string>,
    );
    expect(headers[0]?.['X-SB-Vault-Id']).toBeUndefined();
    expect(headers[1]?.['X-SB-Vault-Id']).toBe('vault-ả');
  });

  it('a 409 vault-switched tells the app (it reloads) and still rejects the call', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(409, {
        error: {
          code: 'CONFLICT',
          message: 'x',
          details: { reason: 'vault-switched', vaultId: 'b' },
        },
      }),
    );
    const onVaultSwitched = vi.fn();
    const client = createApiClient({ token: 't', fetchImpl, vaultId: () => 'a', onVaultSwitched });
    const error = await client.request('/note', { method: 'PUT', body: {} }).catch((e) => e);
    expect(isVaultSwitchedError(error)).toBe(true);
    expect(onVaultSwitched).toHaveBeenCalledWith('b');
    // A note conflict is something else: no reload for it.
    const plain = vi.fn(async () =>
      jsonResponse(409, {
        error: { code: 'CONFLICT', message: 'x', details: { currentRevision: 'r' } },
      }),
    );
    await createApiClient({ token: 't', fetchImpl: plain, onVaultSwitched })
      .get('/note')
      .catch(() => undefined);
    expect(onVaultSwitched).toHaveBeenCalledTimes(1);
  });

  it('raw requests carry the same headers but leave the body type to the browser', async () => {
    const fetchImpl = vi.fn(async () => new Response('zip', { status: 200 }));
    const client = createApiClient({ token: 't', fetchImpl, vaultId: () => 'v' });
    const form = new FormData();
    form.append('target', 'D:\\Khôi phục');
    const response = await client.raw('/backup/restore', { method: 'POST', body: form });
    expect(await response.text()).toBe('zip');
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/backup/restore');
    expect(init.body).toBe(form);
    const headers = init.headers as Record<string, string>;
    expect(headers['X-SB-Token']).toBe('t');
    expect(headers['X-SB-Vault-Id']).toBe('v');
    expect(headers['Content-Type']).toBeUndefined();
    const failing = vi.fn(async () =>
      jsonResponse(400, {
        error: { code: 'VALIDATION', message: 'x', details: { reason: 'too-large' } },
      }),
    );
    const error = await createApiClient({ token: 't', fetchImpl: failing })
      .raw('/backup/export', { method: 'POST' })
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'VALIDATION', details: { reason: 'too-large' } });
  });
});
