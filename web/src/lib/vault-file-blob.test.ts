import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installObjectUrls, type FakeObjectUrls } from '../editor/attachments/attachment-test-kit';
import { setApiToken } from './api';
import { apiError, installFetchMock, type FetchMock } from './testing/fetch-mock';
import { resetAppState } from './testing/reset-app-state';
import {
  resetVaultFileBlobs,
  VAULT_FILE_BLOB_IDLE_MS,
  vaultFileUrl,
  watchVaultFileBlob,
  type VaultFileBlob,
} from './vault-file-blob';
import { useVaultStore } from './vault-store';
import { emitServerEvent } from './ws/server-event-bus';

const PNG = 'Attachments/2026-10/sơ đồ bài 3.png';

async function flush(): Promise<void> {
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('vault file blobs (F15.2)', () => {
  let mock: FetchMock;
  let urls: FakeObjectUrls;

  beforeEach(async () => {
    await resetAppState();
    resetVaultFileBlobs();
    setApiToken('token-123');
    mock = installFetchMock();
    mock.on('GET /api/files', { body: { png: true } });
    urls = installObjectUrls();
  });
  afterEach(() => {
    resetVaultFileBlobs();
    setApiToken(null);
    urls.restore();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('fetches the file with the token header and hands out an object URL', async () => {
    const seen: VaultFileBlob[] = [];
    watchVaultFileBlob(PNG, (blob) => seen.push(blob));
    await flush();
    expect(seen).toEqual([{ status: 'loading' }, { status: 'ready', url: 'blob:test/1' }]);
    const [input, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(input)).toBe(vaultFileUrl(PNG));
    expect(String(input)).toBe(
      '/api/files?path=Attachments%2F2026-10%2Fs%C6%A1%20%C4%91%E1%BB%93%20b%C3%A0i%203.png',
    );
    expect((init?.headers as Record<string, string>)['X-SB-Token']).toBe('token-123');
  });

  it('shares one fetch between watchers and keeps the URL a while after the last one leaves', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const a = vi.fn();
    const b = vi.fn();
    const stopA = watchVaultFileBlob(PNG, a);
    const stopB = watchVaultFileBlob(PNG, b);
    await vi.advanceTimersByTimeAsync(0);
    expect(mock.callsTo('GET /api/files')).toHaveLength(1);
    expect(b).toHaveBeenLastCalledWith({ status: 'ready', url: 'blob:test/1' });
    stopA();
    stopB();
    const again = watchVaultFileBlob(PNG, vi.fn());
    again();
    expect(mock.callsTo('GET /api/files')).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(VAULT_FILE_BLOB_IDLE_MS);
    expect(urls.revoked).toEqual(['blob:test/1']);
  });

  it('fetches again when the file changes and revokes the old URL', async () => {
    const listener = vi.fn();
    watchVaultFileBlob(PNG, listener);
    await flush();
    emitServerEvent({ type: 'note:changed', path: PNG, revision: 'r2' });
    await flush();
    expect(mock.callsTo('GET /api/files')).toHaveLength(2);
    expect(listener).toHaveBeenLastCalledWith({ status: 'ready', url: 'blob:test/2' });
    expect(urls.revoked).toEqual(['blob:test/1']);
    // The same revision again (an echo) fetches nothing.
    emitServerEvent({ type: 'note:changed', path: PNG, revision: 'r2' });
    await flush();
    expect(mock.callsTo('GET /api/files')).toHaveLength(2);
  });

  it('reports a missing file and shows it once it is created', async () => {
    mock.on('GET /api/files', apiError(404, 'NOT_FOUND'));
    const listener = vi.fn();
    watchVaultFileBlob(PNG, listener);
    await flush();
    expect(listener).toHaveBeenLastCalledWith({ status: 'missing' });
    mock.on('GET /api/files', { body: {} });
    emitServerEvent({ type: 'note:created', path: PNG, revision: 'r1' });
    await flush();
    expect(listener).toHaveBeenLastCalledWith({ status: 'ready', url: 'blob:test/1' });
    emitServerEvent({ type: 'note:deleted', path: PNG });
    expect(listener).toHaveBeenLastCalledWith({ status: 'missing' });
    expect(urls.revoked).toEqual(['blob:test/1']);
  });

  it('keeps vaults apart: the same path in another vault is another file', async () => {
    watchVaultFileBlob(PNG, vi.fn());
    await flush();
    useVaultStore.setState({ vaultId: 'vault-b' });
    watchVaultFileBlob(PNG, vi.fn());
    await flush();
    expect(mock.callsTo('GET /api/files')).toHaveLength(2);
  });

  it('a failed request is an error state, not a missing file', async () => {
    mock.on('GET /api/files', apiError(500, 'INTERNAL'));
    const listener = vi.fn();
    watchVaultFileBlob(PNG, listener);
    await flush();
    expect(listener).toHaveBeenLastCalledWith({ status: 'error' });
  });
});
